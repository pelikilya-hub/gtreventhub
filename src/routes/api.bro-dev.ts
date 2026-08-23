// API стенда разработчика GTR BRO (/bro-dev).
//
// Одна ручка обслуживает панель: статус соединений, настройки (флаги,
// Gemini, мозг), обучение и командный пульт Claude Code. Доступ — только
// BOSS: стенд управляет продуктом, а не показывает его.
//
// Отдельная калитка — пульт: Claude в ветке разработки читает очередь и
// отмечает исполнение по ключу пульта (?pult=<key>), без cookie. Ключ —
// производная от GTR_SESSION_SECRET, BOSS видит его на стенде.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson, kvListAll, type KvNs } from "../gtr/kv-ns";
import { learnNext, learnProgress } from "../gtr/bro/learn";
import {
  addCmd,
  ackCmd,
  pultAccessKey,
  readQueue,
  writeQueue,
  type PultStatus,
} from "../gtr/bro/pult";

type Flags = {
  broEnabled?: boolean;
  broKill?: boolean;
  broRoles?: string[];
  geminiOff?: boolean;
  voiceProvider?: "openai" | "gemini";
};
type Brain = { url?: string; token?: string; model?: string };
type Gemini = { textModel?: string };

/** Что видит инструмент поиска афиши. Повторяет чтение kvProvider —
 *  включая срез на 160 площадок: если база перерастёт его, хвост
 *  алфавита пропадёт из ответов BRO, и увидеть это надо здесь, а не по
 *  жалобе «он не знает про заведение». */
