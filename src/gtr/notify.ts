// Уведомление менеджера GTR о новой заявке организатора.
// Токен и chat-id живут только в окружении и никогда не попадают в клиент:
// весь вызов Telegram происходит на сервере.
//
// Переменные окружения:
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   TELEGRAM_CHAT_ID   — куда слать: id менеджера или группы (для групп он
//                        отрицательный, например -1001234567890)
//
// Если переменных нет или Telegram недоступен, заявка всё равно сохраняется —
// уведомление это доставка, а не условие приёма заявки.
import { createServerFn } from "@tanstack/react-start";
import { getKvNs } from "./kv-ns";

export type NotifyResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "failed"; detail: string };

export type RequestNotice = {
  venueName: string;
  venueId: string;
  organizerName: string;
  organizerContact: string;
  title: string;
  date: string;
  guests: string;
  note: string;
  total: number;
  commission: number;
  lineCount: number;
};

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const thb = (n: number) => "฿" + n.toLocaleString("ru-RU");

const buildMessage = (r: RequestNotice) =>
  [
    "<b>GTR EVENT · новая заявка</b>",
    "",
    `<b>Площадка:</b> ${esc(r.venueName)} (${esc(r.venueId)})`,
    `<b>Формат:</b> ${esc(r.title || "не указан")}`,
    `<b>Когда:</b> ${esc(r.date || "не указана")}`,
    `<b>Гостей:</b> ${esc(r.guests || "не указано")}`,
    "",
    `<b>Организатор:</b> ${esc(r.organizerName || "не представился")}`,
    `<b>Контакт:</b> ${esc(r.organizerContact || "не оставлен")}`,
    r.note ? `<b>Комментарий:</b> ${esc(r.note)}` : "",
    "",
    `<b>Смета:</b> ${r.lineCount} позиций`,
    `<b>Комиссия GTR:</b> ${thb(r.commission)}`,
    `<b>Итого:</b> ${thb(r.total)}`,
    "",
    "<i>Заявка ждёт ответа в кабинете площадки.</i>",
  ]
    .filter((l) => l !== "")
    .join("\n");

export const notifyRequestFn = createServerFn({ method: "POST" })
  .inputValidator((d: RequestNotice) => d)
  .handler(async ({ data }): Promise<NotifyResult> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    // служебный контур: заявка не имеет права уйти в публичный чат комьюнити
    let chatId = process.env.TELEGRAM_CHAT_ID;
    const nsGuard = await getKvNs();
    if (nsGuard && chatId) {
      const { guardInternalChatId } = await import("./community");
      chatId = await guardInternalChatId(nsGuard, chatId);
    }

    if (!token || !chatId) {
      return {
        ok: false,
        reason: "not-configured",
        detail: !token
          ? "TELEGRAM_BOT_TOKEN не задан"
          : "TELEGRAM_CHAT_ID не задан — неизвестно, кому слать",
      };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: buildMessage(data),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        description?: string;
      } | null;

      if (!res.ok || !body?.ok) {
        // description Telegram точнее HTTP-кода: «chat not found», «bot was blocked»
        return {
          ok: false,
          reason: "failed",
          detail: body?.description || `Telegram ответил ${res.status}`,
        };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        reason: "failed",
        detail: e instanceof Error ? e.message : "сеть недоступна",
      };
    }
  });

// Уведомление о назначении заявки на менеджера: короткое, в тот же чат.
// Личные chat-id менеджеров появятся, когда каждый напишет боту /start —
// пока шлём в общий канал GTR.
export const notifyAssignFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      title: string;
      venueName: string;
      date: string;
      guests: string;
      assigneeName: string;
      assigneeEmail: string;
      byName: string;
    }) => d,
  )
  .handler(async ({ data }): Promise<NotifyResult> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    // приоритет — личный чат назначенного менеджера, фолбэк — общий канал
    const ns = await getKvNs();
    const personal = ns ? await ns.get(`tg:${data.assigneeEmail}`) : null;
    const chatId = personal || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId)
      return { ok: false, reason: "not-configured", detail: "Telegram не настроен" };

    const text = [
      "<b>GTR EVENT · заявка назначена</b>",
      "",
      `<b>Заявка:</b> ${esc(data.title || "без названия")}`,
      `<b>Площадка:</b> ${esc(data.venueName)}`,
      data.date ? `<b>Когда:</b> ${esc(data.date)}` : "",
      data.guests ? `<b>Гостей:</b> ${esc(data.guests)}` : "",
      "",
      `<b>Ведёт:</b> ${esc(data.assigneeName)} (${esc(data.assigneeEmail)})`,
      `<i>Назначил: ${esc(data.byName)}</i>`,
    ]
      .filter((l) => l !== "")
      .join("\n");

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!res.ok || !body?.ok)
        return { ok: false, reason: "failed", detail: body?.description || `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "failed", detail: e instanceof Error ? e.message : "сеть" };
    }
  });
