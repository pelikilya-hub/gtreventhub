// Обмен SDP для GTR BRO — через наш воркер, а не напрямую из браузера.
//
// Прямой запрос браузера к провайдеру — это зависимость от CORS, DNS и
// причуд мобильного оператора, и когда он падает, телефон говорит
// «закрыто» без объяснений. Через воркер шаг детерминирован, а статус
// ошибки доезжает до экрана.
//
// Секрет здесь эфемерный (минуты жизни, одно соединение) — основной ключ
// в этом файле не участвует.
import { createFileRoute } from "@tanstack/react-router";

import { currentUser } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

type Flags = { broEnabled?: boolean; broKill?: boolean };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/gtr-bro-sdp")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await currentUser();
        if (!user) return json({ ok: false, error: "auth" }, 401);
        const ns = await getKvNs();
        if (!ns) return json({ ok: false, error: "no-kv" }, 503);
        const flags = (await kvGetJson<Flags>(ns, "setting:flags")) ?? {};
        if (flags.broKill || !flags.broEnabled) return json({ ok: false, error: "disabled" }, 503);

        let body: { secret?: string; sdp?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const secret = String(body.secret ?? "");
        const sdp = String(body.sdp ?? "");
        // Пересылаем только то, что похоже на эфемерный секрет и на SDP:
        // эта ручка — не универсальный прокси.
        if (!secret.startsWith("ek_") || secret.length > 300)
          return json({ ok: false, error: "bad-secret" }, 400);
        if (!sdp.startsWith("v=0") || sdp.length > 200_000)
          return json({ ok: false, error: "bad-sdp" }, 400);

        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            headers: { authorization: `Bearer ${secret}`, "content-type": "application/sdp" },
            body: sdp,
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          return json({ ok: false, error: "network" }, 502);
        }

        const text = await res.text();
        if (!res.ok)
          // Кусок тела ошибки — на экран отладки: это JSON провайдера с
          // причиной отказа, без него телефон снова скажет «закрыто» молча.
          return json({ ok: false, status: res.status, error: text.slice(0, 300) }, 502);
        return json({ ok: true, sdp: text });
      },
    },
  },
});
