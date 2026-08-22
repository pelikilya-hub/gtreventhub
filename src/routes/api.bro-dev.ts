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
import { getKvNs, kvGetJson, type KvNs } from "../gtr/kv-ns";
import { learnNext, learnProgress } from "../gtr/bro/learn";
import {
  addCmd,
  ackCmd,
  pultAccessKey,
  readQueue,
  writeQueue,
  type PultStatus,
} from "../gtr/bro/pult";

type Flags = { broEnabled?: boolean; broKill?: boolean; broRoles?: string[]; geminiOff?: boolean };
type Brain = { url?: string; token?: string; model?: string };
type Gemini = { textModel?: string };

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
                max_tokens: 8,
                stream: false,
              }),
              // Холодный старт после простоя долгий: прогрев кэша промпта
              // на CPU занимает десятки секунд. Дедлайн диагностики выше
              // боевого, иначе проверка соврёт «мозг мёртв» на живом.
              signal: AbortSignal.timeout(60_000),
            });
            const text = (await r.text()).slice(0, 400);
            // 401 здесь — единственный однозначный ответ «токен не тот».
            return json({ ok: r.ok, status: r.status, body: text });
          } catch (e) {
            return json({ ok: false, error: String(e).slice(0, 200) });
          }
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
