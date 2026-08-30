// Начало входа через Google: уводим на страницу согласия.
//
// Два секрета уезжают в куку и живут десять минут — ровно столько, чтобы
// человек успел выбрать аккаунт и вернуться.
//
// state защищает от подставного возврата: без него злоумышленник может
// подсунуть жертве свой callback-адрес и привязать её браузер к своему
// аккаунту Google. Сверяем то, что вернул Google, с тем, что положили в
// куку сами.
//
// code_verifier (PKCE) защищает сам код: наружу уходит только его хэш,
// и перехвативший код обменять его без верификатора не сможет.
//
// Кука httpOnly и SameSite=Lax: Lax, а не Strict, потому что возврат от
// Google — это переход с чужого домена, и при Strict кука бы не
// приехала. Именно так этот флаг и задуман.
import { createFileRoute } from "@tanstack/react-router";

import { authUrl, googleConfigured, newPkce } from "../gtr/auth-google";

export const OAUTH_COOKIE = "gtr_oauth";
const TTL = 600;

export const Route = createFileRoute("/api/google-auth")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        if (!googleConfigured())
          return Response.redirect(
            `${url.origin}/gtr/login?err=${encodeURIComponent("Вход через Google ещё не подключён")}`,
            302,
          );
        const state = crypto.randomUUID();
        const { verifier, challenge } = await newPkce();
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        const headers = new Headers({
          location: authUrl(url.origin, state, challenge),
          "set-cookie": `${OAUTH_COOKIE}=${encodeURIComponent(
            JSON.stringify({ state, verifier }),
          )}; Path=/; Max-Age=${TTL}; HttpOnly; SameSite=Lax${secure}`,
        });
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
