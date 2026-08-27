// Сторож локализации. Ловит ровно ту ситуацию, из-за которой продукт
// оказался переведён на треть: кто-то дописал русскую строку в t(...)
// и забыл про словарь — а без этого теста об этом узнают только
// пользователи, переключившие язык.
//
// Использует тот же разбор TypeScript, что и scripts/i18n-keys.mjs:
// достаёт литералы из t()/i18n.t() и подписи навигации из app-data.ts,
// сверяет с EN/TH. Расхождение — повод остановить сборку, а не тихо
// показать русский текст в английском интерфейсе.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { EN, TH } from "../i18n-dict";

const CYR = /[А-Яа-яЁё]/;
const ROOT = join(__dirname, "..", "..", "..");

function collectFiles(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && name !== "i18n-dict.ts") out.push(p);
  }
}

function extractKeys(): Set<string> {
  const files: string[] = [];
  collectFiles(join(ROOT, "src"), files);
  const keys = new Set<string>();

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!CYR.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const isTCall = (n: ts.Node): n is ts.CallExpression =>
      ts.isCallExpression(n) &&
      ((ts.isIdentifier(n.expression) && n.expression.text === "t") ||
        (ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "t" &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === "i18n"));

    const visit = (n: ts.Node) => {
      if (isTCall(n)) {
        const a = n.arguments[0];
        if (a && ts.isStringLiteral(a) && CYR.test(a.text)) keys.add(a.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // Подписи навигации показываются через t(переменная) — в литерал
  // внутри t() не попадают, достаём их прицельно из самих таблиц.
  const navSrc = readFileSync(join(ROOT, "src/gtr/data/app-data.ts"), "utf8");
  const navSf = ts.createSourceFile("app-data.ts", navSrc, ts.ScriptTarget.Latest, true);
  for (const st of navSf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const name = d.name.getText();
      if (!/^(NAV_|STAGE_LABEL|ROLE_)/.test(name) || !d.initializer) continue;
      const walk = (n: ts.Node) => {
        if (ts.isStringLiteral(n) && CYR.test(n.text)) keys.add(n.text);
        ts.forEachChild(n, walk);
      };
      walk(d.initializer);
    }
  }

  // Таблицы, которые показываются через t(переменная): категории карты,
  // короткие месяцы кабинета продаж — литералы до t() не доходят,
  // достаём прицельно, как и навигацию.
  for (const [file, names] of [
    ["src/gtr/map-style.ts", /^MAP_CATS$/],
    ["src/gtr/screens/Dash.tsx", /^MONTHS_S$/],
    ["src/routes/gtr/signup.tsx", /^KINDS$/],
  ] as const) {
    const src = readFileSync(join(ROOT, file), "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const walkTables = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && names.test(n.name.getText()) && n.initializer) {
        const grab = (m: ts.Node) => {
          if (ts.isStringLiteral(m) && CYR.test(m.text)) keys.add(m.text);
          ts.forEachChild(m, grab);
        };
        grab(n.initializer);
      }
      ts.forEachChild(n, walkTables);
    };
    walkTables(sf);
  }

  // Данные ночной жизни показываются гостю как есть — значит, обязаны
  // иметь перевод. Новая площадка без перевода уронит сборку, а не
  // покажет русский текст тайцу.
  const night = JSON.parse(readFileSync(join(ROOT, "src/gtr/data/venue-night.json"), "utf8")) as Record<
    string,
    Record<string, string>
  >;
  for (const rec of Object.values(night))
    for (const val of Object.values(rec)) if (typeof val === "string" && CYR.test(val)) keys.add(val);

  return keys;
}

describe("i18n coverage", () => {
  const keys = extractKeys();

  it("нашёл хотя бы что-то (сторож не должен молчать сам по себе)", () => {
    expect(keys.size).toBeGreaterThan(100);
  });

  it("у каждой видимой русской строки есть английский перевод", () => {
    const missing = [...keys].filter((k) => !(k in EN)).sort();
    expect(missing, `нет в EN (${missing.length}):\n${missing.slice(0, 40).join("\n")}`).toEqual([]);
  });

  it("у каждой видимой русской строки есть тайский перевод", () => {
    const missing = [...keys].filter((k) => !(k in TH)).sort();
    expect(missing, `нет в TH (${missing.length}):\n${missing.slice(0, 40).join("\n")}`).toEqual([]);
  });

  // Две проверки выше смотрят только на строки, которые удалось увидеть в
  // коде. Строку, показанную через переменную, разбор не поймает — и она
  // тихо уедет в прод переведённой наполовину. Паритет словарей ловит это
  // независимо от того, нашли мы её вызов или нет: если строку однажды
  // сочли достойной английского, тайский к ней обязан быть тоже.
  it("словари EN и TH держат одинаковый набор ключей", () => {
    const onlyEn = Object.keys(EN).filter((k) => !(k in TH)).sort();
    const onlyTh = Object.keys(TH).filter((k) => !(k in EN)).sort();
    expect(
      { onlyEn, onlyTh },
      `в EN без пары: ${onlyEn.length}, в TH без пары: ${onlyTh.length}\n` +
        [...onlyEn.slice(0, 20), ...onlyTh.slice(0, 20)].join("\n"),
    ).toEqual({ onlyEn: [], onlyTh: [] });
  });
});
