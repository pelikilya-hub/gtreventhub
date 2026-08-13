// Telegram Bot API: тонкий помощник для серверного кода (функции и вебхук).
// Токен живёт только в окружении воркера — TELEGRAM_BOT_TOKEN. Если он не
// задан, все вызовы честно отвечают not-configured и ничего не ломают.

export const tgToken = () =>
  (typeof process !== "undefined" && process.env?.TELEGRAM_BOT_TOKEN) || "";

export const tgConfigured = () => Boolean(tgToken());

export async function tgApi<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = tgToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN не задан" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : "сеть" };
  }
}

// Секрет вебхука: производная от секрета сессий — Telegram шлёт его в
// заголовке, чужие POST на /api/tg отбрасываются
export async function tgWebhookSecret(): Promise<string> {
  const base =
    (typeof process !== "undefined" && process.env?.GTR_SESSION_SECRET) || "gtr-dev";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`tg-webhook:${base}`),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 48);
}

export const tgEsc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
