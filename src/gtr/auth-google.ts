// Вход через Google.
//
// Нужен тем, у кого нет Telegram, — это в основном туристы из Европы и
// Америки, то есть ровно те гости, ради которых площадки с нами и
// работают. Для них «войти через Google» — привычный жест, а придумать
// очередной пароль — повод закрыть вкладку.
//
// Работаем по authorization code flow с PKCE. Это тот же протокол, что
// у входа в Spotify, который в продукте уже живёт, но с одним важным
// отличием: там нам нужен доступ к чужому API, а здесь — только личность.
// Личность приезжает в id_token, и это меняет требования к проверке.
//
// Подпись id_token мы не проверяем, и это не упущение. Токен приходит не
// из браузера, а нашим собственным запросом к token endpoint Google по
// TLS, в обмен на одноразовый код и секрет клиента. Подменить ответ на
// этом канале — значит подменить сам Google. Спецификация OpenID Connect
// (§3.1.3.7) прямо разрешает пропустить проверку подписи в этом случае.
// Проверять RS256 через JWKS пришлось бы ради канала, который уже
// защищён, — и добавить в вход ещё одну сетевую зависимость.
//
// Что проверяем обязательно: aud — токен выписан нам, а не соседнему
// приложению; exp — не просрочен; email_verified — Google действительно
// проверил адрес. Последнее важнее всего: непроверенный адрес нельзя
// связывать с существующим аккаунтом (см. identity.ts).

const clientId = () =>
  (typeof process !== "undefined" && process.env?.GOOGLE_CLIENT_ID) || "";
const clientSecret = () =>
  (typeof process !== "undefined" && process.env?.GOOGLE_CLIENT_SECRET) || "";

/** Настроен ли вход. Экран входа спрашивает это, чтобы не показывать
 *  кнопку, которая приведёт на страницу ошибки Google. */
export const googleConfigured = (): boolean => Boolean(clientId() && clientSecret());

/** Адрес возврата. Он же прописывается в консоли Google — расхождение
 *  хотя бы в одном символе даёт redirect_uri_mismatch, и это первая
 *  причина, по которой вход «не работает» после настройки. */
export const redirectUri = (origin: string) => `${origin}/api/google-auth-callback`;

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Пара PKCE. Верификатор остаётся у нас в куке, наружу уходит только
 *  его хэш — перехвативший код без верификатора обменять его не сможет. */
export const newPkce = async () => {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge };
};

export const authUrl = (origin: string, state: string, challenge: string): string => {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(origin),
    response_type: "code",
    // Только личность: доступа к почте, диску и контактам мы не просим.
    // Лишняя область в этом окне — причина, по которой человек жмёт
    // «отмена», и мы её не даём.
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH}?${p}`;
};

export type GoogleProfile = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

/** Разбор id_token без проверки подписи — см. объяснение в шапке.
 *  Отделено от сети, чтобы проверять правила разбора тестами. */
export const parseIdToken = (
  idToken: string,
  expectAud: string,
  now = Date.now(),
): { ok: true; profile: GoogleProfile } | { ok: false; error: string } => {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) return { ok: false, error: "Google прислал непонятный токен" };
  let c: Record<string, unknown>;
  try {
    // atob отдаёт байты, а не текст. Имя «Фёдор» в токене лежит в UTF-8,
    // и без декодера оно приезжает как «Ð¤Ñ‘Ð´Ð¾Ñ€» — то есть человек
    // видит в своём кабинете кракозябры вместо собственного имени.
    const bin = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    c = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Google прислал непонятный токен" };
  }
  const aud = String(c.aud ?? "");
  // Токен, выписанный другому приложению, — это чужой токен. Без этой
  // проверки любой, у кого есть свой проект в Google, вошёл бы к нам
  // под чужим sub.
  if (!aud || aud !== expectAud) return { ok: false, error: "Токен выписан не нам" };
  const iss = String(c.iss ?? "");
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com")
    return { ok: false, error: "Токен выписан не Google" };
  const exp = Number(c.exp ?? 0) * 1000;
  if (!exp || exp < now) return { ok: false, error: "Токен Google просрочен" };
  const sub = String(c.sub ?? "");
  if (!sub) return { ok: false, error: "Google не назвал пользователя" };
  return {
    ok: true,
    profile: {
      sub,
      email: c.email ? String(c.email) : undefined,
      // Google отдаёт это поле то строкой, то булевым — приводим сами.
      emailVerified: c.email_verified === true || c.email_verified === "true",
      name: c.name ? String(c.name) : undefined,
      picture: c.picture ? String(c.picture) : undefined,
    },
  };
};

/** Обмен кода на токен и разбор личности. */
export const exchangeCode = async (
  origin: string,
  code: string,
  verifier: string,
): Promise<{ ok: true; profile: GoogleProfile } | { ok: false; error: string }> => {
  if (!googleConfigured()) return { ok: false, error: "Вход через Google не настроен" };
  let r: Response;
  try {
    r = await fetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri(origin),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, error: `Google недоступен: ${(e as Error).message}` };
  }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false, error: `Google отказал (${r.status}) ${t.slice(0, 140)}` };
  }
  const j = (await r.json().catch(() => ({}))) as { id_token?: string };
  if (!j.id_token) return { ok: false, error: "Google не прислал личность" };
  return parseIdToken(j.id_token, clientId());
};
