// Приёмник афиш: пост из канала → событие в календарь площадки.
//
// Главное, что проверяем, — что площадка узнаётся по каналу-источнику,
// когда в тексте её нет. Это тот случай, ради которого приёмник и
// существует: канал «Illuzion Phuket» шлёт «TONIGHT · DJ Snake · 23:00»,
// и без подсказки о канале такой пост заводил мусорный черновик.
import { describe, expect, it } from "vitest";

import { intakePost, pickVenueByName } from "../intake";
import type { KvNs } from "../kv-ns";

function memKv() {
  const store = new Map<string, string>();
  const ns: KvNs = {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
    list: async (o) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(o?.prefix ?? "")).map((name) => ({ name })),
      list_complete: true,
    }),
  };
  return { ns, store };
}

// Дата в будущем, чтобы парсер не отбросил её как прошедшую.
const FUTURE = "25 dec";

describe("приёмник афиш", () => {
  it("площадку из текста узнаёт и кладёт событие в её календарь", async () => {
    const { ns, store } = memKv();
    // Явный маркер площадки в тексте — так её и пишут афиши с адресом.
    const r = await intakePost(
      ns,
      `Sunset Sessions\n📍 Catch Beach Club\n${FUTURE} · DJ Lutang`,
      "личка",
    );
    expect(r.ok).toBe(true);
    expect(r.venueId).toBe("VEN-0001");
    expect(r.venueVia).toBe("text");
    // Событие реально записано в календарь площадки.
    const cal = JSON.parse(store.get("venueevents:VEN-0001")!);
    expect(cal.events.length).toBe(1);
  });

  it("площадку без имени в тексте узнаёт по каналу-источнику", async () => {
    const { ns, store } = memKv();
    // В тексте площадки нет — только дата и лайнап. Канал её называет.
    const r = await intakePost(
      ns,
      `🔥 TONIGHT · ${FUTURE} · DJ Snake · doors 23:00`,
      "Catch Beach Club",
      "Catch Beach Club",
    );
    expect(r.ok).toBe(true);
    expect(r.venueId).toBe("VEN-0001");
    expect(r.venueVia).toBe("channel");
    expect(store.get("venueevents:VEN-0001")).toBeTruthy();
  });

  it("связку канал→площадка запоминает и применяет к следующему посту", async () => {
    const { ns, store } = memKv();
    await intakePost(ns, `party · ${FUTURE} · DJ One`, "Catch Beach Club", "Catch Beach Club");
    // Связка записана.
    expect(store.get("chanmap:catch-beach-club")).toBeTruthy();
    const map = JSON.parse(store.get("chanmap:catch-beach-club")!);
    expect(map.venueId).toBe("VEN-0001");
    // И счётчик находок по каналу растёт — по нему BOSS видит живые каналы.
    const src = JSON.parse(store.get("chansrc:catch-beach-club")!);
    expect(src.n).toBe(1);
  });

  it("без канала и без имени в тексте — честный черновик, а не выдумка", async () => {
    const { ns, store } = memKv();
    const r = await intakePost(ns, `Big night · ${FUTURE} · DJ Nobody`, "личка");
    expect(r.ok).toBe(true);
    expect(r.venueId).toBeUndefined();
    // Событие ждёт в очереди, а не приписано случайной площадке.
    expect([...store.keys()].some((k) => k.startsWith("intakewait:"))).toBe(true);
  });

  it("пост без даты афишей не считается", async () => {
    const { ns } = memKv();
    const r = await intakePost(ns, "Просто болтовня в чате без всякой даты", "Catch Beach Club", "Catch Beach Club");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/дат/);
  });

  it("«личка» подсказкой о площадке не становится", async () => {
    const { ns, store } = memKv();
    // Источник «личка» не должен случайно сматчиться в площадку.
    const r = await intakePost(ns, `Event · ${FUTURE} · DJ X`, "личка", "личка");
    expect(r.venueId).toBeUndefined();
    expect(store.get("chanmap:licka")).toBeFalsy();
  });
});

describe("узнавание площадки по имени", () => {
  // Городской агрегатор подписывает событие названием площадки, а не id.
  // 27.08.2026 на живых данных phuket.net прежний порог отдавал вечер
  // «Pullman Phuket Panwa» отелю «Pullman Phuket Karon» — другой берег
  // острова, — а «The Royal Paradise Hotel» превращался в «Paradise
  // Beach». Приписать вечер соседу хуже, чем не показать его вовсе.
  const base = [
    { id: "VEN-0088", name: "Pullman Phuket Karon Beach Resort" },
    { id: "VEN-0055", name: "Paradise Beach Phuket" },
    { id: "VEN-0013", name: "Illuzion Phuket" },
    { id: "VEN-0047", name: "Barra Cuda Beach Club" },
    { id: "VEN-0051", name: "NORA Beach Club" },
  ];

  it("сетевой отель на другом берегу — не наша площадка", () => {
    expect(pickVenueByName("Pullman Phuket Panwa Beach Resort", base)).toBeNull();
  });

  it("общее слово в названии не делает два места одним", () => {
    expect(pickVenueByName("The Royal Paradise Hotel & Spa Patong Phuket", base)).toBeNull();
  });

  it("точное и вложенное имя по-прежнему узнаются", () => {
    expect(pickVenueByName("NORA Beach Club", base)?.id).toBe("VEN-0051");
    expect(pickVenueByName("Illuzion", base)?.id).toBe("VEN-0013");
    expect(pickVenueByName("Barra Cuda Phuket", base)?.id).toBe("VEN-0047");
  });

  it("название из одних общих слов не привязывается ни к кому", () => {
    expect(pickVenueByName("Beach Club Phuket", base)).toBeNull();
  });
});
