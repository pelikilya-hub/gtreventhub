// Утренняя сводка конвейера: крон 08:00 Пхукета дёргает этот роут, и
// команда получает в Telegram не «надо наполнять», а конкретный список
// на смену.
//
// Замер показал, зачем это нужно: из 354 площадок 43 гость не видит
// вовсе, у 179 нет главного фото, у 127 некому передать заявку. Работа
// известна давно, но живёт в отчёте, который надо пойти и открыть.
// Сводка приносит её туда, где команда и так с утра.
//
// Три вещи в сообщении, и все три — не украшение:
//
// 1. Движение за сутки. Вчерашний срез лежит в KV, сегодняшний
//    сравнивается с ним. Без этой строки сводка каждый день выглядит
//    одинаково и через неделю её перестают читать.
// 2. Двадцать площадок на смену — начало очереди, где шаг дешевле
//    всего. Не «вот вам 235 недоделок», а работа на день.
// 3. У каждой строки — что именно закрыть. Не список пробелов, а один
//    шаг: у площадки без координаты и без галереи шаг один — координата.
//
// Ключ тот же, что у остальных кронов (производная от секрета сессий):
// роут не публичный, наружу торчать ему незачем.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { getKvNs, kvGetJson, kvListAll } from "../gtr/kv-ns";
import { tgApi, tgConfigured, tgEsc } from "../gtr/tg";
import { FILL_FIELDS, FILL_LEVELS, fillQueue, fillSummary } from "../gtr/venue-fill";
import type { FillKey, FillLevel } from "../gtr/venue-fill";
import { buildFillRows } from "../gtr/venue-rows";

/** Ключ вчерашнего среза. Один на всю базу: нам нужна не история, а
 *  разница со вчера. */
const SNAP_KEY = "fillsnap:last";

type Snap = { at: number; summary: Record<string, number> };

const LABEL = new Map(FILL_FIELDS.map((f) => [f.key as FillKey, f.label]));

/** Строка движения: «+3 в списке, −1 невидима» и ничего, если ноль.
 *  Молчание тут честнее нулей: нулями строка забивается так, что в ней
 *  не видно единственной цифры, которая изменилась. */
export const movementLine = (
  now: Record<string, number>,
  was: Record<string, number> | null,
): string => {
  if (!was) return "";
  const parts: string[] = [];
  for (const level of FILL_LEVELS) {
    const d = (now[level] ?? 0) - (was[level] ?? 0);
    if (d) parts.push(`${d > 0 ? "+" : "−"}${Math.abs(d)} ${level}`);
  }
  return parts.join(", ");
};

export const Route = createFileRoute("/api/fill-digest")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key = new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });
        const ns = await getKvNs();
        if (!ns || !tgConfigured()) return Response.json({ ok: false, reason: "not configured" });

        const rows = await buildFillRows(ns, { kvListAll, kvGetJson });
        const summary = fillSummary(rows);
        const queue = fillQueue(rows);
        const was = await kvGetJson<Snap>(ns, SNAP_KEY);
        const moved = movementLine(summary, was?.summary ?? null);

        const shift = queue.slice(0, 20);
        const lines = [
          "🏗 <b>КОНВЕЙЕР · смена</b>",
          "",
          `В продаже: <b>${summary["в продаже" as FillLevel] ?? 0}</b> из ${rows.length}`,
          `В очереди: ${queue.length}`,
          moved ? `За сутки: ${tgEsc(moved)}` : "За сутки: без движения",
          "",
          `<b>Сегодня — ${shift.length}:</b>`,
          ...shift.map((r) => {
            const what = r.gaps.length
              ? [...new Set(r.gaps.slice(0, 3).map((g) => LABEL.get(g) ?? g))].join(", ")
              : "";
            return `· ${tgEsc(r.name)} — ${tgEsc(what)}`;
          }),
        ];
        if (!shift.length)
          lines.push("<i>Очередь пуста — вся база доведена до продажи.</i>");

        // Список недоделок — внутренняя кухня. Шлём только в служебные
        // чаты команды, не в общий канал: там его читать некому.
        const chats = new Set<string>();
        for (const k of await kvListAll(ns, "tg:")) {
          if (k === "tg:bot") continue;
          const v = await ns.get(k);
          if (v) chats.add(v);
        }
        const text = lines.join("\n");
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

        // Срез пишем после отправки: не доехало — пусть завтра сравнится
        // с позавчерашним, это честнее, чем потерять сутки движения.
        await ns.put(SNAP_KEY, JSON.stringify({ at: Date.now(), summary } satisfies Snap));

        return Response.json({ ok: true, chats: sent, queue: queue.length, moved });
      },
    },
  },
});
