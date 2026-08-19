// Печатает недостающие EN/TH ключи в JSON — вход для переводчиков.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
const CYR = /[А-Яа-яЁё]/;
const ROOT = "/home/user/gtreventhub";
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && name !== "i18n-dict.ts") files.push(p);
  }
})(join(ROOT, "src"));
const keys = new Set();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!CYR.test(src)) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isT = (n) => ts.isCallExpression(n) && ((ts.isIdentifier(n.expression) && n.expression.text === "t") || (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "t" && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "i18n"));
  const visit = (n) => {
    if (isT(n)) { const a = n.arguments[0]; if (a && ts.isStringLiteral(a) && CYR.test(a.text)) keys.add(a.text); }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
const navSrc = readFileSync(join(ROOT, "src/gtr/data/app-data.ts"), "utf8");
const navSf = ts.createSourceFile("a.ts", navSrc, ts.ScriptTarget.Latest, true);
for (const st of navSf.statements) {
  if (!ts.isVariableStatement(st)) continue;
  for (const d of st.declarationList.declarations) {
    if (!/^(NAV_|STAGE_LABEL|ROLE_)/.test(d.name.getText()) || !d.initializer) continue;
    const walk2 = (n) => { if (ts.isStringLiteral(n) && CYR.test(n.text)) keys.add(n.text); ts.forEachChild(n, walk2); };
    walk2(d.initializer);
  }
}
for (const [file, re] of [["src/gtr/map-style.ts", /^MAP_CATS$/], ["src/gtr/screens/Dash.tsx", /^MONTHS_S$/]]) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const w = (n) => {
    if (ts.isVariableDeclaration(n) && re.test(n.name.getText()) && n.initializer) {
      const g = (m) => { if (ts.isStringLiteral(m) && CYR.test(m.text)) keys.add(m.text); ts.forEachChild(m, g); };
      g(n.initializer);
    }
    ts.forEachChild(n, w);
  };
  w(sf);
}
const night = JSON.parse(readFileSync(join(ROOT, "src/gtr/data/venue-night.json"), "utf8"));
for (const rec of Object.values(night)) for (const val of Object.values(rec)) if (typeof val === "string" && CYR.test(val)) keys.add(val);

const dict = readFileSync(join(ROOT, "src/gtr/i18n-dict.ts"), "utf8");
// словарь как модуль не потянуть из скрипта без сборки — компилируем на лету
const out = ts.transpileModule(dict, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function("exports", "module", "require", out)(mod.exports, mod, () => ({}));
const { EN, TH } = mod.exports;
const missEN = [...keys].filter((k) => !(k in EN)).sort();
const missTH = [...keys].filter((k) => !(k in TH)).sort();
console.log(JSON.stringify({ missEN, missTH, counts: { keys: keys.size, missEN: missEN.length, missTH: missTH.length } }));
