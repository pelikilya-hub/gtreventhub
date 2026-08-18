// Машинный перевод недостающих ключей.
//
// Ровно то, что делает Transposh в WordPress: проходит по строкам и
// заполняет словарь автоматически. Разница в том, что у нас строки уже
// разложены по ключам, поэтому машине не надо угадывать, где текст, а
// где разметка, — и правка руками потом ложится поверх, не ломая вёрстку.
//
// Пакетами, а не по одной строке: у бесплатного тарифа лимит поминутный,
// и семьсот отдельных запросов в него не помещаются.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const KEY = process.env.GEMINI_KEY;
if (!KEY) {
  console.error("нет GEMINI_KEY в окружении");
  process.exit(1);
}

const MODEL = "gemini-flash-latest";
const BATCH = 35;
const LANG = { en: "английский", th: "тайский" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prompt = (lang, items) => `Ты переводишь интерфейс приложения GTR Event —
это платформа ночной жизни Пхукета: афиша клубов, каталог площадок и
диджеев, бронь столов, конструктор мероприятий.

Переведи строки интерфейса на ${LANG[lang]} язык.

Правила:
- Это подписи кнопок, заголовки и подсказки. Держи их короткими: перевод
  не должен быть заметно длиннее оригинала, иначе он не влезет в кнопку.
- Регистр интерфейса: если оригинал БОЛЬШИМИ БУКВАМИ — перевод тоже.
- Названия не переводятся: GTR, GTR Event, BRO, Phuket, Patong, имена
  диджеев и заведений, Telegram, Instagram, WhatsApp, Spotify.
- Сохраняй ведущие и замыкающие символы как есть: · — : , пробелы,
  многоточие, кавычки-ёлочки.
- Ничего не добавляй и не поясняй.

Верни строго JSON-массив переводов той же длины и в том же порядке, без
markdown-обёртки.

Строки:
${JSON.stringify(items, null, 0)}`;

const ask = async (lang, items) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt(lang, items) }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
    } catch {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(8000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      console.error(`  http ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr) && arr.length === items.length) return arr.map(String);
      console.error(`  длина ответа ${Array.isArray(arr) ? arr.length : "?"} вместо ${items.length}`);
    } catch {
      console.error("  ответ не разобрался как JSON");
    }
    return null;
  }
  return null;
};

const lang = process.argv[2];
const inFile = process.argv[3];
const outFile = process.argv[4];
if (!LANG[lang]) {
  console.error("язык: en | th");
  process.exit(1);
}

const items = JSON.parse(readFileSync(inFile, "utf8"))[lang].filter((s) => /[А-Яа-яЁё]/.test(s));
const done = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
const todo = items.filter((s) => !done[s]);

console.log(`${lang}: к переводу ${todo.length} из ${items.length} (готово ${Object.keys(done).length})`);

for (let i = 0; i < todo.length; i += BATCH) {
  const chunk = todo.slice(i, i + BATCH);
  const got = await ask(lang, chunk);
  if (got) {
    chunk.forEach((src, j) => {
      const v = got[j]?.trim();
      if (v) done[src] = v;
    });
    writeFileSync(outFile, JSON.stringify(done, null, 1));
    console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  } else {
    console.log(`  пакет ${i / BATCH + 1} не дался — пропускаю, добьём повтором`);
  }
  await sleep(2500);
}

console.log(`${lang}: в файле ${Object.keys(done).length} переводов`);
