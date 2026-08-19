// Инвентаризация: русские строковые литералы вне t()/i18n.t()
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const CYR = /[А-Яа-яЁё]/;
const ROOT = "/home/user/gtreventhub";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "__tests__", ".git"].includes(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/i18n-dict|i18n\.ts$/.test(name)) files.push(p);
  }
})(join(ROOT, "src"));

const out = {};
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!CYR.test(src)) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isT = (n) =>
    ts.isCallExpression(n) &&
    ((ts.isIdentifier(n.expression) && n.expression.text === "t") ||
      (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "t"));
  const hits = [];
  const visit = (n, inT) => {
    if (isT(n)) inT = true;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYR.test(n.text) && !inT) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      hits.push(line + ": " + n.text.slice(0, 60).replace(/\n/g, "⏎"));
    }
    // шаблоны с подстановками
    if (ts.isTemplateExpression(n) && !inT) {
      const txt = n.getText();
      if (CYR.test(txt)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        hits.push(line + ": TPL " + txt.slice(0, 60).replace(/\n/g, "⏎"));
      }
    }
    ts.forEachChild(n, (c) => visit(c, inT));
  };
  visit(sf, false);
  if (hits.length) out[file.replace(ROOT + "/", "")] = hits;
}
const entries = Object.entries(out).sort((a, b) => b[1].length - a[1].length);
let total = 0;
for (const [f, hits] of entries) { total += hits.length; console.log(f + " — " + hits.length); if (process.argv[2] && f.includes(process.argv[2])) hits.forEach((h) => console.log("   " + h)); }
console.log("TOTAL:", total);
