// Прогон разбора афиши моделью по площадкам, где разведчик по ручкам
// ничего не нашёл.
//
// Отделено от чистой части намеренно: там решается, что считать
// событием, и это закрыто тестами; здесь — сеть, KV и бюджет, которые
// тестами не закроешь.
import {
  billLikely,
  buildExtractPrompt,
  dateDensity,
  htmlToText,
  parseExtracted,
} from "./afisha-llm";
import type { VenueAfisha, VenueAfishaEvent } from "./afisha";
import { busyKey, type VenueBusy } from "./afisha";
import { kvGetJson, type KvNs } from "./kv-ns";
import venuesRaw from "./data/venues.json";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/** Сколько площадок берём за прогон.
 *
 *  Каждая — это несколько загрузок страниц плюс инференс на CPU. Два за
 *  прогон при кроне раз в два часа дают полный круг по 59 сайтам за
 *  пару суток, и это осознанный размен: медленно, зато прогон не
 *  упирается ни в лимиты воркера, ни в слоты мозга, которые в это же
 *  время нужны живым гостям. */
const PER_RUN = 2;

/** Как часто возвращаемся к площадке, где ничего не нашли. Сайты
 *  переделывают, афишу заводят — но не каждую неделю. */
const RECHECK_DAYS = 10;

/** Где на сайте обычно лежит афиша. Пробуем несколько и берём ту
 *  страницу, где больше похожего на даты: корень часто оказывается
 *  витриной без единого события. */
const PATHS = ["", "/events", "/whats-on", "/calendar", "/afisha", "/программа"];

/** Потолок текста в промпт. Контекст слота 4096 токенов, и в него должны
 *  влезть инструкция, страница и ответ. */
const TEXT_MAX = 5000;

/** Отметка о прогоне по площадке. Живёт отдельно от afishasrc:, чтобы не
 *  трогать бухгалтерию разведчика по ручкам. */
export const llmKey = (vid: string) => `afishallm:${vid}`;
export type LlmRec = { checkedAt: string; found: number };

type VenueLite = { id: string; website?: string; type?: string; tag?: string };
/** Порядок важен: вперёд идут те, у кого афиша вообще бывает. Иначе
 *  бюджет прогона уходит на курорты и коворкинги, а клубы ждут неделю. */
const VENUES: VenueLite[] = ((venuesRaw as { venues?: VenueLite[] }).venues ?? [])
  .map((v) => ({ id: v.id, website: v.website, type: v.type, tag: v.tag }))
  .sort((a, b) => Number(billLikely(b.type, b.tag)) - Number(billLikely(a.type, a.tag)));

/** Хосты, где читать нечего: соцсети отдают анониму пустую оболочку. */
const SKIP = ["facebook.", "instagram.", "linktr.ee", "wa.me", "t.me", "goo.gl"];

const siteRoot = (url: string) => {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
};

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86400000);

/** Загрузить страницу, вернуть текст. Пустая строка вместо исключения:
 *  один недоступный адрес не повод бросать площадку. */
async function pageText(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return "";
    return htmlToText(await r.text());
  } catch {
    return "";
  }
}

/** Та страница сайта, где больше всего похожего на афишу. */
export async function bestPage(site: string): Promise<{ url: string; text: string } | null> {
  let best: { url: string; text: string; score: number } | null = null;
  for (const path of PATHS) {
    const url = `${site}${path}`;
    const text = await pageText(url);
    if (text.length < 200) continue;
    const score = dateDensity(text);
    if (!best || score > best.score) best = { url, text, score };
    // Плотная афиша нашлась — дальше можно не ходить: остальные адреса
    // это лишние загрузки и лишние секунды прогона.
    if (score >= 8) break;
  }
  // Ни одной даты на всём сайте — модели там делать нечего, и звать её
  // значит жечь слот впустую.
  return best && best.score > 0 ? { url: best.url, text: best.text } : null;
}

type Brain = { url?: string; token?: string; model?: string };

