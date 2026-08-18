// Второй проход локализации: раздать useTranslation тем компонентам,
// которые после кодмода зовут t(), но хука не имеют.
//
// Хук нельзя ставить куда попало: в обычной функции-помощнике он ломает
// правила хуков и роняет приложение в рантайме. Поэтому ставим только в
// функции верхнего уровня, которые (а) возвращают разметку и (б) названы
// с большой буквы — то есть компоненты. Всё, что под эти условия не
// подошло, но зовёт t(), печатаем отдельным списком: такие места надо
// смотреть глазами, а не чинить скриптом.
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const hasJsx = (node) => {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
};

const callsT = (node) => {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t") {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
};

const declaresT = (body) => {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isVariableDeclaration(n)) {
      // И `const { t } = useTranslation()`, и собственный `const t = …`:
      // в обоих случаях имя занято и второй раз объявлять его нельзя.
      const named =
        (ts.isObjectBindingPattern(n.name) && n.name.elements.some((el) => el.name.getText() === "t")) ||
        (ts.isIdentifier(n.name) && n.name.text === "t");
      if (named) {
        found = true;
        return;
      }
    }
    // Вложенные функции не считаем: там свой хук и своя область.
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return found;
};

export function addHooks(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inserts = [];
  const direct = [];
  const skipped = [];

  const consider = (name, fn) => {
    if (!fn || !fn.body) return;
    if (!callsT(fn)) return;
    // Короткая стрелка `(x) => (<div/>)`: тела-блока нет, вставлять хук
    // некуда — такому помощнику нужен прямой вызов переводчика.
    if (!ts.isBlock(fn.body)) {
      if (hasJsx(fn)) direct.push(fn);
      return;
    }
    if (declaresT(fn.body)) return;
    const isComponent = /^[A-Z]/.test(name) && hasJsx(fn);
    if (isComponent) {
      inserts.push(fn.body.getStart() + 1);
      return;
    }
    // Разметка в обычной функции-помощнике: хук туда ставить нельзя —
    // он вызывается не на каждый рендер и валит правила хуков. Зовём
    // переводчик напрямую: ключи у нас русские, i18n.t их и разрешит,
    // а перерисовку при смене языка обеспечивает хук в родителе.
    if (hasJsx(fn)) {
      direct.push(fn);
      return;
    }
    skipped.push(name || "(аноним)");
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) consider(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)))
          consider(d.name.getText(), d.initializer);
      }
    }
  }

  // Сначала точечно правим помощников: t( → i18n.t(
  const rewrites = [];
  for (const fn of direct) {
    const walk = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t")
        rewrites.push(n.expression.getStart());
      ts.forEachChild(n, walk);
    };
    walk(fn);
  }

  // Оба вида правок — вставки по смещениям исходника, поэтому применяем
  // их одним проходом с конца файла. Двумя проходами второй сбивал бы
  // смещения первого.
  const all = [
    ...rewrites.map((pos) => ({ pos, text: "i18n." })),
    ...inserts.map((pos) => ({ pos, text: "\n  const { t } = useTranslation();" })),
  ].sort((a, b) => b.pos - a.pos);

  let out = src;
  for (const e of all) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  if (inserts.length && !/from "react-i18next"/.test(out)) {
    // Ставим импорт сразу за первым — порядок импортов в проекте
    // алфавитный по группам, react-i18next живёт среди внешних.
    const first = out.indexOf("\n", out.indexOf("import "));
    out = out.slice(0, first + 1) + 'import { useTranslation } from "react-i18next";\n' + out.slice(first + 1);
  }
  if (rewrites.length && !/^import i18n from/m.test(out)) {
    const first = out.indexOf("\n", out.indexOf("import "));
    out = out.slice(0, first + 1) + 'import i18n from "../i18n";\n' + out.slice(first + 1);
  }
  if (inserts.length || rewrites.length) writeFileSync(file, out);
  return { file, added: inserts.length, direct: rewrites.length, skipped };
}

let total = 0;
const problems = [];
for (const f of process.argv.slice(2)) {
  const r = addHooks(f);
  total += r.added;
  if (r.added || r.direct)
    console.log(`${String(r.added).padStart(3)} хуков  ${String(r.direct).padStart(3)} прямых  ${f}`);
  if (r.skipped.length) problems.push(`${f}: ${r.skipped.join(", ")}`);
}
console.log(`\nхуков добавлено: ${total}`);
if (problems.length) {
  console.log("\nне компоненты, но зовут t() — смотреть глазами:");
  for (const p of problems) console.log("  " + p);
}
