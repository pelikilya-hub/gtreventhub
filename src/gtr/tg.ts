// Telegram Bot API: тонкий помощник для серверного кода (функции и вебхук).
// Токен живёт только в окружении воркера — TELEGRAM_BOT_TOKEN. Если он не
// задан, все вызовы честно отвечают not-configured и ничего не ломают.

export const tgToken = () =>
  (typeof process !== "undefined" && process.env?.TELEGRAM_BOT_TOKEN) || "";

export const tgConfigured = () => Boolean(tgToken());

// Фирменные эмодзи GTR (пак gtrbrand_by_Gtrcom1_bot, создан этим ботом —
// поэтому Telegram разрешает их в сообщениях без Fragment-юзернейма).
// В HTML-текстах обычные эмодзи автоматически становятся фирменными через
// <tg-emoji>; при ошибке отправка повторяется с обычными. В КНОПКАХ
// кастом-эмодзи Telegram не поддерживает ни для кого — там текст как есть.
const BRAND_EMOJI: Record<string, string> = {
  "⚡": "5188392696263256930", "🔻": "5474677289021126610",
  "🎛": "5474373033537873996", "🔥": "5188640868063551904",
  "🤯": "5188526072177663118", "😡": "5188214729998380380",
  "😱": "5188341981289422473", "😂": "5188323371196128736",
  "😢": "5188401457996540599", "😉": "5188559847800480115",
  "🙂": "5188357249898159905", "😍": "5188220970585860978",
  "😊": "5188573256688377570", "😄": "5188466200333558846",
  "😮": "5190799535806388620", "😎": "5188598317822550504",
  "😆": "5190794124147596913", "😘": "5188448754176402388",
  "😠": "5188583208127602197", "😟": "5188303665886176333",
  "😭": "5188167979279360900", "🤔": "5188445133518972322",
  "🥰": "5188517069926214919", "😴": "5188255167115467587",
  "🤩": "5188620419724254571", "😵": "5188181091814513979",
  "🫠": "5188662669317547529", "🙃": "5188521021296122968",
  "😌": "5188572101342178450", "🥴": "5188607569182108331",
  "😝": "5188165110241212178", "💤": "5188259702600936968",
  "😜": "5188204297522815433", "🌀": "5188493834153137441",
  "❤️": "5188350309231011956", "😲": "5188657549716528582",
  "😏": "5188237317231384638", "🥺": "5188179382417532712",
};
const BRAND_EMOJI_RE = new RegExp(
  Object.keys(BRAND_EMOJI)
    .sort((a, b) => b.length - a.length)
    .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
);

export const brandEmojify = (html: string) =>
  html.replace(BRAND_EMOJI_RE, (m) => `<tg-emoji emoji-id="${BRAND_EMOJI[m]}">${m}</tg-emoji>`);

const TEXT_FIELD: Record<string, string> = {
  sendMessage: "text",
  editMessageText: "text",
  sendPhoto: "caption",
  editMessageCaption: "caption",
  sendDocument: "caption",
  sendVideo: "caption",
};

export async function tgApi<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = tgToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN не задан" };
  const call = async (p: Record<string, unknown>) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    });
    return (await res.json()) as { ok: boolean; result?: T; description?: string };
  };
  try {
    const field = TEXT_FIELD[method];
    if (field && params.parse_mode === "HTML" && typeof params[field] === "string" && !String(params[field]).includes("<tg-emoji")) {
      const branded = brandEmojify(params[field] as string);
      if (branded !== params[field]) {
        const r = await call({ ...params, [field]: branded });
        // старые клиенты/ограничения контекста — честный откат к обычным эмодзи
        if (r.ok || !/emoji|entit/i.test(r.description ?? "")) return r;
      }
    }
    return await call(params);
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
