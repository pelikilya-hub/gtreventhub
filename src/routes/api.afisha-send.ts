// Отправка сгенерированной афиши в Telegram: PNG из генератора уходит в
// личный чат автора (фолбэк — общий канал GTR). Доступ — как у генератора:
// BOSS и организаторы/продюсер, по сессионной куке.
import { createFileRoute } from "@tanstack/react-router";

import { userFromCookieHeader } from "../gtr/auth";
import { getKvNs } from "../gtr/kv-ns";
import { tgToken } from "../gtr/tg";

export const Route = createFileRoute("/api/afisha-send")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const user = await userFromCookieHeader(request.headers.get("cookie") ?? "");
        if (!user || (!user.boss && user.role !== "organizer"))
          return Response.json({ ok: false, reason: "нет прав" }, { status: 403 });
        const token = tgToken();
        if (!token) return Response.json({ ok: false, reason: "Telegram не настроен" });
        const ns = await getKvNs();
        const caption = decodeURIComponent(
          new URL(request.url).searchParams.get("caption") ?? "",
        ).slice(0, 900);
        const buf = await request.arrayBuffer();
        if (buf.byteLength < 10_000 || buf.byteLength > 9_000_000)
          return Response.json({ ok: false, reason: "размер файла" }, { status: 413 });

        const personal = ns ? await ns.get(`tg:${user.email}`) : null;
        const chatId =
          personal ||
          ((typeof process !== "undefined" && process.env?.TELEGRAM_CHAT_ID) || "");
        if (!chatId)
          return Response.json({ ok: false, reason: "привяжите Telegram в настройках" });

        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", caption || "GTR EVENT · афиша");
        form.append(
          "photo",
          new Blob([buf], { type: "image/png" }),
          "gtr-afisha.png",
        );
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: "POST",
          body: form,
        });
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          description?: string;
        } | null;
        if (!res.ok || !body?.ok)
          return Response.json({ ok: false, reason: body?.description || `HTTP ${res.status}` });
        return Response.json({ ok: true, personal: Boolean(personal) });
      },
    },
  },
});
