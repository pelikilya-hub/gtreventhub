// Кодмод: подписи КАПСОМ проводим через t().
//
// В продукте прижилась манера писать служебные подписи заглавными —
// «КОНЦЕПЦИЯ», «ВМЕСТИМОСТЬ», «ЛУЧШИЕ ВЕЧЕРА». Они лежат в массивах
// пар «подпись — значение», куда прошлый кодмод не заглядывал: он
// работал по JSX. В результате англоязычный гость видел английские
// заголовки карточек и русские подписи полей внутри них.
//
// Берём только строки целиком заглавными: в этом коде идентификаторы и
// ключи сравнения пишутся латиницей в нижнем регистре, поэтому капс —
// надёжный признак того, что строка едет на экран. Сравнения, ключи
// объектов, импорты и case-метки не трогаем ни при каких условиях.
//
// Запуск: node scripts/i18n-wrap-caps.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import ts from "typescript";

const DRY = process.argv.includes("--dry");
// строка целиком заглавными, минимум три кириллические буквы
const CAPS = /^[А-ЯЁ0-9][А-ЯЁ0-9 ,./·✓+—–-]*$/;
const enough = (s) => (s.match(/[А-ЯЁ]/g) || []).length >= 3;

const files = globSync("src/gtr/**/*.tsx", { cwd: process.cwd() }).filter(
  (f) => !f.includes("__tests__"),
);

let total = 0;
const found = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!/[А-ЯЁ]/.test(src)) continue;
  // t() должен быть в области видимости: иначе кодмод сломает файл
  if (!/useTranslation\(/.test(src)) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  const skip = (n) => {
    const p = n.parent;
    if (!p) return true;
    // сравнения, ключи объектов, case-метки, импорты, уже обёрнутое
    if (ts.isBinaryExpression(p)) return true;
    if (ts.isPropertyAssignment(p) && p.name === n) return true;
    if (ts.isCaseClause(p)) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "t") return true;
    if (ts.isComputedPropertyName(p)) return true;
    return false;
  };

  const visit = (n) => {
    if (ts.isStringLiteral(n) && CAPS.test(n.text) && enough(n.text) && !skip(n)) {
      edits.push({ start: n.getStart(sf), end: n.getEnd(), text: n.text });
      found.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  if (!edits.length) continue;
  let out = src;
  // с конца к началу, чтобы смещения не поехали
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + `t("${e.text}")` + out.slice(e.end);
  }
  total += edits.length;
  console.log(`${file}: ${edits.length}`);
  if (!DRY) writeFileSync(file, out);
}

console.log(`\nвсего обёрнуто: ${total}`);
if (DRY) {
  console.log("\nстроки:");
  for (const s of [...new Set(found)].sort()) console.log("  " + s);
}
