// Отказ мозга — не «проверено, пусто».
//
// askBrain глотал любой отказ и возвращал пустую строку. Прогон не мог
// отличить «модель посмотрела и событий не нашла» от «модель не
// ответила», писал отметку «проверено, найдено 0» и закрывал площадку на
// RECHECK_DAYS. Мозг лежал с 24.08 — и каждый прогон молча вычёркивал по
// две площадки из покрытия ещё на десять дней вперёд. Поломка мозга
// продолжала выедать афишу даже после того, как мозг починят.
import { describe, expect, it } from "vitest";

import { runAfishaLlm } from "../afisha-llm-run";
import type { KvNs } from "../kv-ns";

/** KV в памяти: интересно не хранилище, а что прогон в него записал. */
const memKv = (seed: Record<string, string> = {}) => {
  const store = new Map(Object.entries(seed));
  const ns = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    list: async () => ({ keys: [...store.keys()].map((name) => ({ name })), list_complete: true }),
  } as unknown as KvNs;
  return { ns, store };
};

/** Правдоподобная страница афиши: короче двухсот знаков страница
 *  отбрасывается как заглушка, и до модели дело не доходит. */
const PAGE = `<html><body><h1>Upcoming events</h1>
<p>12 сентября 2026 — Techno Night, вход свободный до полуночи</p>
<p>13 сентября 2026 — Sunset Session с закатным сетом у воды</p>
<p>19 сентября 2026 — Live Band Friday, живой звук весь вечер</p>
<p>20 сентября 2026 — House Saturday, резиденты площадки</p>
<p>26 сентября 2026 — Closing Party сезона, три сцены</p>
</body></html>`;

const BRAIN = JSON.stringify({ url: "https://brain.example", token: "t", model: "qwen3-8b" });

/** Модель зовут только там, где разведчик по ручкам уже сдался. */
const SCOUT_GAVE_UP = {
  "afishasrc:VEN-0003": JSON.stringify({ kind: "none" }), "afishasrc:VEN-0051": JSON.stringify({ kind: "none" }), "afishasrc:VEN-0001": JSON.stringify({ kind: "none" }),
};

describe("прогон разбора афиши", () => {
  it("без настроенного мозга не притворяется, что проверил", async () => {
    const { ns, store } = memKv();
    const r = await runAfishaLlm(ns, 2);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-brain");
    // Главное: ни одной отметки о проверке.
    expect([...store.keys()].filter((k) => k.startsWith("afishallm:"))).toEqual([]);
  });

  it("мозг не ответил — площадка остаётся непроверенной", async () => {
    const { ns, store } = memKv({ "setting:brain": BRAIN, ...SCOUT_GAVE_UP });
    const real = globalThis.fetch;
    // Страницы отдаём, мозг — отказ.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("brain.example")) {
        return new Response("nope", { status: 401 });
      }
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch;
    try {
      const r = await runAfishaLlm(ns, 2);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("brain-unreachable");
      const marks = [...store.keys()].filter((k) => k.startsWith("afishallm:"));
      expect(`отметок о проверке: ${marks.length}`).toBe("отметок о проверке: 0");
    } finally {
      globalThis.fetch = real;
    }
  });
});