/** Спросить свой мозг. Возвращает сырой ответ или пустую строку. */
async function askBrain(brain: Brain, prompt: string): Promise<string> {
  if (!brain.url || !brain.token) return "";
  try {
    const r = await fetch(`${brain.url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${brain.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: brain.model ?? "qwen3-8b",
        messages: [{ role: "user", content: prompt }],
        // Ноль температуры: это извлечение фактов, а не сочинение.
        temperature: 0,
        max_tokens: 350,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return "";
    const data = (await r.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string } }[];
    };
    const msg = data.choices?.[0]?.message;
    // Подстраховка на случай, если /no_think не сработал: ответ мог
    // целиком уехать в reasoning_content. Брать оттуда безопасно —
    // разбор всё равно принимает только валидный JSON с датой и
    // названием, размышления через эту решётку не пройдут.
    const text = String(msg?.content || msg?.reasoning_content || "");
    return text.replace(/<think>[\s\S]*?<\/think>/g, "");
  } catch {
    return "";
  }
}

/** Слить найденное в KV, не затирая чужого.
 *
 *  Правило простое: всё, что пришло не от модели — руками команды, из
 *  ручки площадки, из Resident Advisor — остаётся нетронутым. Заменяем
 *  только прошлый улов модели. Так разбор можно откатить одним фильтром,
 *  если качество разочарует, и он никогда не съест ручную правку. */
export function mergeLlm(prev: VenueAfishaEvent[], fresh: VenueAfishaEvent[]): VenueAfishaEvent[] {
  const kept = prev.filter((e) => e.source !== "llm");
  const seen = new Set(kept.map((e) => `${e.dateIso}|${e.title.toLowerCase()}`));
  const add = fresh.filter((e) => !seen.has(`${e.dateIso}|${e.title.toLowerCase()}`));
  return [...kept, ...add].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

export type LlmRunResult = {
  ok: boolean;
  reason?: string;
  venues: {
    vid: string;
    url?: string;
    found: number;
    /** Разбор вслепую отлаживать нельзя: нулевой улов бывает и потому,
     *  что событий нет, и потому, что модель ответила не тем. По этим
     *  трём числам видно, какой это случай. */
    chars?: number;
    density?: number;
    raw?: string;
  }[];
};

/** Один прогон: взять очередь, разобрать, записать. */
export async function runAfishaLlm(
  ns: KvNs,
  limit = PER_RUN,
  debug = false,
): Promise<LlmRunResult> {
  const brain = await kvGetJson<Brain>(ns, "setting:brain");
  // Своего мозга нет — задача не делается вовсе. Уходить на чужой API
  // здесь нельзя: 110 сайтов съедят дневную квоту к обеду, и молчать
  // начнёт живой разговор, а не разбор афиши.
  if (!brain?.url || !brain.token) return { ok: false, reason: "no-brain", venues: [] };

  const today = new Date().toISOString().slice(0, 10);
  const queue: { vid: string; site: string }[] = [];
  for (const v of VENUES) {
    if (queue.length >= limit) break;
    if (!v.website || SKIP.some((h) => v.website!.includes(h))) continue;
    const site = siteRoot(v.website);
    if (!site) continue;
    // Берём только тех, у кого разведчик по ручкам уже сдался: там, где
    // есть настоящая ручка площадки, модель не нужна и хуже.
    const src = await kvGetJson<{ kind?: string }>(ns, `afishasrc:${v.id}`);
    if (src?.kind !== "none") continue;
    const rec = await kvGetJson<LlmRec>(ns, llmKey(v.id));
    if (rec && daysSince(rec.checkedAt) < RECHECK_DAYS) continue;
    queue.push({ vid: v.id, site });
  }

  const venues: LlmRunResult["venues"] = [];
  for (const { vid, site } of queue) {
    const page = await bestPage(site);
    if (!page) {
      await ns.put(llmKey(vid), JSON.stringify({ checkedAt: today, found: 0 } satisfies LlmRec));
      venues.push({ vid, found: 0 });
      continue;
    }
    const host = new URL(page.url).host;
    const raw = await askBrain(
      brain,
      buildExtractPrompt(page.text.slice(0, TEXT_MAX), today),
    );
    const fresh = parseExtracted(raw, { today, url: page.url, host });
    await ns.put(
      llmKey(vid),
      JSON.stringify({ checkedAt: today, found: fresh.length } satisfies LlmRec),
    );
    venues.push({
      vid,
      url: page.url,
      found: fresh.length,
      ...(debug
        ? { chars: page.text.length, density: dateDensity(page.text), raw: raw.slice(0, 400) }
        : {}),
    });
    if (!fresh.length) continue;

    const prevRec = await kvGetJson<VenueAfisha>(ns, `venueevents:${vid}`);
    const all = mergeLlm(prevRec?.events ?? [], fresh);
    await ns.put(
      `venueevents:${vid}`,
      JSON.stringify({
        events: all,
        syncedAt: Date.now(),
        source: prevRec?.source || "llm",
      } satisfies VenueAfisha),
    );
    // Календарь спрашивает «свободно ли», а не «покажи события» —
    // держим занятые даты рядом, иначе конструктор предложит занятый день.
    await ns.put(
      busyKey(vid),
      JSON.stringify({
        dates: [...new Set(all.map((e) => e.dateIso))].sort(),
        updatedAt: Date.now(),
      } satisfies VenueBusy),
    );
  }

  return { ok: true, venues };
}
