// Возврат от Google: меняем код на личность и впускаем.
//
// Роут файловый, а не серверная функция, потому что сюда браузер
// приходит редиректом с чужого домена — контекста server-fn здесь нет.
// Поэтому и куку ставим строкой заголовка, как это уже сделано у входа
// формой без скрипта.
//
// Порядок проверок: сперва наши (state, кука), потом сеть (обмен кода),
// потом связывание. Каждая ступень отвечает своей ошибкой, и ошибка эта
// доезжает до экрана входа текстом — «что-то пошло не так» на входе
// означает письмо в поддержку и потерянного человека.
import { createFileRoute } from "@tanstack/react-router";

import { exchangeCode } from "../gtr/auth-google";
import { getKvNs } from "../gtr/kv-ns";
import { resolveOrCreate, sessionOf } from "../gtr/identity";

import { OAUTH_COOKIE } from "./api.google-auth";

const COOKIE = "gtr_session";
const WEEK = 60 * 60 * 24 * 7;

/** Кука сессии заголовком: контекста server-fn в файловом роуте нет. */
const sessionCookie = async (user: Parameters<typeof sessionOf>[0]) => {
  const { makeSessionToken } = await import("../gtr/auth");
  const token = await makeSessionToken(sessionOf(user));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${WEEK}; HttpOnly; SameSite=Lax${secure}`;
};

const back = (origin: string, error: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location: `${origin}/gtr/login?err=${encodeURIComponent(error)}`,
      // Одноразовая кука отработала — гасим её при любом исходе, иначе
      // старый state будет валяться до конца своего срока.
      "set-cookie": `${OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });

export const Route = createFileRoute("/api/google-auth-callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const origin = url.origin;

        // Человек нажал «Отмена» на странице Google — это не ошибка, а
        // решение. Возвращаем без страшного текста.
        if (url.searchParams.get("error"))
          return back(origin, "Вход через Google отменён");

        const raw = (request.headers.get("cookie") ?? "").match(
          new RegExp(`(?:^|;\\s*)${OAUTH_COOKIE}=([^;]+)`),
        )?.[1];
        if (!raw) return back(origin, "Вход занял слишком много времени — начните заново");
        let saved: { state?: string; verifier?: string };
        try {
          saved = JSON.parse(decodeURIComponent(raw)) as typeof saved;
        } catch {
          return back(origin, "Не разобрали ответ Google — начните заново");
        }
        if (!saved.state || saved.state !== url.searchParams.get("state"))
          return back(origin, "Ответ Google не совпал с запросом — начните заново");

        const code = url.searchParams.get("code") ?? "";
        if (!code) return back(origin, "Google не прислал код");

        const res = await exchangeCode(origin, code, saved.verifier ?? "");
        if (!res.ok) return back(origin, res.error);

        const ns = await getKvNs();
        if (!ns) return back(origin, "Хранилище аккаунтов недоступно — мы уже чиним");

        const { user, created } = await resolveOrCreate(ns, {
          provider: "google",
          subject: res.profile.sub,
          label: res.profile.email || `google ${res.profile.sub.slice(-6)}`,
          name: res.profile.name,
          email: res.profile.email,
          emailVerified: res.profile.emailVerified,
        });

        if (created) {
          try {
            const { bumpMetric } = await import("../gtr/community");
            await bumpMetric(ns, "reg");
            const { notifyBossTg } = await import("../gtr/kv-api");
            const { tgEsc } = await import("../gtr/tg");
            await notifyBossTg(
              ns,
              `🆕 <b>Регистрация в GTR Event</b>\n${tgEsc(user.name)} · вход через Google · посетитель`,
            );
          } catch {
            /* уведомление не важнее входа */
          }
        }

        const headers = new Headers({ location: `${origin}/gtr/dash` });
        headers.append("set-cookie", await sessionCookie(user));
        headers.append(
          "set-cookie",
          `${OAUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        );
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
