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
});
