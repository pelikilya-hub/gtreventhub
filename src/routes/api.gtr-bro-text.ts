// Текстовый мозг GTR BRO: самохостная модель на сервере BOSS.
//
// Воркер — посредник и граница: он держит токен мозга, собирает промпт,
// исполняет инструменты и отдаёт клиенту только готовый ответ с
// типизированными карточками. Модель видит афишу через те же инструменты,
// что и голос, — выдумать событие ей не из чего.
//
// Конфигурация в KV `setting:brain`: { "url": "http://IP:8080",
// "token": "...", "model": "qwen3-8b" }. Нет записи — ручка честно
// отвечает no-brain, и клиент откатывается на разбор по правилам.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson, type KvNs } from "../gtr/kv-ns";
import { buildTextPrompt, pickMode, type BroContext } from "../gtr/bro/prompt.ru";
import { isBroLang, langDirective } from "../gtr/bro/lang";
import { kvProvider } from "../gtr/bro/provider";
import { looksInvented } from "../gtr/bro/guard";
import {
  handlers,
  qaNorm,
  toolsForRole,
  WRITE_TOOLS,
  type ToolCtx,
  type ToolName,
} from "../gtr/bro/tools";

type Flags = {
  broEnabled?: boolean;
  broKill?: boolean;
  geminiOff?: boolean;
  /** Свой мозг основным, Gemini — страховкой. */
  brainFirst?: boolean;
};
type Brain = { url?: string; token?: string; model?: string };

// Схемы инструментов для Gemini REST: без additionalProperties.
const stripExtra = (o: unknown): unknown => {
  if (Array.isArray(o)) return o.map(stripExtra);
  if (o && typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>))
      if (k !== "additionalProperties") out[k] = stripExtra(v);
    return out;
  }
  return o;
};
const gemTools = (role?: string) =>
  toolsForRole(role).map((d) => ({
    name: d.name,
    description: d.description,
    parameters: stripExtra(d.parameters),
  }));

type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};
type Card = {
  kind: "event" | "venue" | "route" | "taxi" | "confirm" | "music";
  data: Record<string, unknown>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

// Схемы инструментов — в формате chat completions, который понимает
// llama.cpp с шаблоном Qwen.
const openaiTools = (role?: string) =>
  toolsForRole(role).map((d) => ({
    type: "function" as const,
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    },
  }));

/** Запомнить вопрос, на который база знаний не ответила.
 *
 *  Повторяет noteMiss из инструмента намеренно, ключ в ключ: очередь
 *  обучения должна быть одна, независимо от того, пришёл вопрос через
 *  инструмент или через подсказку в промпт. Разные ключи дали бы два
 *  списка, и оба неполные. */
const noteQaMiss = async (ns: KvNs, raw: string): Promise<void> => {
  const key = qaNorm(raw).slice(0, 80);
  if (!key) return;
  try {
    const k = `broask:${key}`;
    const prev = JSON.parse((await ns.get(k)) ?? "null") as { n?: number } | null;
    await ns.put(
      k,
      JSON.stringify({ q: raw.slice(0, 120), n: (prev?.n ?? 0) + 1, last: Date.now() }),
      { expirationTtl: 60 * 60 * 24 * 90 },
    );
  } catch {
    /* журнал промахов не важнее ответа */
  }
};

