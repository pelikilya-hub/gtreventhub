// Пустой экран обязан предлагать следующий шаг.
//
// Сквозной обход продукта всеми восемью ролями показал один и тот же
// изъян в шести местах: экран, на котором ничего нет, честно сообщал об
// этом — и на этом заканчивался. Гость нажимал «События», читал «афиши
// обновляются каждые шесть часов» и упирался в стену: ни кнопки, ни
// ссылки. Формально экран отработал верно, практически это тупик.
//
// Отдельно — заявки организаторов. Под живым списком стояла вторая
// карточка с заявками из таблицы в коде: выдуманные строки выглядели как
// настоящие, а кнопка «Ответить» под ними только меняла свою подпись.
// Ни ответа, ни уведомления, ни следа в базе.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const screens = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, "screens"));
  return out;
})();

describe("пустые состояния", () => {
  it("у гостя «События» есть выход на карту и на «Сегодня»", () => {
    // Самый заметный тупик: пункт меню номер три у посетителя и артиста.
    const src = read("screens/Platform.tsx");
    const feed = src.slice(src.indexOf("export function FeedScreen"), src.indexOf("export function AiMatchScreen"));
    expect(feed).toContain("<Empty");
    expect(feed).toContain('to: "tonight"');
    expect(feed).toContain('to: "map"');
    expect(feed).not.toContain("Афиши обновляются каждые 6 часов — загляните позже.");
  });

  it("календарь не советует конструктор без дороги в него", () => {
    const src = read("screens/Calendar.tsx");
    expect(src).toContain('{ label: "Открыть конструктор", to: "constructor", primary: true }');
    expect(src).not.toContain("На этот день наших событий нет — создайте в конструкторе.");
  });

  it("артист без предложений видит, чем это исправить", () => {
    const src = read("screens/Platform.tsx");
    expect(src).toContain('title="Предложений пока нет"');
    expect(src).toContain('to: "aimatch"');
  });

  it("пустой центр связи отличает «не нашлось» от «ещё некого искать»", () => {
    // Разница не косметическая: в первом случае правят запрос, во втором
    // заводят людей — и это разные кнопки.
    const src = read("screens/Contacts.tsx");
    expect(src).toContain("q.trim() ?");
    expect(src).toContain('to: "access"');
  });
});

describe("заявки организаторов", () => {
  const src = read("screens/Misc.tsx");
  const inq = src.slice(src.indexOf("export function InquiriesScreen"), src.indexOf("export function SpacesScreen"));

  it("демо-заявок из таблицы в коде больше нет", () => {
    // inqOf(vid) отдавал выдуманные строки из INQ. Рядом с настоящими
    // входящими их было не отличить.
    expect(inq).not.toContain("inqOf(");
    expect(src).not.toContain("  inqOf,");
  });

  it("кнопки, которая только меняет свою подпись, больше нет", () => {
    expect(inq).not.toContain("setReplied");
    expect(inq).not.toMatch(/replied\.includes/);
  });

  it("настоящие заявки по-прежнему принимаются и отклоняются", () => {
    // Живой контур не должен пострадать от уборки демонстрационного.
    expect(inq).toContain("acceptRequest(r.id, r.title)");
    expect(inq).toContain('updateRequest(r.id, { status: "declined" })');
  });

  it("пустой список объясняет, откуда берутся заявки", () => {
    expect(inq).toContain("!incoming.length");
    expect(inq).toContain("<Empty");
    expect(inq).toContain("/gtr/organizer");
  });
});

describe("сторож пустых состояний", () => {
  it("каждый <Empty> даёт хотя бы один выход", () => {
    // Компонент допускает actions={[]} — это законно для панели внутри
    // экрана, где выход рядом. Но экранного тупика быть не должно, и
    // проще держать правило одним: выход есть всегда.
    for (const file of screens) {
      const src = readFileSync(file, "utf8");
      let i = src.indexOf("<Empty");
      while (i !== -1) {
        const chunk = src.slice(i, src.indexOf("/>", i) + 2);
        expect(chunk.includes("actions="), `${file}: <Empty> без выхода`).toBe(true);
        i = src.indexOf("<Empty", i + 1);
      }
    }
  });

  it("сторож переводов видит строки внутри <Empty>", () => {
    // Компонент переводит title/text/label сам, поэтому в t() литералы
    // не попадают — без этой ветки они уехали бы в прод по-русски.
    const guard = read("__tests__/i18n-coverage.test.ts");
    expect(guard).toContain('src.includes("<Empty")');
    expect(guard).toContain('open.tagName.getText() === "Empty"');
  });
});
