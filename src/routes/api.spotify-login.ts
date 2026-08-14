// Вход через Spotify: редирект на авторизацию с подписанным state.
// Без ключей окружения честно возвращаем на экран подбора с пометкой.
import { createFileRoute } from "@tanstack/react-router";

import { userFromCookieHeader } from "../gtr/auth";
import { authUrl, spotifyConfigured } from "../gtr/spotify";

export const Route = createFileRoute("/api/spotify-login")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const u = await userFromCookieHeader(request.headers.get("cookie") ?? "");
        if (!u) return Response.redirect(new URL("/gtr/login", request.url).toString(), 302);
        if (!spotifyConfigured())
          return Response.redirect(
            new URL("/gtr/aimatch?spotify=notready", request.url).toString(),
            302,
          );
        return Response.redirect(await authUrl(u.email), 302);
      },
    },
  },
});
