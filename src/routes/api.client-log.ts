// Приёмник клиентских сбоев до входа.
//
// Когда вход не срабатывает на чужом устройстве, спрашивать «а что там
// написано?» — самый медленный канал диагностики. Экран входа сам шлёт
// сюда короткий отчёт: где упало, текст ошибки, браузер. Без сессии —
// сбой случается до неё, — поэтому вход строго ограничен: лимит по
// адресу, короткие поля, день хранения — месяц.
import { createFileRoute } from "@tanstack/react-router";

import { getKvNs, kvGetJson } from "../gtr/kv-ns";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/client-log")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const ns = await getKvNs();
        if (!ns) return json({ ok: false }, 503);

        const { clientIp, tooMany } = await import("../gtr/abuse");
        if (await tooMany("clientlog", clientIp(), { hits: 30, windowSec: 3600 }, ns))
          return json({ ok: false }, 429);

        let body: { where?: string; msg?: string; ua?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false }, 400);
        }

        const clean = (s: unknown, max: number) =>
          String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, max);

        const entry = {
          at: new Date().toISOString().slice(11, 19),
          where: clean(body.where, 40),
          msg: clean(body.msg, 300),
          ua: clean(body.ua ?? request.headers.get("user-agent"), 200),
        };
        if (!entry.where) return json({ ok: false }, 400);

        const key = `clientlog:${new Date().toISOString().slice(0, 10)}`;
        const cur = (await kvGetJson<(typeof entry)[]>(ns, key)) ?? [];
        cur.push(entry);
        await ns.put(key, JSON.stringify(cur.slice(-200)), {
          expirationTtl: 60 * 60 * 24 * 30,
        });
        return json({ ok: true });
      },
    },
  },
});
