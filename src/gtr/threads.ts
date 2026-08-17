// Публикация в Threads.
//
// Threads даёт официальный API от Meta, но он живёт отдельно от Graph
// API страниц: свой домен graph.threads.net, свой токен, привязанный к
// профилю Threads, и свои права (threads_basic, threads_content_publish).
// Токен страницы Facebook здесь не работает — это отдельное подключение.
//
// Публикация в два шага: сначала создаётся контейнер поста, потом он
// публикуется. Один шаг вместо двух Meta не принимает, а между ними
// нужна короткая пауза — свежесозданный контейнер не всегда готов сразу.
import { kvGetJson, type KvNs } from "./kv-ns";

export const THREADS_KEY = "setting:threads";

export type ThreadsCfg = {
  userId: string;
  username?: string;
  token: string;
  /** Когда истекает: долгоживущий токен Threads живёт 60 дней и требует
   *  продления. Дата хранится, чтобы напомнить до, а не после. */
  expiresAt?: number;
  savedAt: number;
};

const API = "https://graph.threads.net/v1.0";

/** Проверка токена: заодно достаём id и ник профиля. */
export const threadsMe = async (
  token: string,
): Promise<{ ok: true; id: string; username?: string } | { ok: false; reason: string }> => {
  try {
    const r = await fetch(`${API}/me?fields=id,username&access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const d = (await r.json()) as { id?: string; username?: string; error?: { message?: string } };
    if (!d.id) return { ok: false, reason: d.error?.message ?? "Threads не принял токен" };
    return { ok: true, id: d.id, username: d.username };
  } catch {
    return { ok: false, reason: "Threads не ответил" };
  }
};

/** Пост в Threads. imageUrl — публичная ссылка на картинку: Meta забирает
 *  её сама, загрузка файлом в этом API не предусмотрена. */
export const threadsPost = async (
  cfg: ThreadsCfg,
  text: string,
  imageUrl?: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
  const body = new URLSearchParams({
    access_token: cfg.token,
    media_type: imageUrl ? "IMAGE" : "TEXT",
    text: text.slice(0, 500),
  });
  if (imageUrl) body.set("image_url", imageUrl);
  try {
    const c = await fetch(`${API}/${cfg.userId}/threads`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(12_000),
    });
    const cd = (await c.json()) as { id?: string; error?: { message?: string } };
    if (!cd.id) return { ok: false, reason: cd.error?.message ?? "контейнер не создан" };

    // Пауза перед публикацией: контейнер с картинкой Meta готовит не
    // мгновенно, и публикация «сразу» отвечает ошибкой готовности.
    await new Promise((r) => setTimeout(r, imageUrl ? 4000 : 800));

    const p = await fetch(`${API}/${cfg.userId}/threads_publish`, {
      method: "POST",
      body: new URLSearchParams({ access_token: cfg.token, creation_id: cd.id }),
      signal: AbortSignal.timeout(12_000),
    });
    const pd = (await p.json()) as { id?: string; error?: { message?: string } };
    if (!pd.id) return { ok: false, reason: pd.error?.message ?? "пост не опубликован" };
    return { ok: true, id: pd.id };
  } catch {
    return { ok: false, reason: "Threads не ответил" };
  }
};

/** Настройка из KV — публикация молча пропускается, если не подключено. */
export const threadsCfg = (ns: KvNs) => kvGetJson<ThreadsCfg>(ns, THREADS_KEY);

/** Дайджест под Threads: там нет разметки и жёсткий лимит в 500 знаков,
 *  поэтому HTML-версию телеграма переиспользовать нельзя. */
export const threadsDigest = (
  lines: string[],
  appUrl: string,
): string => {
  const clean = lines
    .map((l) => l.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
  const body: string[] = [];
  let used = 0;
  const tail = `\n\nВся афиша: ${appUrl}/gtr/tonight`;
  for (const l of clean) {
    if (used + l.length + 1 > 500 - tail.length) break;
    body.push(l);
    used += l.length + 1;
  }
  return body.join("\n") + tail;
};
