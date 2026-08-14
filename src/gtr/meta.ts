// Meta-ядро: синк публикаций страниц и обмен токенов на долгоживущие.
// Используется и серверными функциями (кнопки BOSS), и кроном — поэтому
// без сессий, только KV.
import type { MetaCfg, MetaPage } from "./kv-api";

type KvNs = {
  get: (k: string) => Promise<string | null>;
  put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void>;
};

export type MetaFeedItem = {
  kind: "fb" | "ig";
  page: string;
  id: string;
  text: string;
  media?: string;
  url?: string;
  ts?: string;
};

const G = "https://graph.facebook.com/v21.0";

export async function metaSyncCore(
  ns: KvNs,
): Promise<{ ok: boolean; count: number; note?: string }> {
  const raw = await ns.get("setting:meta");
  if (!raw) return { ok: false, count: 0, note: "страница не авторизована" };
  const cfg = JSON.parse(raw) as MetaCfg;
  if (!cfg.pages?.length) return { ok: false, count: 0, note: "страница не авторизована" };
  const out: MetaFeedItem[] = [];
  const errs: string[] = [];
  for (const pg of cfg.pages) {
    const posts = await fetch(
      `${G}/${pg.id}/published_posts?fields=id,message,created_time,permalink_url,full_picture&limit=10&access_token=${encodeURIComponent(pg.token)}`,
    )
      .then(
        (r) =>
          r.json() as Promise<{
            data?: { id: string; message?: string; created_time?: string; permalink_url?: string; full_picture?: string }[];
            error?: { message: string };
          }>,
      )
      .catch(() => null);
    if (!posts || posts.error) errs.push(`${pg.name}: ${posts?.error?.message?.slice(0, 80) ?? "недоступна"}`);
    else
      for (const p of posts.data ?? [])
        out.push({
          kind: "fb",
          page: pg.name,
          id: p.id,
          text: (p.message ?? "").slice(0, 300),
          media: p.full_picture,
          url: p.permalink_url,
          ts: p.created_time,
        });
    if (pg.igId) {
      const media = await fetch(
        `${G}/${pg.igId}/media?fields=id,caption,media_url,thumbnail_url,permalink,timestamp&limit=10&access_token=${encodeURIComponent(pg.token)}`,
      )
        .then(
          (r) =>
            r.json() as Promise<{
              data?: { id: string; caption?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string }[];
            }>,
        )
        .catch(() => null);
      for (const m of media?.data ?? [])
        out.push({
          kind: "ig",
          page: pg.name,
          id: m.id,
          text: (m.caption ?? "").slice(0, 300),
          media: m.thumbnail_url ?? m.media_url,
          url: m.permalink,
          ts: m.timestamp,
        });
    }
  }
  await ns.put("metafeed", JSON.stringify({ items: out, syncedAt: Date.now() }));
  return { ok: true, count: out.length, note: errs.join(" · ") || undefined };
}

// Обмен каждого page-токена на долгоживущий (fb_exchange_token).
// У страниц долгоживущие токены фактически бессрочные.
export async function metaExchangeCore(
  ns: KvNs,
  appId: string,
  appSecret: string,
): Promise<{ ok: boolean; note: string }> {
  const raw = await ns.get("setting:meta");
  if (!raw) return { ok: false, note: "сначала подключите страницу" };
  const cfg = JSON.parse(raw) as MetaCfg;
  const notes: string[] = [];
  const pages: MetaPage[] = [];
  for (const pg of cfg.pages ?? []) {
    const j = await fetch(
      `${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(pg.token)}`,
    )
      .then((r) => r.json() as Promise<{ access_token?: string; expires_in?: number; error?: { message: string } }>)
      .catch(() => null);
    if (j?.access_token) {
      pages.push({ ...pg, token: j.access_token });
      notes.push(`${pg.name}: ✓ ${j.expires_in ? Math.round(j.expires_in / 86400) + " дн" : "бессрочный"}`);
    } else {
      pages.push(pg);
      notes.push(`${pg.name}: ${j?.error?.message?.slice(0, 60) ?? "обмен не прошёл"}`);
    }
  }
  await ns.put("setting:meta", JSON.stringify({ pages } satisfies MetaCfg));
  await ns.put("setting:metaapp", JSON.stringify({ appId, appSecret }));
  return { ok: pages.some((p, i) => notes[i].includes("✓")), note: notes.join(" · ") };
}
