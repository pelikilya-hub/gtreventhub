// Сторож кабинета площадки.
//
// Аккаунт заведения — первый в продукте аккаунт ВНЕШНЕЙ стороны с
// рабочим доступом: не гость и не наш сотрудник. Цена ошибки здесь
// прямая — площадка увидит прайс, контакты и программу конкурента,
// который стоит в соседней бухте. Поэтому изоляция проверяется тестом,
// а не памятью того, кто правил меню в последний раз.
//
// Проверяем три вещи: чего нет в меню, что запрещено матрицей прав и
// что серверные проверки не пускают роль venue туда, где раньше стояло
// «кто угодно, кроме артиста».
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PERMISSIONS, can } from "../auth";
import { NAV_VENUE_CABINET } from "../data/app-data";
import { ROLE_LABELS } from "../kv-api";

const ROOT = join(__dirname, "..", "..", "..");

describe("кабинет площадки", () => {
  it("в меню нет чужой базы, каталога артистов и конструктора", () => {
    const ids = NAV_VENUE_CABINET.map(([id]) => id);
    for (const forbidden of ["base", "artists", "constructor", "vendors", "access", "admin", "outreach", "contacts"])
      expect(ids, `«${forbidden}» не место в кабинете заведения`).not.toContain(forbidden);
  });

  it("в меню есть то, ради чего площадка вообще заходит", () => {
    const ids = NAV_VENUE_CABINET.map(([id]) => id);
    for (const need of ["dash", "calendar", "events", "inquiries", "spaces", "venue"])
      expect(ids).toContain(need);
  });

  it("матрица прав закрывает сеть, финансы и роли", () => {
    for (const key of ["network.view", "network.manage", "finance.view", "roles.manage", "venue.delete"])
      expect(can("venue", key), `право ${key} не должно быть у площадки`).toBe(false);
  });

  it("матрица прав открывает свою программу, заявки и паспорт", () => {
    for (const key of ["dash", "calendar.edit", "inquiries.reply", "venue.edit"])
      expect(can("venue", key), `право ${key} нужно площадке для работы`).toBe(true);
  });

  it("у каждой роли есть явное решение по каждому праву", () => {
    for (const p of PERMISSIONS)
      expect(Object.prototype.hasOwnProperty.call(p.roles, "venue"), `право ${p.key} забыло роль venue`).toBe(true);
  });

  // Серверные проверки писались до появления внешней роли и звучали как
  // «все, кроме артиста». Такая формулировка молча пускает каждую новую
  // роль — ловим её по исходнику, потому что обойти проверку можно
  // только запросом в прод.
  it("серверные проверки не пускают площадку в командный контур", () => {
    const src = readFileSync(join(ROOT, "src/gtr/kv-api.ts"), "utf8");
    for (const fn of ["contactsUsersFn", "createInviteFn"]) {
      const at = src.indexOf(`export const ${fn}`);
      expect(at, `не нашёл ${fn} — тест устарел, поправь ориентир`).toBeGreaterThan(0);
      const body = src.slice(at, at + 900);
      expect(body, `${fn} обязан явно отсекать роль venue`).toContain('role === "venue"');
    }
  });

  it("подтверждения других площадок закрыты", () => {
    const src = readFileSync(join(ROOT, "src/gtr/kv-api.ts"), "utf8");
    const at = src.indexOf("export const venueConfirmsFn");
    const body = src.slice(at, at + 1400);
    expect(body).toContain('me.role === "venue"');
    expect(body, "площадке отдаём только её собственную запись").toContain("me.venueId");
  });

  it("роль площадки подписана человеческим словом", () => {
    expect(ROLE_LABELS.venue).toBe("Площадка");
  });
});
