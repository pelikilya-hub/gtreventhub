// Крон-сторож мозга BOSS: раз в 15 минут проверяет, что мозгом можно
// пользоваться. Именно пользоваться, а не что он «где-то есть».
//
// Проб две, и вторая появилась не от избытка усердия. /health и
// /v1/models у llama.cpp открыты без авторизации: при разошедшихся
// токенах обе отвечают 200, а любой рабочий запрос получает 401. Сторож,
// смотрящий только на /health, отрапортовал бы «всё хорошо» над мозгом,
// которым продукт не может воспользоваться, — ровно тот тихий отказ,
// ради которого сторож и написан.
import { createFileRoute } from "@tanstack/react-router";

import { afishaKey } from "../gtr/afisha";
import {
  alarmText,
  stepWatch,
  type BrainFail,
  type BrainWatch,
} from "../gtr/bro/brain-watch";
import { addCmd, readQueue, writeQueue } from "../gtr/bro/pult";
import { getKvNs, kvGetJson } from "../gtr/kv-ns";

/** Ключ состояния наблюдения в KV. */
export const WATCH_KEY = "brain:watch";

/** Дедлайн пробы живости. Короткий намеренно: /health отвечает сразу
 *  даже на занятом сервере — он не ждёт очереди инференса. Не ответил за
 *  пять секунд — это не «думает», а «лежит». */
const ALIVE_MS = 5000;

/** Дедлайн рабочей пробы. Здесь уже настоящая генерация, и после простоя
 *  первый ответ медленный: кэш промпта холодный, считает CPU. Берём с
 *  запасом — ложная тревога дороже лишних секунд ожидания крона. */
const WORK_MS = 25_000;

export const Route = createFileRoute("/api/brain-watch")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const key =
          request.headers.get("x-afisha-key") || new URL(request.url).searchParams.get("key");
        if (key !== (await afishaKey())) return new Response("nope", { status: 401 });

        const ns = await getKvNs();
        if (!ns) return Response.json({ ok: false, reason: "no kv" });

        const cfg = await kvGetJson<{ url?: string; token?: string; model?: string }>(
          ns,
          "setting:brain",
        );
        // Мозг не настроен — это не поломка, а выбор: продукт живёт на
        // Gemini. Сторожить нечего, состояние не трогаем.
        if (!cfg?.url) return Response.json({ ok: true, reason: "no brain" });

        const base = cfg.url.replace(/\/$/, "");
        let reason: BrainFail | null = null;
        let detail = "";

        // Проба первая: жив ли вообще. Дёшево, без инференса.
        try {
          const r = await fetch(`${base}/health`, {
            signal: AbortSignal.timeout(ALIVE_MS),
          });
          detail = `health ${r.status}`;
          if (!r.ok) reason = "error";
        } catch (e) {
          reason = "unreachable";
          detail = String(e).slice(0, 120);
        }

        // Проба вторая: пустит ли работать. Одно слово на выходе — этого
        // хватает, чтобы поймать и 401, и сломанную модель, и зависший
        // слот, а слот занят считанные мгновения.
        if (!reason) {
          try {
            const r = await fetch(`${base}/v1/chat/completions`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
              },
              body: JSON.stringify({
                model: cfg.model ?? "qwen3-8b",
                messages: [{ role: "user", content: "ok" }],
                max_tokens: 1,
                stream: false,
              }),
              signal: AbortSignal.timeout(WORK_MS),
            });
            detail = `chat ${r.status}`;
            if (r.status === 401 || r.status === 403) reason = "auth";
            else if (!r.ok) reason = "error";
          } catch (e) {
            // Сюда попадает и таймаут генерации: сервер отвечает на
            // /health, но работать не успевает — для продукта это тот же
            // отказ, дедлайн воркера всего 26 секунд.
            reason = "error";
            detail = String(e).slice(0, 120);
          }
        }

        const now = Date.now();
        const prev = await kvGetJson<BrainWatch>(ns, WATCH_KEY);
        const { next, alarm } = stepWatch(prev, reason, now);
        await ns.put(WATCH_KEY, JSON.stringify(next));

        // Тревога уходит в очередь пульта: этот канал Claude читает по
        // расписанию, и падение перестаёт быть незаметным.
        if (alarm) {
          const queue = await readQueue(ns);
          await writeQueue(ns, addCmd(queue, "сторож", alarmText(alarm, next, now), now));
        }

        return Response.json({ ok: true, reason, detail, alarm, watch: next });
      },
    },
  },
});