const afishaView = async (ns: KvNs) => {
  const keys = await kvListAll(ns, "venueevents:");
  const today = new Date().toISOString().slice(0, 10);
  let withEvents = 0;
  let total = 0;
  let upcoming = 0;
  let freshest = "";
  const sample: string[] = [];
  for (const key of keys.slice(0, 160)) {
    const rec = await kvGetJson<{ events?: { title: string; dateIso: string }[] }>(ns, key);
    const events = rec?.events ?? [];
    if (!events.length) continue;
    withEvents++;
    total += events.length;
    for (const e of events) {
      const d = String(e.dateIso ?? "").slice(0, 10);
      if (d >= today) upcoming++;
      if (d > freshest) freshest = d;
    }
    if (sample.length < 4)
      sample.push(`${key.slice("venueevents:".length)}: ${events[0].dateIso} ${events[0].title.slice(0, 40)}`);
  }
  // Состояние разведки источников. venueevents:<vid> появляется только у
  // площадок, где события НАШЛИСЬ, поэтому по одному их числу нельзя
  // отличить «разведка не дошла» от «дошла и источника нет». Отличает
  // afishasrc:<vid> — отметка о проверке, она пишется в обоих случаях.
  const src = await kvListAll(ns, "afishasrc:");
  const byKind: Record<string, number> = {};
  for (const key of src) {
    const rec = await kvGetJson<{ kind?: string }>(ns, key);
    const k = String(rec?.kind ?? "?");
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  return {
    venues: keys.length,
    // Срез kvProvider. Равенство с venues — знак, что пора его поднимать.
    scanned: Math.min(keys.length, 160),
    withEvents,
    events: total,
    upcoming,
    lastDate: freshest,
    today,
    sample,
    // Сколько площадок разведка уже трогала и что нашла. probed сильно
    // меньше базы — значит круг ещё не пройден: за прогон проверяется
    // всего дюжина сайтов, это упирается в лимит подзапросов воркера.
    probed: src.length,
    byKind,
  };
};

/** Вопросы без ответа, самые частые сверху.
 *
 *  Одиночные промахи намеренно не отсекаем: тема, спрошенная один раз,
 *  тоже может оказаться дырой — решает человек, глядя на формулировку,
 *  а не порог. Отсекаем только длину списка. */
const topMisses = async (ns: KvNs) => {
  const keys = await kvListAll(ns, "broask:");
  const rows: { q: string; n: number; last: number }[] = [];
  for (const key of keys.slice(0, 200)) {
    const rec = await kvGetJson<{ q?: string; n?: number; last?: number }>(ns, key);
    if (rec?.q) rows.push({ q: rec.q, n: rec.n ?? 1, last: rec.last ?? 0 });
  }
  rows.sort((a, b) => b.n - a.n || b.last - a.last);
  return { total: keys.length, top: rows.slice(0, 15) };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const day = (shift = 0) =>
  new Date(Date.now() + 7 * 3_600_000 - shift * 86_400_000).toISOString().slice(0, 10);

// Хвост диалогов BRO за сутки: датасет для обучения и разбор «почему так
// ответил». Реплики режем — стенд смотрит, а не выкачивает.
const dialogTail = async (ns: KvNs, n: number) => {
  const cur =
    (await kvGetJson<
      { t: number; u: string; q: string; a: string; e?: string; trace?: unknown }[]
    >(ns, `brods:${day()}`)) ?? [];
  return cur.slice(-n).map((d) => ({
    t: d.t,
    u: d.u,
    q: String(d.q ?? "").slice(0, 300),
    a: String(d.a ?? "").slice(0, 600),
    e: d.e,
    trace: d.trace,
  }));
};

export const Route = createFileRoute("/api/bro-dev")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const ns = await getKvNs();
        const url = new URL(request.url);

        // Калитка пульта: Claude читает очередь по ключу, без cookie.
        const pultKey = url.searchParams.get("pult");
        if (pultKey) {
          if (pultKey !== (await pultAccessKey())) return json({ ok: false, error: "key" }, 401);
          if (!ns) return json({ ok: false, error: "no-kv" }, 503);
          // &debug=1 — срез для разбора «BRO молчит»: метрики за два дня и
          // хвост диалогов. Тот же ключ, что и очередь: это канал владельца.
          if (url.searchParams.get("debug")) {
            return json({
              ok: true,
              queue: await readQueue(ns),
              stats: {
                [day()]: (await kvGetJson<Record<string, number>>(ns, `brostat:${day()}`)) ?? {},
                [day(1)]: (await kvGetJson<Record<string, number>>(ns, `brostat:${day(1)}`)) ?? {},
              },
              dialogs: await dialogTail(ns, 10),
              // Состояние сторожа мозга: видно, что крон вообще ходит и
              // что он там застал. Без этого сторож — чёрный ящик, о
              // работе которого узнаёшь только по тревоге, а её отсутствие
              // одинаково означает и «всё хорошо», и «крон не запускается».
              brainWatch: await kvGetJson(ns, "brain:watch"),
              // Прогон афиш пишет сюда время и исход. Здесь он нужен как
              // отметка жизни планировщика: если и этот ключ старый, то
              // молчит не сторож, а кроны целиком — и чинить надо не там.
              cronLastRun: await kvGetJson(ns, "afisha:lastrun"),
              // Афиша глазами самого BRO. Отчёт прогона (cronLastRun) —
              // это слова синхронизации о себе, и воркер режет его тело.
              // Здесь читается ровно то, что читает инструмент поиска:
              // те же ключи venueevents:, тот же срез на 160 площадок.
              // Расхождение между «синхронизация прошла» и «BRO не знает
              // про вечер» видно только так.
              afisha: await afishaView(ns),
              // Чего гости спрашивали, а база знаний не знала. Это и есть
              // очередь на обучение: не придуманная за столом, а взятая
              // из реального спроса. Сверху — самые частые.
              misses: await topMisses(ns),
              // Исход последней дымовой проверки. Пустой список bad —
              // прод отвечает тем, чем должен; иначе видно, чем именно
              // не отвечает.
              smoke: await kvGetJson(ns, "smoke:last"),
            });
          }
          return json({ ok: true, queue: await readQueue(ns) });
        }

        const user = await currentUser();
        if (!user?.boss) return json({ ok: false, error: "boss-only" }, user ? 403 : 401);
        if (!ns) return json({ ok: false, error: "no-kv", kv: false }, 503);

        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        const brain = (await kvGetJson<Brain>(ns, "setting:brain")) ?? {};
        const gemini = (await kvGetJson<Gemini>(ns, "setting:gemini")) ?? {};
        const { learned, backlog, at } = await learnProgress(ns);
        const stats = {
          [day()]: (await kvGetJson<Record<string, number>>(ns, `brostat:${day()}`)) ?? {},
          [day(1)]: (await kvGetJson<Record<string, number>>(ns, `brostat:${day(1)}`)) ?? {},
        };
        let brainHost = "";
        try {
          brainHost = brain.url ? new URL(brain.url).host : "";
        } catch {
          brainHost = "не разбирается";
        }

        return json({
          ok: true,
          now: Date.now(),
          kv: true,
          env: {
            openaiKey: Boolean(typeof process !== "undefined" && process.env?.OPENAI_API_KEY),
            geminiKey: Boolean(typeof process !== "undefined" && process.env?.GEMINI_API_KEY),
          },
          flags,
          gemini: { textModel: gemini.textModel ?? "" },
          brain: { configured: Boolean(brain.url && brain.token), host: brainHost, model: brain.model ?? "" },
          learn: {
            total: learned.length,
            left: backlog.length,
            at: at ?? null,
            latest: learned.slice(-6).map((l) => ({ id: l.id, title: l.title, tag: l.tag })),
            next: backlog.slice(0, 4).map((l) => ({ id: l.id, title: l.title, tag: l.tag })),
          },
          stats,
          dialogs: await dialogTail(ns, 15),
          pult: { queue: await readQueue(ns), key: await pultAccessKey() },
        });
      },

      POST: async ({ request }: { request: Request }) => {
        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const action = String(body.action ?? "");

        // Настройка мозга от Claude — по ключу пульта: BOSS присылает адрес
        // туннеля в чат, Claude вписывает его сюда и сразу проверяет.
        if (action === "pult.brain") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const url = String(body.url ?? "").slice(0, 200);
          const token = String(body.token ?? "").slice(0, 200);
          const model = String(body.model ?? "qwen3-8b").slice(0, 60);
          if (!url || !token) return json({ ok: false, error: "empty" }, 400);
          await ns.put("setting:brain", JSON.stringify({ url, token, model }));
          return json({ ok: true });
        }

        // Живая проверка мозга BOSS — по ключу пульта.
        //
        // Зачем отдельно от brainProbe в ручке сессии: llama.cpp отдаёт
        // /health и /v1/models без токена, поэтому оба зелёных ответа не
        // доказывают, что токен в KV совпадает с токеном на сервере. Это
        // видно только на настоящем запросе с Authorization. Спрашиваем
        // одно слово (max_tokens: 8), чтобы не занимать слот инференса
        // дольше необходимого.
        if (action === "pult.brainTest") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const cfg = await kvGetJson<{ url?: string; token?: string; model?: string }>(
            ns,
            "setting:brain",
          );
          if (!cfg?.url) return json({ ok: false, error: "no-brain" }, 400);
          try {
            const r = await fetch(`${cfg.url.replace(/\/$/, "")}/v1/chat/completions`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
              },
              body: JSON.stringify({
                model: cfg.model ?? "qwen3-8b",
                messages: [{ role: "user", content: "Ответь одним словом: эфир" }],
                // Длину ответа задаём снаружи: по восьми токенам нельзя
                // судить о скорости генерации — в них тонет время
                // разбора промпта. Для решения «потянет ли этот сервер
                // живой голос» нужен настоящий ответ, а не отклик.
                max_tokens: Math.max(1, Math.min(300, Math.round(Number(body.tokens ?? 8)) || 8)),
                stream: false,
              }),
              // Холодный старт после простоя долгий: прогрев кэша промпта
              // на CPU занимает десятки секунд. Дедлайн диагностики выше
              // боевого, иначе проверка соврёт «мозг мёртв» на живом.
              signal: AbortSignal.timeout(60_000),
            });
            const raw = await r.text();
            // Отдаём и usage: по нему считается скорость генерации, а
            // это единственный честный ответ на вопрос про своё железо.
            let usage: unknown = null;
            try {
              usage = (JSON.parse(raw) as { usage?: unknown }).usage ?? null;
            } catch {
              /* не JSON — вернём как есть */
            }
            return json({ ok: r.ok, status: r.status, usage, body: raw.slice(0, 300) });
          } catch (e) {
            return json({ ok: false, error: String(e).slice(0, 200) });
          }
        }

        // Проверка голосового движка OpenAI — по ключу пульта.
        //
        // Realtime однажды не поднялся вовсе: метрика показала ноль
        // сессий openai при живом ключе, и выяснилось это на живом
        // разговоре. Ручка спрашивает у OpenAI эфемерный секрет ровно
        // тем же телом, что и боевая ручка, и возвращает статус: если
        // модель недоступна на аккаунте, это видно за секунду и до того,
        // как человек нажал кнопку.
        if (action === "pult.voiceTest") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const oai = typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined;
          if (!oai) return json({ ok: false, error: "no-key" }, 503);
          const model = String(body.model ?? "gpt-realtime-2.1").slice(0, 60);
          try {
            const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
              method: "POST",
              headers: { authorization: `Bearer ${oai}`, "content-type": "application/json" },
              body: JSON.stringify({
                expires_after: { anchor: "created_at", seconds: 600 },
                session: { type: "realtime", model, audio: { output: { voice: "cedar" } } },
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const text = await r.text();
            if (!r.ok)
              return json({ ok: false, status: r.status, model, body: text.slice(0, 300) });

            // Секрет выдают бесплатно и не глядя на баланс — на этом
            // проверка однажды соврала зелёным, а живой разговор упал с
            // 429 «exceeded your current quota». Поэтому второй шаг:
            // самый дешёвый настоящий вызов, который квоту всё-таки
            // трогает. Ответ нам не нужен, нужен только его статус.
            let quota: Response;
            try {
              quota = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { authorization: `Bearer ${oai}`, "content-type": "application/json" },
                body: JSON.stringify({
                  model: "gpt-4o-mini",
                  messages: [{ role: "user", content: "ok" }],
                  max_tokens: 1,
                }),
                signal: AbortSignal.timeout(15_000),
              });
            } catch (e) {
              return json({ ok: false, model, error: String(e).slice(0, 200) });
            }
            const qText = await quota.text();
            // Секрет наружу не отдаём даже в канал владельца: в теле
            // успеха лежит рабочий ключ на десять минут.
            return json({
              ok: quota.ok,
              status: quota.status,
              model,
              body: quota.ok
                ? "секрет выдан, баланс есть"
                : `секрет выдан, но баланс: ${qText.slice(0, 220)}`,
            });
          } catch (e) {
            return json({ ok: false, error: String(e).slice(0, 200) });
          }
        }

        // Разбор афиши моделью по требованию — по ключу пульта.
        // Ждать два часа, чтобы увидеть, что вычитала модель, значит
        // отлаживать вслепую.
        if (action === "pult.afishaLlm") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const { runAfishaLlm } = await import("../gtr/afisha-llm-run");
          const limit = Math.max(1, Math.min(6, Math.round(Number(body.limit ?? 2)) || 2));
          return json(await runAfishaLlm(ns, limit));
        }

        // Дымовая проверка по требованию — по ключу пульта.
        //
        // Своё расписание её и так дёргает, но ждать два часа, чтобы
        // увидеть исход собственной правки, — это ровно та петля
        // обратной связи, из-за которой тихие поломки живут неделями.
        if (action === "pult.smoke") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const { runSmoke } = await import("../gtr/bro/smoke-run");
          return json(await runSmoke(ns));
        }

        // Выбор голосового движка — по ключу пульта.
        //
        // Без этого флага код берёт Gemini Live просто потому, что ключ
        // Gemini есть. Realtime от OpenAI звучит заметно лучше, но стоит
        // денег на балансе, поэтому выбор явный и остаётся за BOSS, а не
        // выводится из того, какие ключи оказались настроены.
        if (action === "pult.voice") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const p = String(body.provider ?? "");
          if (p !== "openai" && p !== "gemini")
            return json({ ok: false, error: "bad-provider" }, 400);
          const cur = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
          const next: Flags = { ...cur, voiceProvider: p };
          await ns.put("setting:flags", JSON.stringify(next));
          return json({ ok: true, flags: next });
        }

        // Отметка исполнения от Claude — по ключу пульта, без cookie.
        if (action === "pult.ack") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const status = String(body.status ?? "") as PultStatus;
          if (status !== "taken" && status !== "done")
            return json({ ok: false, error: "bad-status" }, 400);
          const queue = ackCmd(
            await readQueue(ns),
            String(body.id ?? ""),
            status,
            typeof body.note === "string" ? body.note : undefined,
            Date.now(),
          );
          await writeQueue(ns, queue);
          return json({ ok: true, queue });
        }

        // Выучить весь бэклог разом — по ключу пульта. Обычный крон отдаёт
        // 1-2 темы в день умышленно медленно; когда BOSS просит подтянуть
        // весь бэклог сразу (например, только что добавленные темы), ждать
        // неделю смысла нет — учим всё за один вызов.
        if (action === "pult.learnAll") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const res = await learnNext(ns, 10_000);
          return json(res);
        }

        // Пауза быстрого мозга (Gemini) — по ключу пульта. Нужна, чтобы
        // проверить локальный мозг BOSS в чистом виде, не гадая, кто из
        // двух движков ответил. Флаг общий с BOSS-панелью (setting:flags),
        // так что выключатель виден и там.
        if (action === "pult.gemini") {
          if (String(body.key ?? "") !== (await pultAccessKey()))
            return json({ ok: false, error: "key" }, 401);
          const cur = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
          const next: Flags = { ...cur, geminiOff: Boolean(body.off) };
          await ns.put("setting:flags", JSON.stringify(next));
          return json({ ok: true, flags: next });
        }

        const user = await currentUser();
        if (!user?.boss) return json({ ok: false, error: "boss-only" }, user ? 403 : 401);

        switch (action) {
          case "flags": {
            const cur = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
            const patch = (body.patch ?? {}) as Flags;
            const next: Flags = { ...cur };
            if (typeof patch.broEnabled === "boolean") next.broEnabled = patch.broEnabled;
            if (typeof patch.broKill === "boolean") next.broKill = patch.broKill;
            if (Array.isArray(patch.broRoles))
              next.broRoles = patch.broRoles.map((r) => String(r).slice(0, 20)).slice(0, 10);
            await ns.put("setting:flags", JSON.stringify(next));
            return json({ ok: true, flags: next });
          }
          case "gemini": {
            const textModel = String(body.textModel ?? "").slice(0, 60);
            const cur = (await kvGetJson<Gemini>(ns, "setting:gemini")) ?? {};
            await ns.put("setting:gemini", JSON.stringify({ ...cur, textModel: textModel || undefined }));
            return json({ ok: true });
          }
          case "brain": {
            // Пустая форма стирает конфиг: мозг отключаем явно, а не пробелом.
            const url = String(body.url ?? "").slice(0, 200);
            const token = String(body.token ?? "").slice(0, 200);
            const model = String(body.model ?? "").slice(0, 60);
            if (!url) {
              await ns.delete("setting:brain");
              return json({ ok: true, cleared: true });
            }
            const cur = (await kvGetJson<Brain>(ns, "setting:brain")) ?? {};
            await ns.put(
              "setting:brain",
              JSON.stringify({
                url,
                // Пустой токен в форме означает «оставить прежний».
                token: token || cur.token,
                model: model || cur.model,
              }),
            );
            return json({ ok: true });
          }
          case "learn": {
            const res = await learnNext(ns, 2);
            return json(res);
          }
          case "pult.add": {
            const text = String(body.text ?? "").trim();
            if (!text) return json({ ok: false, error: "empty" }, 400);
            const queue = addCmd(await readQueue(ns), user.email, text, Date.now());
            await writeQueue(ns, queue);
            return json({ ok: true, queue });
          }
          case "pult.del": {
            const queue = (await readQueue(ns)).filter((c) => c.id !== String(body.id ?? ""));
            await writeQueue(ns, queue);
            return json({ ok: true, queue });
          }
          case "pult.clear": {
            const queue = (await readQueue(ns)).filter((c) => c.status !== "done");
            await writeQueue(ns, queue);
            return json({ ok: true, queue });
          }
          default:
            return json({ ok: false, error: "unknown-action" }, 400);
        }
      },
    },
  },
});
