// Блок «Вход и аккаунты»: роли, срок сессии, судьба отклонённой заявки.
//
// Три разные беды с одной общей чертой: каждая молчит. Таблица прав не
// говорит, что показывает не все роли; сессия не говорит, почему
// закончилась; отказ по заявке не говорит вообще ничего. Молчащая
// ошибка живёт месяцами, потому что о ней некому сообщить — человек
// решает, что так и задумано, и уходит.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "../auth";
import { ROLES, type RoleId } from "../data/app-data";
import { ROLE_LABELS } from "../kv-api";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("таблица прав показывает все роли", () => {
  it("в списке ролей столько же строк, сколько ролей в продукте", () => {
    // Прямая улика прошлой поломки: ролей было восемь, в таблице шесть.
    // «Площадка» и «Посетитель» существовали, имели права и кабинет —
    // но колонки в таблице у них не было.
    expect(ROLES.length).toBe(Object.keys(ROLE_LABELS).length);
  });

  it("каждая роль продукта есть в таблице", () => {
    const inTable = new Set(ROLES.map(([id]) => id));
    for (const id of Object.keys(ROLE_LABELS) as RoleId[])
      expect(inTable.has(id), `нет колонки для роли ${id}`).toBe(true);
  });

  it("площадка в таблице есть и права у неё непустые", () => {
    // Если бы у роли не было ни одного права, отсутствие колонки было
    // бы простительно. Права есть — значит колонка обязательна.
    expect(ROLES.some(([id]) => id === "venue")).toBe(true);
    expect(PERMISSIONS.filter((p) => p.roles.venue).length).toBeGreaterThan(0);
  });

  it("у каждого права проставлены все роли без пропусков", () => {
    // Пропущенная роль в матрице читается как false и тихо закрывает
    // доступ там, где его никто не закрывал.
    for (const p of PERMISSIONS)
      for (const [id] of ROLES)
        expect(typeof p.roles[id], `${p.key} × ${id}`).toBe("boolean");
  });

  it("ширина таблицы считается по числу ролей, а не написана числом", () => {
    // Захардкоженная шестёрка пережила добавление двух ролей и молча их
    // сплющила бы, даже когда колонки появились.
    const src = read("screens/Misc.tsx");
    expect(src).toContain("repeat(${ROLES.length}");
    expect(src).not.toContain('"2fr repeat(6, minmax(76px,1fr))"');
  });
});

describe("сессия продлевается, пока человек ею пользуется", () => {
  const src = read("auth.ts");

  it("загрузчик экрана переиздаёт куку на второй половине срока", () => {
    // Без этого гость, открывающий афишу каждый вечер, всё равно
    // вылетает раз в неделю и видит экран входа без всякой причины.
    expect(src).toContain("found.exp - Date.now() < (WEEK * 1000) / 2");
    expect(src).toContain("await issueSession(found.user)");
  });

  it("срок по-прежнему конечен: забытая вкладка выходит сама", () => {
    // Скользящий срок продлевает сессию живого человека, а не вечную.
    expect(src).toContain("const WEEK = 60 * 60 * 24 * 7");
    expect(src).toContain("if (data.exp < Date.now()) return null");
  });

  it("подпись сессии по-прежнему одна на весь продукт", () => {
    // Вторая реализация makeToken разошлась бы с этой и обнулила часть
    // сессий молча.
    expect(src.match(/const makeToken = /g)?.length ?? 0).toBe(1);
  });
});

describe("отклонённая заявка перестала быть тупиком", () => {
  const auth = read("auth.ts");
  const api = read("kv-api.ts");

  it("отказ оставляет след в хранилище", () => {
    expect(api).toContain("`rejected:${email}`");
    expect(api).toContain("expirationTtl: 60 * 60 * 24 * 90");
  });

  it("вход называет причину, а не «неверный пароль»", () => {
    // Общий текст про пароль заставлял человека до бесконечности
    // вспоминать пароль от аккаунта, которого не существует.
    const i = auth.indexOf("rejected:");
    expect(i).toBeGreaterThan(-1);
    expect(auth.slice(i, i + 600)).toContain("отклонена");
  });

  it("новая заявка снимает след отказа", () => {
    // Иначе вход говорил бы «отклонена», пока новая заявка на столе.
    expect(api).toContain("await ns.delete(`rejected:${email}`)");
  });

  it("одобрение тоже снимает след", () => {
    // Человек мог получить отказ раньше и быть принят позже.
    const i = api.indexOf("invitedBy: \"apply\"");
    expect(api.slice(i, i + 500)).toContain("rejected:");
  });

  it("оба исхода попадают в счётчик входов", () => {
    // Иначе «ко мне не пускает» и «я отклонён» снаружи неотличимы.
    expect(auth).toContain('countLogin(`pending${channel}`)');
    expect(auth).toContain('countLogin(`rejected${channel}`)');
  });
});
