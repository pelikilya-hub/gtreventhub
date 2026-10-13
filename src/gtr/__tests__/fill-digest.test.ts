// Утренняя сводка конвейера.
//
// Сводка нужна не чтобы отчитаться, а чтобы команда с утра знала, что
// делать. Отсюда две проверки, которые тут важнее остальных.
//
// Первая — движение за сутки. Без него сообщение выглядит каждый день
// одинаково, и через неделю его перестают открывать. Значит, разница со
// вчерашним срезом должна считаться и читаться с одного взгляда.
//
// Вторая — расписание. Крон живёт в двух местах: в wrangler.jsonc его
// объявляет Cloudflare, а в perimeter.ts мы раскладываем строку крона
// по роутам. Разъедутся — крон будет исправно срабатывать и уходить в
// никуда, причём молча. Такое ловится только сверкой файлов.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { movementLine } from "../../routes/api.fill-digest";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("движение за сутки", () => {
  it("показывает и рост, и убыль", () => {
    const now = { "невидима": 40, "на карте": 147, "в списке": 7, "в витрине": 41, "в продаже": 119 };
    const was = { "невидима": 43, "на карте": 144, "в списке": 7, "в витрине": 41, "в продаже": 119 };
    expect(movementLine(now, was)).toBe("−3 невидима, +3 на карте");
  });

  it("нулевые ступени молчат, а не забивают строку", () => {
    // Пять «0» подряд прячут единственную цифру, которая изменилась.
    const same = { "невидима": 1, "на карте": 2, "в списке": 3 };
    expect(movementLine({ ...same, "в продаже": 5 }, { ...same, "в продаже": 4 })).toBe(
      "+1 в продаже",
    );
  });

  it("без вчерашнего среза строки нет вовсе", () => {
    // Первый запуск: сравнивать не с чем, и выдумывать «+354» нельзя.
    expect(movementLine({ "в продаже": 119 }, null)).toBe("");
  });

  it("день без движения — пустая строка, её заменит текст в сводке", () => {
    expect(movementLine({ "в продаже": 119 }, { "в продаже": 119 })).toBe("");
  });
});

describe("расписание доезжает до задачи", () => {
  const wrangler = read("wrangler.jsonc");
  const perimeter = read("src/server/perimeter.ts");

  it("сводка стоит в дневных задачах на 8 утра по Пхукету", () => {
    // Своего крона у неё больше нет: бесплатный тариф Workers даёт пять
    // триггеров на аккаунт, а задач у нас семь. Дневные переехали на тик
    // сторожа — триггер один, задач на нём сколько угодно.
    const plan = read("src/gtr/cron-plan.ts");
    expect(plan).toContain('{ hour: 8, route: "/api/fill-digest"');
  });

  it("триггеров не больше, чем даёт тариф", () => {
    // Выкатка 13.10.2026 упала ровно на этом: Cloudflare принял
    // расписание частично, и какие задачи остались без него — снаружи
    // не видно. Пять — потолок бесплатного тарифа на весь аккаунт.
    const crons = [...wrangler.matchAll(/"((?:[\d*/,-]+ ){4}[\d*/,-]+)"/g)].map((m) => m[1]);
    expect(crons.length).toBeLessThanOrEqual(5);
    expect(crons).toContain("*/15 * * * *");
  });

  it("каждому крону из wrangler есть обработчик", () => {
    // Крон без обработчика срабатывает в пустоту, и это молчаливо.
    // Одно расписание в таблицу не входит намеренно: всё, что не
    // нашлось, уходит в сбор афиш — ветка по умолчанию, и она должна
    // остаться ровно одна.
    const crons = [...wrangler.matchAll(/"((?:[\d*/,-]+ ){4}[\d*/,-]+)"/g)].map((m) => m[1]);
    const unmapped = crons.filter((c) => !perimeter.includes(`"${c}":`));
    expect(unmapped).toEqual(["0 */2 * * *"]);
  });

  it("дневная задача не повторяется в тот же день", () => {
    // Тик каждые пятнадцать минут, задача — раз в сутки. Отметка
    // привязана к пхукетской дате и ставится ДО запуска: сводка обходит
    // всю базу и может идти дольше тика, а два одинаковых отчёта
    // команда примет за норму.
    expect(perimeter).toContain("cronran:");
    const put = perimeter.indexOf("cronran:${j.route}");
    const fetchAfter = perimeter.indexOf(`nitroApp.fetch(new Request(\`\${base}\${j.route}`);
    expect(put).toBeGreaterThan(-1);
    expect(fetchAfter).toBeGreaterThan(put);
  });
});

describe("сводка — внутренняя кухня", () => {
  const src = read("src/routes/api.fill-digest.ts");

  it("закрыта ключом, как остальные кроны", () => {
    expect(src).toContain("afishaKey()");
    expect(src).toContain('status: 401');
  });

  it("список недоделок не уходит в общий канал", () => {
    // Спринт-отчёт шлётся и в TELEGRAM_CHAT_ID; здесь этого быть не должно.
    expect(src).not.toContain("TELEGRAM_CHAT_ID");
  });

  it("срез пишется после отправки, а не до", () => {
    expect(src.indexOf("sendMessage")).toBeLessThan(src.indexOf("ns.put(SNAP_KEY"));
  });
});

describe("отбор дневных задач", () => {
  // Час по Пхукету = UTC+7. Берём фиксированный момент, чтобы тест не
  // зависел от того, когда его запустили.
  const atBkkHour = (h: number) => Date.parse("2026-10-13T00:00:00Z") + (h - 7) * 3600e3;

  it("до назначенного часа задача не берётся", async () => {
    const { dueJobs } = await import("../cron-plan");
    // 07:00 по Пхукету: сводка в 8 ещё не наступила.
    const due = dueJobs(new Set(), atBkkHour(7));
    expect(due.map((j) => j.route)).not.toContain("/api/fill-digest");
  });

  it("после часа — берётся", async () => {
    const { dueJobs } = await import("../cron-plan");
    const due = dueJobs(new Set(), atBkkHour(8));
    expect(due.map((j) => j.route)).toContain("/api/fill-digest");
  });

  it("уже выполненная сегодня не берётся снова", async () => {
    // Тик приходит каждые пятнадцать минут — без этой проверки команда
    // получала бы один и тот же отчёт четыре раза в час.
    const { dueJobs } = await import("../cron-plan");
    const due = dueJobs(new Set(["/api/fill-digest"]), atBkkHour(9));
    expect(due.map((j) => j.route)).not.toContain("/api/fill-digest");
  });

  it("пропущенный тик не съедает задачу на сутки", async () => {
    // Крон «ровно в 08:00» давал одну попытку в день. Здесь задача
    // подхватится любым следующим тиком — хоть в 19:00.
    const { dueJobs } = await import("../cron-plan");
    const due = dueJobs(new Set(), atBkkHour(19));
    expect(due.map((j) => j.route)).toContain("/api/fill-digest");
  });

  it("поздняя задача не выполняется раньше срока", async () => {
    // Вечерний отчёт спринта в 20:00 не должен уехать утром.
    const { dueJobs } = await import("../cron-plan");
    expect(dueJobs(new Set(), atBkkHour(9)).map((j) => j.route)).not.toContain("/api/sprint-report");
    expect(dueJobs(new Set(), atBkkHour(20)).map((j) => j.route)).toContain("/api/sprint-report");
  });
});