export const Route = createFileRoute("/api/gtr-bro-text")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ ok: false, error: "auth" }, 401);
        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill || !flags.broEnabled)
          return json({ ok: false, error: "disabled" }, 503);

        const brain = (await kvGetJson<Brain>(ns, "setting:brain")) ?? {};
        const hasBrain = Boolean(brain.url && brain.token);

        // Общий срок ответа. Без него разговор упирается в сумму чужих
        // таймаутов: полторы минуты ожидания на телефоне человек читает
        // как поломку продукта, а не как задумчивость модели.
        const deadline = Date.now() + 26_000;
        const timeLeft = () => deadline - Date.now();

        let body: {
          text?: string;
          history?: { who: string; text: string }[];
          order?: string;
          lang?: unknown;
          personaMode?: unknown;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const text = String(body.text ?? "")
          .slice(0, 500)
          .trim();
        if (!text) return json({ ok: false, error: "empty" }, 400);

        // Потолок на человека: разговор с BRO — часть продукта, а не
        // бесплатный шлюз к нашей модели и нашей базе.
        const { tooMany, LIMITS } = await import("../gtr/abuse");
        if (await tooMany("bro", user.email, LIMITS.bro, ns))
          return json({ ok: false, error: "rate" }, 429);

        // Безопасность — раньше модели и раньше лимитов: скорая не ждёт
        // ни очереди к чужому серверу, ни исчерпанной квоты.
        const { safetyOf } = await import("../gtr/bro/safety");
        const risk = safetyOf(text);
        if (risk)
          return json({
            ok: true,
            reply: risk.hint ? `${risk.reply}\n\n${risk.hint}` : risk.reply,
          });

        // Попытка вытащить устройство помощника: системный промпт, список
        // инструментов, сырой дамп базы. Это не любопытство пользователя —
        // так снимают продукт целиком, чтобы собрать копию.
        const { looksLikeExtraction, EXTRACTION_REPLY } =
          await import("../gtr/bro/guard");
        if (looksLikeExtraction(text))
          return json({ ok: true, reply: EXTRACTION_REPLY });

        // Язык выбирает клиент — тот же выбор, что уходит в голосовую
        // полосу. Обе полосы обязаны отвечать на одном языке: человек
        // не должен слышать смену языка при пересадке на резерв.
        const lang = isBroLang(body.lang) ? body.lang : "ru";
        // Персона приходит от клиента — как и язык. Раньше здесь стояло
        // «bro» намертво: гость просил «без мата», голос слушался, а на
        // печатный вопрос отвечал прежним тоном. Настройка, которую
        // слышит одна половина продукта и не слышит вторая, хуже
        // отсутствующей: человек считает, что его просьбу проигнорировали.
        const persona = pickMode(body.personaMode);

        const ctx: BroContext = {
          userId: user.email,
          displayName: user.name,
          role: user.role,
          language: lang,
          personaMode: persona,
          timezone: "Asia/Bangkok",
          currentTime: new Date().toISOString(),
        };

        // Собираем один раз на три входа (Gemini дважды и свой мозг):
        // разъехавшийся между ними промпт означал бы, что резервный
        // движок отвечает по другим правилам, чем основной.
        const systemPrompt = buildTextPrompt(ctx) + langDirective(lang);

        // ---- База знаний в промпт, а не в надежду на инструмент -------
        //
        // ask_gtr остаётся, но полагаться на него одного нельзя: это
        // инструмент, и модель сама решает, звать его или ответить из
        // головы. Решает она неохотно — 119 выученных тем лежали мёртвым
        // грузом, а гость получал общие слова вместо нашего ответа.
        //
        // Поэтому подбор темы делает воркер, до обращения к модели, тем
        // же матчером, что и сам инструмент. Совпало — кладём наш ответ
        // в промпт как факт. Не совпало — промах уходит в очередь
        // обучения, ровно как из инструмента: вопрос гостя не теряется,
        // с какой бы стороны он ни пришёл.
        const { qaItems, qaMatch } = await import("../gtr/bro/tools");
        let qaHint = "";
        try {
          const items = await qaItems(
            ["gtr", "organizer", "owner", "pr", "sales"].includes(user.role ?? ""),
            (k) => ns.get(k),
          );
          const hit = qaMatch(text, items);
          if (hit) {
            // Вариантов у темы несколько — берём первый: чередование
            // «чтобы не повторяться» живёт в ask_gtr и требует записи в
            // KV на каждый вопрос, а здесь это лишняя запись на каждый
            // разговор. Модель всё равно перескажет своими словами.
            qaHint = hit.item.answers[0] ?? "";
          } else {
            await noteQaMiss(ns, text);
          }
        } catch {
          // База знаний — усиление, а не условие ответа: её отказ не
          // должен превращаться в молчание продукта.
        }

        // История — хвост табло. Префикс сообщений стабилен, поэтому
        // llama.cpp прокэширует его и повторные ответы будут быстрыми.
        const messages: Msg[] = [
          { role: "system", content: systemPrompt },
        ];
        if (qaHint)
          messages.push({
            role: "system",
            content:
              `Ответ базы знаний GTR на этот вопрос: ${qaHint}\n` +
              "Это наш факт — перескажи своими словами и не противоречь ему. " +
              "Своего сверх него не добавляй и ask_gtr по этой теме уже не зови.",
          });
        for (const h of (body.history ?? []).slice(-6))
          messages.push({
            role: h.who === "bro" ? "assistant" : "user",
            content: String(h.text ?? "").slice(0, 300),
          });
        // Открытая бронь: что уже собрано. Хвоста истории для этого мало —
        // человек сказал «нас четверо» шесть реплик назад, и переспросить
        // его об этом значит показать, что мы не слушали.
        const openOrder = String(body.order ?? "").slice(0, 200).trim();
        if (openOrder)
          messages.push({
            role: "system",
            content:
              `Сейчас в работе бронь: ${openOrder}. ` +
              "Это уже известно — не переспрашивай. Спроси ровно одно недостающее поле " +
              "(площадка, дата, сколько гостей, что за стол, телефон) и ничего больше.",
          });
        messages.push({ role: "user", content: text });

        const cards: Card[] = [];
        // Трассировка вызовов — какие аргументы модель реально передала.
        // Без неё разбор «почему пусто» превращается в гадание.
        const trace: { tool: string; args: unknown }[] = [];
        const provider = kvProvider(ns);

        const runTool = async (
          name: ToolName,
          args: Record<string, unknown>,
        ): Promise<unknown> => {
          const fn = handlers[name];
          if (!fn)
            return { ok: false, error: "unknown-tool", retryable: false };
          trace.push({ tool: name, args });
          // Пишущие инструменты в текстовой петле не исполняются: на табло
          // уходит карточка подтверждения, и только нажатие человека
          // отправит вызов в /api/gtr-bro-tool. Голосовое «да» и решение
          // модели этой границы не проходят.
          if (WRITE_TOOLS[name]) {
            cards.push({
              kind: "confirm",
              data: { name, args, summary: WRITE_TOOLS[name] },
            });
            return {
              ok: false,
              error: "awaiting-user-confirmation",
              note: "Пользователю показана кнопка подтверждения — скажи, что ждёшь нажатия.",
            };
          }
          const ctx2: ToolCtx = {
            provider,
            user: {
              email: user.email,
              name: user.name,
              role: user.role,
              boss: user.boss,
            },
          };
          try {
            return await Promise.race([
              fn(args, ctx2),
              new Promise<{ ok: false; error: string; retryable: boolean }>(
                (r) =>
                  setTimeout(
                    () => r({ ok: false, error: "timeout", retryable: true }),
                    8000,
                  ),
              ),
            ]);
          } catch {
            return { ok: false, error: "internal", retryable: false };
          }
        };
        const collectCards = (name: ToolName, result: unknown) => {
          const rr = result as { ok?: boolean; data?: Record<string, unknown> };
          if (!rr.ok || !rr.data) return;
          if (name === "search_events" && Array.isArray(rr.data.events))
            for (const ev of (
              rr.data.events as Record<string, unknown>[]
            ).slice(0, 3))
              cards.push({ kind: "event", data: ev });
          else if (name === "get_event_details")
            cards.push({ kind: "venue", data: rr.data });
          else if (name === "build_night_route")
            cards.push({ kind: "route", data: rr.data });
          else if (name === "call_taxi")
            cards.push({ kind: "taxi", data: rr.data });
          else if (name === "open_music" || name === "get_artist_profile")
            cards.push({ kind: "music", data: rr.data });
          else if (name === "get_venue_profile")
            cards.push({ kind: "venue", data: rr.data });
        };
        const saveDialog = async (reply: string, engine: string) => {
          try {
            const day = new Date().toISOString().slice(0, 10);
            const dkey = `brods:${day}`;
            const cur = (await kvGetJson<unknown[]>(ns, dkey)) ?? [];
            if (cur.length < 300) {
              cur.push({
                t: Date.now(),
                u: user.email,
                q: text,
                a: reply.slice(0, 1200),
                trace,
                e: engine,
              });
              await ns.put(dkey, JSON.stringify(cur), {
                expirationTtl: 60 * 60 * 24 * 365,
              });
            }
          } catch {
            /* датасет — не повод уронить ответ */
          }
        };

        // ---------------- Быстрый мозг: Gemini Flash по REST -------------
        // На CPU-сервере честные 20-45 секунд — для разговора это вечность.
        // Gemini отвечает за секунды и бесплатен в рамках дневного лимита;
        // Qwen на нашем железе остаётся запасным и полем для обучения.
        // Флаг-пауза: BOSS временно отключает Gemini, чтобы говорить
        // напрямую с локальным мозгом — без гадания, кто из двух ответил.
        const gemKey = flags.geminiOff
          ? ""
          : ((typeof process !== "undefined"
              ? process.env?.GEMINI_API_KEY
              : undefined) ?? "");

        /** Попытка через Gemini. null — движок не дал пригодного ответа,
         *  причина ушла в метрики; решение, что делать дальше, принимает
         *  распорядок движков внизу, а не сама попытка. */
        const tryGemini = async (): Promise<Response | null> => {
          if (!gemKey) return null;
          const gcfg =
            (await kvGetJson<{ textModel?: string }>(ns, "setting:gemini")) ??
            {};
          const gmodel = gcfg.textModel ?? "gemini-flash-latest";
          type GPart = Record<string, unknown>;
          const contents: { role: "user" | "model"; parts: GPart[] }[] = [];
          for (const h of (body.history ?? []).slice(-6))
            contents.push({
              role: h.who === "bro" ? "model" : "user",
              parts: [{ text: String(h.text ?? "").slice(0, 300) }],
            });
          contents.push({ role: "user", parts: [{ text }] });

          let gemFail = "";
          for (let round = 0; round < 3 && !gemFail; round++) {
            if (timeLeft() < 3_000) {
              gemFail = "deadline";
              break;
            }
            let res: Response;
            try {
              res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${gmodel}:generateContent?key=${gemKey}`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    systemInstruction: {
                      parts: [{ text: systemPrompt }],
                    },
                    contents,
                    tools: [{ functionDeclarations: gemTools(user.role) }],
                    generationConfig: {
                      temperature: 0.7,
                      maxOutputTokens: 600,
                    },
                  }),
                  signal: AbortSignal.timeout(
                    Math.min(12_000, Math.max(2_000, timeLeft())),
                  ),
                },
              );
            } catch {
              gemFail = "network";
              break;
            }
            if (res.status === 429) {
              // Свободный тариф Gemini считает запросы по минуте или по дню:
              // за 1.2 секунды такой счётчик не отпускает, а быстрый мозг
              // на GPU BOSS уже ждёт и отвечает надёжнее — не жжём секунды
              // на заведомо бесполезный повтор, сразу уходим в запасной путь.
              gemFail = "429";
              break;
            } else if (res.status === 503 || res.status === 500) {
              // Перегруз на стороне Google — мимолётный. Один повтор
              // дешевле, чем 30 секунд запасного мозга.
              await new Promise((r) => setTimeout(r, 1500));
              const retry = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${gmodel}:generateContent?key=${gemKey}`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    systemInstruction: {
                      parts: [{ text: systemPrompt }],
                    },
                    contents,
                    tools: [{ functionDeclarations: gemTools(user.role) }],
                    generationConfig: {
                      temperature: 0.7,
                      maxOutputTokens: 600,
                    },
                  }),
                  signal: AbortSignal.timeout(
                    Math.min(12_000, Math.max(2_000, timeLeft())),
                  ),
                },
              ).catch(() => null);
              if (!retry || !retry.ok) {
                gemFail = `http-${res.status}`;
                break;
              }
              res = retry;
            } else if (!res.ok) {
              gemFail = `http-${res.status}`;
              break;
            }
            const data = (await res.json()) as {
              candidates?: { content?: { parts?: GPart[] } }[];
            };
            const parts = data.candidates?.[0]?.content?.parts ?? [];
            const calls = parts.filter((p) => p.functionCall) as {
              functionCall: { name: string; args?: Record<string, unknown> };
            }[];
            if (!calls.length) {
              const reply = parts
                .map((p) => String((p as { text?: string }).text ?? ""))
                .join("")
                .trim();
              if (reply && looksInvented(reply, trace.length)) {
                console.warn(
                  "gtr-bro-text: ответ без инструментов отброшен",
                  gmodel,
                );
                return json(
                  { ok: false, error: "invented", engine: gmodel },
                  200,
                );
              }
              if (reply) {
                await saveDialog(reply, gmodel);
                return json({ ok: true, reply, cards, trace, engine: gmodel });
              }
              gemFail = "empty";
              break;
            }
            contents.push({ role: "model", parts });
            const fr: GPart[] = [];
            for (const c of calls.slice(0, 4)) {
              const name = c.functionCall.name as ToolName;
              const result = await runTool(name, c.functionCall.args ?? {});
              collectCards(name, result);
              fr.push({ functionResponse: { name, response: { result } } });
            }
            contents.push({ role: "user", parts: fr });
          }
          // gemFail — падаем дальше, в Qwen. Причина уходит в метрики.
          try {
            const day = new Date().toISOString().slice(0, 10);
            const mkey = `brostat:${day}`;
            const cur =
              (await kvGetJson<Record<string, number>>(ns, mkey)) ?? {};
            const mname = `bro.text.gemfail.${gemFail.replace(/[^a-z0-9-]/gi, "")}`;
            cur[mname] = (cur[mname] ?? 0) + 1;
            await ns.put(mkey, JSON.stringify(cur), {
              expirationTtl: 60 * 60 * 24 * 120,
            });
          } catch {
            /* счётчик не важнее ответа */
          }
          return null;
        };

        // ---------------- Свой мозг: Qwen на сервере GTR ------------------

        // Причина отказа своего мозга. Возвращать её сразу нельзя: когда
        // он идёт первым, за ним ещё есть Gemini, и ответ гостю важнее
        // диагноза. Отдаём её, только если не ответил никто.
        let brainErr: Response | null = null;

        /** Попытка через свой мозг. null — не смог, причина в brainErr.
         *
         *  Агентная петля: модель зовёт инструмент → воркер исполняет →
         *  результат обратно. Три круга хватает на «найди и собери
         *  маршрут»; больше — уже зацикливание, режем. */
        const tryBrain = async (): Promise<Response | null> => {
          if (!hasBrain || !brain.url) {
            brainErr = json({ ok: false, error: "no-brain" }, 503);
            return null;
          }
          const brainUrl = brain.url.replace(/\/$/, "");
          const brainBody = JSON.stringify({
            model: brain.model ?? "qwen3-8b",
            messages,
            tools: openaiTools(user.role),
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 400,
            // Первый запрос прогревает кэш промпта — дальше быстрее.
            cache_prompt: true,
          });
          // Домашний туннель до ПК BOSS иногда моргает на секунду — это не
          // повод класть весь ответ. Один быстрый повтор ловит ровно такой
          // случай, как уже сделано для Gemini выше.
          const fetchBrain = () =>
            fetch(`${brainUrl}/v1/chat/completions`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${brain.token}`,
                "content-type": "application/json",
              },
              body: brainBody,
              // CPU-модель думает небыстро, но ждать её дольше общего
              // срока бессмысленно: правила на клиенте ответят раньше.
              signal: AbortSignal.timeout(Math.max(3_000, timeLeft())),
            });
          for (let round = 0; round < 3; round++) {
            if (timeLeft() < 3_000) {
              brainErr = json({ ok: false, error: "deadline" }, 504);
              return null;
            }
            let res: Response;
            try {
              res = await fetchBrain();
              if (
                !res.ok &&
                [502, 503, 504].includes(res.status) &&
                timeLeft() > 5_000
              ) {
                await new Promise((r) => setTimeout(r, 1000));
                res = await fetchBrain();
              }
            } catch {
              if (timeLeft() > 5_000) {
                await new Promise((r) => setTimeout(r, 1000));
                try {
                  res = await fetchBrain();
                } catch {
                  brainErr = json({ ok: false, error: "brain-network" }, 502);
                  return null;
                }
              } else {
                brainErr = json({ ok: false, error: "brain-network" }, 502);
                return null;
              }
            }
            if (!res.ok) {
              brainErr = json(
                { ok: false, error: "brain-http", status: res.status },
                502,
              );
              return null;
            }

            const data = (await res.json()) as {
              choices?: { message?: Msg }[];
            };
            const msg = data.choices?.[0]?.message;
            if (!msg) {
              brainErr = json({ ok: false, error: "brain-shape" }, 502);
              return null;
            }

            if (!msg.tool_calls?.length) {
              // Qwen3 в толстых случаях всё же присылает размышления —
              // человеку они не нужны.
              const reply = String(msg.content ?? "")
                .replace(/<think>[\s\S]*?<\/think>/g, "")
                .trim();
              if (looksInvented(reply, trace.length)) {
                console.warn(
                  "gtr-bro-text: ответ без инструментов отброшен",
                  "qwen3-8b",
                );
                return json(
                  { ok: false, error: "invented", engine: "qwen3-8b" },
                  200,
                );
              }
              await saveDialog(reply, "qwen3-8b");
              return json({
                ok: true,
                reply: reply || "…",
                cards,
                trace,
                engine: "qwen3-8b",
              });
            }

            messages.push(msg);
            for (const tc of msg.tool_calls.slice(0, 4)) {
              const name = tc.function.name as ToolName;
              const fn = handlers[name];
              let result: unknown = {
                ok: false,
                error: "unknown-tool",
                retryable: false,
              };
              if (fn) {
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments || "{}") as Record<
                    string,
                    unknown
                  >;
                } catch {
                  args = {};
                }
                trace.push({ tool: name, args });
                try {
                  result = await Promise.race([
                    fn(args, { provider }),
                    new Promise<{
                      ok: false;
                      error: string;
                      retryable: boolean;
                    }>((r) =>
                      setTimeout(
                        () =>
                          r({ ok: false, error: "timeout", retryable: true }),
                        8000,
                      ),
                    ),
                  ]);
                } catch {
                  result = { ok: false, error: "internal", retryable: false };
                }
              }

              // Карточки — из типизированных результатов, как и в голосе.
              const rr = result as {
                ok?: boolean;
                data?: Record<string, unknown>;
              };
              if (rr.ok && rr.data) {
                if (name === "search_events" && Array.isArray(rr.data.events))
                  for (const ev of (
                    rr.data.events as Record<string, unknown>[]
                  ).slice(0, 3))
                    cards.push({ kind: "event", data: ev });
                else if (name === "get_event_details")
                  cards.push({ kind: "venue", data: rr.data });
                else if (name === "build_night_route")
                  cards.push({ kind: "route", data: rr.data });
              }

              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(result).slice(0, 4000),
              });
            }
          }

          brainErr = json({ ok: false, error: "loop-limit" }, 502);
          return null;
        };

        // ---------------- Распорядок движков ------------------------------
        //
        // По умолчанию первым идёт Gemini: он отвечает за секунды и
        // бесплатен в рамках дневного лимита. brainFirst меняет порядок —
        // свой мозг вперёд, чужой в запас.
        //
        // Именно порядок, а не выключение. Отключить Gemini совсем — это
        // не независимость, а обмен одной единственной точки отказа на
        // другую: свой сервер тоже падает, и тогда гостю не отвечает никто.
        if (flags.brainFirst && hasBrain) {
          const mine = await tryBrain();
          if (mine) return mine;
          const gem = await tryGemini();
          if (gem) return gem;
          return brainErr ?? json({ ok: false, error: "no-engine" }, 502);
        }
        const gem = await tryGemini();
        if (gem) return gem;
        const mine = await tryBrain();
        return mine ?? brainErr ?? json({ ok: false, error: "no-engine" }, 502);
      },
    },
  },
});
