// Вливает собранные переводы в src/gtr/i18n-dict.ts, не трогая то, что
// там уже было. Дописывает новые записи отдельным блоком в конец
// словаря — так правки видно в git diff построчно, и ручную правку
// потом легко найти и не потерять при следующей волне автоперевода.
import { readFileSync, writeFileSync } from "node:fs";

const lang = process.argv[2]; // en | th
const patchFile = process.argv[3];
const DICT = "src/gtr/i18n-dict.ts";
const NAME = { en: "EN", th: "TH" };
if (!NAME[lang]) {
  console.error("язык: en | th");
  process.exit(1);
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const patch = JSON.parse(readFileSync(patchFile, "utf8"));
const src = readFileSync(DICT, "utf8");

const marker = `export const ${NAME[lang]}: Record<string, string> = {`;
const start = src.indexOf(marker);
if (start === -1) throw new Error(`не нашёл ${marker}`);
const bodyStart = start + marker.length;
const bodyEnd = src.indexOf("\n};", bodyStart);
const body = src.slice(bodyStart, bodyEnd);

const already = new Set([...body.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map((m) => m[1]));

const fresh = Object.entries(patch).filter(([k, v]) => v && !already.has(k));
if (!fresh.length) {
  console.log(`${lang}: новых записей нет`);
  process.exit(0);
}

const block =
  `\n\n  // --- волна 2: автоперевод, добавлено ${new Date().toISOString().slice(0, 10)} ---\n` +
  fresh.map(([k, v]) => `  "${esc(k)}": "${esc(v)}",`).join("\n");

const out = src.slice(0, bodyEnd) + block + src.slice(bodyEnd);
writeFileSync(DICT, out);
console.log(`${lang}: добавлено ${fresh.length} записей`);
