// Маршрутизатор инструментов GTR BRO.
//
// Модель вызывает инструмент — вызов уходит сюда, а не выполняется в
// браузере. Причина простая: аргументы приходят от модели, а модели
// нельзя доверять ни имя площадки, ни диапазон дат, ни лимит. Здесь они
// проверяются, здесь же лежит доступ к KV с афишей, и здесь останется
// граница для будущих денежных действий.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson, kvListAll } from "../gtr/kv-ns";
import { handlers, type EventsProvider, type ToolName } from "../gtr/bro/tools";

type Flags = { broEnabled?: boolean; broKill?: boolean };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Афиша из нашего же кэша разведки: venueevents:<vid>. Демо-источника
 *  нет намеренно — за выдуманный вечер поедет живой человек. */
const kvProvider = (ns: NonNullable<Awaited<ReturnType<typeof getKvNs>>>): EventsProvider => ({
  id: "gtr-afisha",
  async search({ dateFrom, dateTo }) {
    const keys = await kvListAll(ns, "venueevents:");
    const out: { vid: string; events: { id?: string; title: string; dateIso: string; poster?: string }[] }[] = [];
    // Ограничение сверху: результат уходит в модель, и раздутый ответ
    // и стоит дороже, и топит полезное в шуме.
    for (const key of keys.slice(0, 60)) {
      const rec = await kvGetJson<{ events?: { id?: string; title: string; dateIso: string; poster?: string }[] }>(
        ns,
        key,
      );
      const events = (rec?.events ?? []).filter((e) => e.dateIso >= dateFrom && e.dateIso <= dateTo);
      if (events.length) out.push({ vid: key.slice("venueevents:".length), events: events.slice(0, 6) });
    }
    return out;
  },
});

export const Route = createFileRoute("/api/gtr-bro-tool")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ ok: false, error: "auth" }, 401);

        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill || !flags.broEnabled) return json({ ok: false, error: "disabled" }, 503);

        let body: { name?: string; args?: Record<string, unknown>; callId?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }

        const name = String(body.name ?? "") as ToolName;
        const fn = handlers[name];
        if (!fn) return json({ ok: false, error: "unknown-tool" }, 400);

        const args = body.args && typeof body.args === "object" ? body.args : {};
        try {
          const result = await Promise.race([
            fn(args as Record<string, unknown>, { provider: kvProvider(ns) }),
            // Зависший инструмент хуже отсутствующего: модель будет ждать
            // и молчать, а пользователь решит, что связь оборвалась.
            new Promise<{ ok: false; error: string; retryable: boolean }>((r) =>
              setTimeout(() => r({ ok: false, error: "timeout", retryable: true }), 8000),
            ),
          ]);
          return json({ ok: true, callId: body.callId ?? null, result });
        } catch {
          return json({ ok: true, callId: body.callId ?? null, result: { ok: false, error: "internal", retryable: false } });
        }
      },
    },
  },
});
