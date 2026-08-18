// Сбор всех ключей перевода продукта.
//
// Ключ у нас — сама русская строка, поэтому собирать надо два источника:
//   1. литералы внутри t("…") и i18n.t("…") — то, что кодмод уже завернул;
//   2. подписи в таблицах данных (меню, вкладки, статусы), которые
//      показываются через t(переменная) и в литерал внутри вызова не
//      попадают — их надо доставать из самих таблиц.
// Второй источник легко забыть, а без него меню переводится наполовину.
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import ts from "typescript";

const CYR = /[А-Яа-яЁё]/;

const files = globSync("src/**/*.{ts,tsx}", { cwd: process.cwd() }).filter(
  (f) => !f.includes("__tests__") && !f.endsWith("i18n-dict.ts"),
);

const keys = new Set();

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const isTCall = (n) =>
    ts.isCallExpression(n) &&
    ((ts.isIdentifier(n.expression) && n.expression.text === "t") ||
      (ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "t" &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "i18n"));

  const visit = (n) => {
    if (isTCall(n)) {
      const a = n.arguments[0];
      if (a && ts.isStringLiteral(a) && CYR.test(a.text)) keys.add(a.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// Подписи навигации и вкладок живут отдельными таблицами и показываются
// через t(переменная). Достаём их прицельно, а не «все строки подряд»:
// в таблицах рядом лежат идентификаторы экранов и пути иконок.
const navSrc = readFileSync("src/gtr/data/app-data.ts", "utf8");
const navSf = ts.createSourceFile("app-data.ts", navSrc, ts.ScriptTarget.Latest, true);
for (const st of navSf.statements) {
  if (!ts.isVariableStatement(st)) continue;
  for (const d of st.declarationList.declarations) {
    const name = d.name.getText();
    if (!/^(NAV_|STAGE_LABEL|ROLE_)/.test(name) || !d.initializer) continue;
    const walk = (n) => {
      if (ts.isStringLiteral(n) && CYR.test(n.text)) keys.add(n.text);
      ts.forEachChild(n, walk);
    };
    walk(d.initializer);
  }
}

const out = [...keys].sort((a, b) => a.localeCompare(b, "ru"));
writeFileSync(process.argv[2] ?? "i18n-keys.json", JSON.stringify(out, null, 1));
console.log(`ключей собрано: ${out.length}`);
