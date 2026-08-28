// Календарь: даты, слои, синхронизация.
//
// Экран открывался на августе 2026-го, потому что месяц и год стояли в
// коде числами, а «сегодня» было прибито к шестому: `year === 2026 &&
// month === 7 ? 6 : -1`. В своём месяце это выглядело почти правильно —
// и именно поэтому держалось так долго. В сентябре продукт показал бы
// август, а подсветка «сегодня» не совпала бы с датой уже 7 августа.
//
// Ещё календарь не знал про брони: три слоя (наши события, черновики,
// афиша) он показывал, а занятость столов — нет. День выглядел свободным,
// когда столы на него уже расписаны.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { bkkToday } from "../afisha-parse";

const src = readFileSync(join(__dirname, "..", "screens", "Calendar.tsx"), "utf8");
const kvApi = readFileSync(join(__dirname, "..", "kv-api.ts"), "utf8");

describe("календарь", () => {
  it("открывается на текущем месяце, а не на зашитом", () => {
    expect(src).toContain("bkkToday()");
    expect(src).toContain("useState(tm - 1)");
    expect(src).toContain("useState(ty)");
    // Прямая улика прошлой поломки: месяц и год числами в useState.
    expect(src).not.toContain("useState(7)");
    expect(src).not.toContain("useState(2026)");
  });

  it("«сегодня» считается по острову и только в своём месяце", () => {
    expect(src).toContain("year === ty && month === tm - 1 ? td : -1");
    expect(src).not.toContain("year === 2026 && month === 7 ? 6 : -1");
  });

  it("дата берётся по Пхукету, а не по Гринвичу", () => {
    // 00:30 понедельника на острове — это ещё воскресенье по UTC, и
    // календарь после полуночи подсвечивал бы вчерашний день.
    const utcEvening = Date.UTC(2026, 7, 30, 17, 30);
    expect(bkkToday(0, utcEvening)).toBe("2026-08-31");
    expect(new Date(utcEvening).toISOString().slice(0, 10)).toBe("2026-08-30");
  });

  it("занятость приходит с сервера и показана в сетке и в дне", () => {
    expect(src).toContain("venueLoadFn");
    expect(src).toContain("dayLoad(n)");
    expect(src).toContain("dayLoad(selDay)");
  });
});

describe("занятость площадки", () => {
  const fn = kvApi.slice(kvApi.indexOf("export const venueLoadFn"));

  it("чужую занятость не отдаём", () => {
    // Сколько столов расписано у соседа — не наше дело: видят команда GTR
    // и та площадка, о которой речь.
    expect(fn).toContain("!TEAM.includes(u.role) && u.venueId !== data.vid");
  });

  it("отклонённая бронь день не занимает", () => {
    expect(fn).toContain('b!.status !== "declined"');
  });

  it("день считает и брони, и гостей", () => {
    expect(fn).toContain("day.total++");
    expect(fn).toContain("day.guests += Number(b.guests)");
  });
});
