// Кодмод: оборачивает кириллические строковые литералы в t(...) внутри
// компонентов Dash.tsx, где t объявлен через useTranslation.
// Пропускает: имена свойств, сравнения ===/!==, ключи объектов, уже
// обёрнутые в t(), пустые/короткие без букв.
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const FILE = process.argv[2];
const src = readFileSync(FILE, "utf8");
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const CYR = /[А-Яа-яЁё]/;

// найти диапазоны функций, где есть useTranslation
const scopes = [];
const findScopes = (n) => {
  if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && n.body) {
    const body = n.body.getText();
    if (body.includes("useTranslation()")) scopes.push([n.body.getStart(), n.body.getEnd()]);
  }
  ts.forEachChild(n, findScopes);
};
findScopes(sf);
const inScope = (pos) => scopes.some(([a, b]) => pos >= a && pos <= b);

const isT = (n) =>
  ts.isCallExpression(n) &&
  ((ts.isIdentifier(n.expression) && n.expression.text === "t") ||
    (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "t"));

const edits = [];
const visit = (n, tAncestor) => {
  if (isT(n)) tAncestor = true;
  if (ts.isStringLiteral(n) && CYR.test(n.text) && !tAncestor && inScope(n.getStart())) {
    const p = n.parent;
    const skip =
      (ts.isPropertyAssignment(p) && p.name === n) ||
      ts.isImportDeclaration(p) ||
      (ts.isBinaryExpression(p) &&
        [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(
          p.operatorToken.kind,
        )) ||
      ts.isCaseClause(p) ||
      ts.isComputedPropertyName(p) ||
      (ts.isCallExpression(p) && ["getItem", "setItem", "getAttribute", "querySelector", "includes", "startsWith"].some(
        (m) => p.expression.getText().endsWith(m),
      ) && p.arguments[0] === n);
    if (!skip) edits.push([n.getStart(), n.getEnd(), n.getText()]);
  }
  // JSX-текст с кириллицей — показать для ручного разбора
  if (ts.isJsxText(n) && CYR.test(n.text) && n.text.trim()) {
    console.error("JSXTEXT line " + (sf.getLineAndCharacterOfPosition(n.getStart()).line + 1) + ": " + n.text.trim().slice(0, 50));
  }
  ts.forEachChild(n, (c) => visit(c, tAncestor));
};
visit(sf, false);

edits.sort((a, b) => b[0] - a[0]);
let out = src;
for (const [a, b, txt] of edits) out = out.slice(0, a) + "t(" + txt + ")" + out.slice(b);
writeFileSync(FILE, out);
console.log("wrapped:", edits.length);
