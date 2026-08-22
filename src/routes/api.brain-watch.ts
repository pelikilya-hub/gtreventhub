// Крон-сторож мозга BOSS: раз в 15 минут спрашивает у сервера, жив ли он.
//
// Пробуем /health без токена и намеренно дёшево: инференс не запускаем,
// слот не занимаем. Задача сторожа — заметить молчание, а не измерить
// качество ответов; для настоящей проверки с токеном есть pult.brainTest.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import { alarmText, stepWatch, type BrainWatch } from "../gtr/bro/brain-watch";
import { addCmd, readQueue, writeQueue } from "../gtr/bro/pult";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

/** Ключ состояния наблюдения в KV. */
export const WATCH_KEY = "brain:watch";

/** Дедлайн пробы. Короткий намеренно: /health отвечает сразу даже на
 *  занятом сервере — он не ждёт очереди инференса. Если не ответил за
 *  пять секунд, это не «думает», а «лежит». */
const PROBE_MS = 5000;

export const Route = createFileRoute("/api/brain-watch")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") || new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });

        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });

        const cfg = await kvGetJson<{ url?: string }>(ns, "setting:brain");
        // Мозг не настроен — это не поломка, а выбор: продукт живёт на
        // Gemini. Сторожить нечего, состояние не трогаем.
        if (!cfg?.url) return Response.json({ ok: true, reason: "no brain" });

        let probeOk = false;
        let detail = "";
        try {
          const r = await fetch(`${cfg.url.replace(/\/$/, "")}/health`, {
            signal: AbortSignal.timeout(PROBE_MS),
          });
          probeOk = r.ok;
          detail = String(r.status);
        } catch (e) {
          detail = String(e).slice(0, 120);
        }

        const now = Date.now();
        const prev = await kvGetJson<BrainWatch>(ns, WATCH_KEY);
        const { next, alarm } = stepWatch(prev, probeOk, now);
        await ns.put(WATCH_KEY, JSON.stringify(next));

        // Тревога уходит в очередь пульта: этот канал Claude читает по
        // расписанию, и падение перестаёт быть незаметным.
        if (alarm) {
          const queue = await readQueue(ns);
          await writeQueue(ns, addCmd(queue, "сторож", alarmText(alarm, next, now), now));
        }

        return Response.json({ ok: true, probeOk, detail, alarm, watch: next });
      },
    },
  },
});
