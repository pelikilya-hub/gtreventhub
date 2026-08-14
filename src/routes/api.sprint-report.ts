// Вечерний отчёт спринта: крон 20:00 Пхукета дёргает этот роут — сводка по
// воронке подтверждений (vconfirm:*) улетает команде в Telegram. Ключ тот же,
// что у афиш (производная от секрета сессий) — роут не публичный.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { getKvNs, kvGetJson, kvListAll } from "../gtr/kv-ns";
import { tgApi, tgConfigured, tgEsc } from "../gtr/tg";
import type { VenueConfirm } from "../gtr/kv-api";

const SPRINT_GOAL = 15;

export const Route = createFileRoute("/api/sprint-report")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key = new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns || !tgConfigured()) return Response.json({ ok: false, reason: "not configured" });

        const keys = await kvListAll(ns, "vconfirm:");
        const list = (
          await Promise.all(keys.map((k) => kvGetJson<VenueConfirm>(ns, k)))
        ).filter((c): c is VenueConfirm => Boolean(c));

        const dayAgo = Date.now() - 24 * 3600e3;
        const confirmed = list.filter((c) => c.status === "confirmed");
        const opened = list.filter((c) => c.status === "opened");
        const today = confirmed.filter((c) => (c.confirmedAt ?? 0) > dayAgo);
        const bySender = new Map<string, { sent: number; conf: number }>();
        for (const c of list) {
          const s = bySender.get(c.sentBy) ?? { sent: 0, conf: 0 };
          s.sent++;
          if (c.status === "confirmed") s.conf++;
          bySender.set(c.sentBy, s);
        }

        const { V } = await import("../gtr/data/app-data");
        const lines = [
          "📊 <b>GTR СПРИНТ · вечерний отчёт</b>",
          "",
          `🎯 Подтверждено: <b>${confirmed.length} / ${SPRINT_GOAL}</b>${today.length ? ` (+${today.length} за сутки)` : ""}`,
          `👀 Открыто, ждёт звонка: ${opened.length}`,
          `📨 Отправлено всего: ${list.length}`,
          "",
          ...[...bySender.entries()].map(
            ([e, s]) => `· ${tgEsc(e.split("@")[0])}: ${s.conf} подтв. из ${s.sent}`,
          ),
        ];
        if (today.length) {
          lines.push("", "<b>За сутки:</b>");
          for (const c of today.slice(0, 6))
            lines.push(
              `✅ ${tgEsc(V(c.vid)?.name ?? c.vid)}${c.rate?.amount ? ` · ฿${c.rate.amount.toLocaleString("ru-RU")}` : ""}`,
            );
        }
        if (!confirmed.length && !opened.length)
          lines.push("", "<i>Движения нет — завтра дожимаем звонками.</i>");
        const text = lines.join("\n");

        // личные чаты команды + общий канал, без дублей
        const tgKeys = await kvListAll(ns, "tg:");
        const chats = new Set<string>();
        for (const k of tgKeys) {
          if (k === "tg:bot") continue;
          const v = await ns.get(k);
          if (v) chats.add(v);
        }
        const common =
          (typeof process !== "undefined" && process.env?.TELEGRAM_CHAT_ID) || "";
        if (common) chats.add(common);
        let sent = 0;
        for (const chat of chats) {
          const r = await tgApi("sendMessage", {
            chat_id: chat,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          });
          if (r.ok) sent++;
        }
        return Response.json({ ok: true, chats: sent, confirmed: confirmed.length });
      },
    },
  },
});
