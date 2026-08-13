// Лента push-карточек: сервис-воркер по пушу забирает отсюда свежую карточку
// для показа уведомления. Авторизация — сессионная кука.
import { createFileRoute } from "@tanstack/react-router";

import { userFromCookieHeader } from "../gtr/auth";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";
import type { PushCard } from "../gtr/push";

export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const user = await userFromCookieHeader(request.headers.get("cookie"));
        if (!user) return new Response("no session", { status: 401 });
        const ns = await getKvNs();
        if (!ns) return Response.json({ title: "GTR EVENT", body: "Новое уведомление" });
        const card = await kvGetJson<PushCard>(ns, `pushfeed:${user.email}`);
        return Response.json(card ?? { title: "GTR EVENT", body: "Новое уведомление" });
      },
    },
  },
});
