// Spotify OAuth и музыкальный профиль. Ключи живут в окружении воркера:
// SPOTIFY_CLIENT_ID (var) и SPOTIFY_CLIENT_SECRET (secret). Пока их нет,
// вход честно отвечает «не настроено» — интерфейс показывает лист ожидания.
export const SPOTIFY_REDIRECT =
  "https://gtr-event-hub.gtr-event.workers.dev/api/spotify-callback";

export type MusicProfile = {
  source: "spotify";
  displayName?: string;
  genres: [string, number][]; // семейство → вес 0..1 (см. match.ts)
  rawGenres: [string, number][]; // сырые жанры Spotify для статистики
  topArtists: { name: string; genres: string[]; image?: string; url?: string }[];
  updatedAt: number;
};

export const spotifyEnv = () => ({
  id: (typeof process !== "undefined" && process.env?.SPOTIFY_CLIENT_ID) || "",
  secret: (typeof process !== "undefined" && process.env?.SPOTIFY_CLIENT_SECRET) || "",
});

export const spotifyConfigured = () => {
  const { id, secret } = spotifyEnv();
  return Boolean(id && secret);
};

// state: email + подпись (HMAC от секрета сессий) — колбэк доверяет только себе
const secretBase = () =>
  (typeof process !== "undefined" && process.env?.GTR_SESSION_SECRET) || "gtr-dev";

export const signState = async (email: string): Promise<string> => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`spotify:${email}:${secretBase()}`),
  );
  const sig = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
  return btoa(`${email}|${sig}`).replace(/=+$/, "");
};

export const verifyState = async (state: string): Promise<string | null> => {
  try {
    const [email] = atob(state).split("|");
    return (await signState(email)) === state ? email : null;
  } catch {
    return null;
  }
};

export const authUrl = async (email: string) => {
  const { id } = spotifyEnv();
  const p = new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT,
    scope: "user-top-read",
    state: await signState(email),
    show_dialog: "false",
  });
  return `https://accounts.spotify.com/authorize?${p.toString()}`;
};

export async function exchangeCode(code: string): Promise<string | null> {
  const { id, secret } = spotifyEnv();
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + btoa(`${id}:${secret}`),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: SPOTIFY_REDIRECT,
    }).toString(),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { access_token?: string };
  return j.access_token ?? null;
}

// Топ-артисты за полгода → профиль вкуса
export async function buildProfile(token: string): Promise<MusicProfile | null> {
  const res = await fetch(
    "https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term",
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as {
    items?: { name: string; genres: string[]; images?: { url: string }[]; external_urls?: { spotify?: string } }[];
  };
  const items = j.items ?? [];
  if (!items.length) return null;
  const { weightedVector } = await import("./match");
  const vec = weightedVector(
    items.map((a, i) => ({ genres: a.genres, weight: 1 - i / items.length })),
  );
  const rawCount = new Map<string, number>();
  for (const a of items) for (const g of a.genres) rawCount.set(g, (rawCount.get(g) ?? 0) + 1);
  const me = await fetch("https://api.spotify.com/v1/me", {
    headers: { authorization: `Bearer ${token}` },
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ display_name?: string }>) : null))
    .catch(() => null);
  return {
    source: "spotify",
    displayName: me?.display_name,
    genres: [...vec.entries()].sort((a, b) => b[1] - a[1]),
    rawGenres: [...rawCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14),
    topArtists: items.slice(0, 12).map((a) => ({
      name: a.name,
      genres: a.genres.slice(0, 3),
      image: a.images?.[2]?.url ?? a.images?.[0]?.url,
      url: a.external_urls?.spotify,
    })),
    updatedAt: Date.now(),
  };
}
