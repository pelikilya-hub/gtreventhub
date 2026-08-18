// Кодмод локализации: проводит видимые строки экранов через t().
//
// Регуляркой JSX трогать нельзя — слишком много ловушек с вложенными
// выражениями и кавычками, поэтому разбираем настоящим парсером
// TypeScript и правим по позициям, с конца файла к началу, чтобы
// сдвиги не сбивали смещения.
//
// Трогаем только то, что заведомо показывается человеку:
//   1. текстовые узлы JSX  →  {t("…")}
//   2. видимые атрибуты (placeholder, title, aria-label, alt) → {t("…")}
//   3. строковые литералы прямо внутри {…} в JSX → {t("…")}
// Всё остальное (сравнения, ключи объектов, идентификаторы) не трогаем:
// такие места разбираем глазами по списку из теста-сторожа.
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const CYR = /[А-Яа-яЁё]/;
const VISIBLE_ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label"]);

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n\s*/g, " ");

export function wrapFile(file, { dry = false } = {}) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  // Буква t в проекте уже занята: в Boss ею назван элемент задачи в
  // цикле, в Constructor — переводчик языков брифа. Подставлять поверх
  // такого t() нельзя, поэтому проверяем, не связана ли она в одной из
  // объемлющих областей видимости чем-то своим.
  const shadowed = (node) => {
    let p = node.parent;
    while (p) {
      if (ts.isArrowFunction(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) {
        for (const prm of p.parameters ?? []) if (prm.name.getText() === "t") return true;
        if (p.body && ts.isBlock(p.body)) {
          for (const st of p.body.statements) {
            if (!ts.isVariableStatement(st)) continue;
            for (const d of st.declarationList.declarations) {
              // const { t } = useTranslation() — это наш t, он не мешает.
              if (ts.isIdentifier(d.name) && d.name.text === "t") return true;
            }
          }
        }
      }
      p = p.parent;
    }
    return false;
  };

  const inT = (node) => {
    // Уже завёрнуто в t(...) — второй раз не трогаем.
    let p = node.parent;
    while (p) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "t") return true;
      p = p.parent;
    }
    return false;
  };

  const visit = (node) => {
    // 1. Текст прямо в разметке
    if (ts.isJsxText(node) && !shadowed(node)) {
      const raw = node.getText();
      // Разметка сама схлопывает переносы и отступы при показе, поэтому
      // ключ собираем в одну строку. Иначе перенос уезжает внутрь
      // кавычек и ломает файл.
      const text = raw.trim().replace(/\s+/g, " ");
      if (text && CYR.test(text) && !text.startsWith("{")) {
        const lead = raw.slice(0, raw.length - raw.trimStart().length);
        const tail = raw.slice(raw.trimEnd().length);
        edits.push({ start: node.getStart(), end: node.getEnd(), text: `${lead}{t("${esc(text)}")}${tail}` });
      }
      return;
    }

    // 2. Видимые атрибуты
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && !shadowed(node)) {
      const name = node.name.getText();
      const v = node.initializer.text;
      if (VISIBLE_ATTRS.has(name) && CYR.test(v)) {
        edits.push({
          start: node.initializer.getStart(),
          end: node.initializer.getEnd(),
          text: `{t("${esc(v)}")}`,
        });
      }
    }

    // 3. Строковый литерал прямо в {…} внутри разметки
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression) &&
      CYR.test(node.expression.text) &&
      !inT(node.expression) &&
      !shadowed(node)
    ) {
      const e = node.expression;
      edits.push({ start: e.getStart(), end: e.getEnd(), text: `t("${esc(e.text)}")` });
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) return { file, edits: 0, needsHook: false };

  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  if (!dry) writeFileSync(file, out);
  return { file, edits: edits.length, needsHook: !/useTranslation/.test(src) };
}

const files = process.argv.slice(2).filter((a) => a !== "--dry");
const dry = process.argv.includes("--dry");
let total = 0;
for (const f of files) {
  const r = wrapFile(f, { dry });
  total += r.edits;
  if (r.edits) console.log(`${r.edits.toString().padStart(4)}  ${f}${r.needsHook ? "   ← нужен useTranslation" : ""}`);
}
console.log(`\nвсего замен: ${total}`);
