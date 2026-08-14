// Колбэк Spotify: код → токен → топ-артисты → музыкальный профиль в KV
// (mprofile:<email>). Дальше пользователь возвращается в ИИ-подбор, где его
// уже ждут статистика и рекомендации.
import { createFileRoute } from "@tanstack/react-router";

import { getKvNs } from "../gtr/kv-ns";
import { buildProfile, exchangeCode, verifyState } from "../gtr/spotify";

const back = (req: Request, q: string) =>
  Response.redirect(new URL(`/gtr/aimatch?spotify=${q}`, req.url).toString(), 302);

export const Route = createFileRoute("/api/spotify-callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? "";
        if (!code) return back(request, "denied");
        const email = await verifyState(state);
        if (!email) return back(request, "badstate");
        const token = await exchangeCode(code);
        if (!token) return back(request, "tokenfail");
        const profile = await buildProfile(token);
        if (!profile) return back(request, "empty");
        const ns = await getKvNs();
        if (!ns) return back(request, "nokv");
        await ns.put(`mprofile:${email}`, JSON.stringify(profile));
        return back(request, "ok");
      },
    },
  },
});
