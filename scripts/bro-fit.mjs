// Стенд адаптива BRO: проверяет, что эфир не выпадает за экран.
//
// Оверлей BRO живёт за входом, и снять с него мерку на живом приложении из
// песочницы нечем. Зато его вёрстка самодостаточна: fixed-слой на весь
// экран со своими классами и без единой переменной из оболочки. Поэтому
// стенд честный: он берёт НАСТОЯЩИЙ gtr.css и разметку, снятую с
// BroOverlay.tsx один в один.
//
// Что стенд НЕ проверяет: клавиатуру iOS (в Chromium её нет) и вырезы
// экрана — env(safe-area-inset-*) вне Safari равны нулю. Эти две вещи
// смотрятся глазами на устройстве.
//
// Запуск: node scripts/bro-fit.mjs [--shots]
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const css = readFileSync("src/gtr/gtr.css", "utf8");
const shots = process.argv.includes("--shots");

const QUICK = [
  ["Что сегодня", "calendar"], ["Рядом", "pin"], ["Бронь", "cocktail"],
  ["Артисты", "mic"], ["Музыка", "headphones2"], ["Маршрут", "islandmap"],
  ["Вайб-чек", "equalizer"], ["Помощь", "handshake"],
];

const MSGS = [
  ["user", "что сегодня в патонге"],
  ["bro", "Сегодня в Патонге громко: Illuzion — Main Room с 22:00, вход 500 бат до полуночи. Рядом Café del Mar с закатным сетом, там спокойнее и есть столы у воды."],
  ["user", "забронируй стол на четверых"],
  ["bro", "Записал: Café del Mar, сегодня, четверо. Площадка ответит в течение 15 минут — я вернусь с подтверждением."],
];

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${css}</style>
<style>html,body{margin:0;background:#0a0b0d;height:100%}</style>
</head><body class="gtr-app">
<div class="gtr-bro" role="dialog" aria-modal="true" aria-label="GTR BRO">
  <button class="gtr-bro-scrim" aria-label="Закрыть"></button>
  <div class="gtr-bro-sheet">
    <div class="gtr-bro-head">
      <span class="gtr-bro-eyebrow">GTR BRO</span>
      <span class="gtr-bro-state s-listening">СЛУШАЮ</span>
      <button class="gtr-bro-x" aria-label="Закрыть">✕</button>
    </div>
    <div class="gtr-bro-chat" aria-live="polite">
      ${MSGS.map(([who, t]) => `<div class="gtr-bro-msg ${who}">${t}</div>`).join("")}
    </div>
    <form class="gtr-bro-say">
      <input class="gtr-bro-sayin" placeholder="Напиши сообщение" aria-label="Сообщение для BRO">
      <button class="gtr-bro-saygo" type="submit" aria-label="Отправить">↑</button>
    </form>
    <div class="gtr-bro-quick">
      ${QUICK.map(([t, icon]) => `<button class="gtr-bro-q"><img class="gtr-stk gtr-stk-2x" src="/brand/emoji4/${icon}-256.png" style="width:30px;height:30px" alt=""><span>${t}</span></button>`).join("")}
    </div>
    <div class="gtr-bro-orb-wrap">
      <button class="gtr-bro-orb on"><img src="/bro/ptt.webp" alt=""></button>
      <div class="gtr-bro-hint">НАЖМИ, ЧТОБЫ ГОВОРИТЬ</div>
    </div>
    <div class="gtr-bro-bar">
      <button class="gtr-bro-btn on">ГОЛОС</button>
      <button class="gtr-bro-btn">ТЕРМИНАЛ</button>
      <button class="gtr-bro-btn danger">СТОП</button>
    </div>
  </div>
</div>
</body></html>`;

writeFileSync("/tmp/bro-fit.html", html);

const CASES = [
  { name: "iphone-portrait", w: 390, h: 844 },
  { name: "iphone-landscape", w: 844, h: 390 },
  { name: "iphone-max-portrait", w: 430, h: 932 },
  { name: "ipad-portrait", w: 834, h: 1194 },
  { name: "ipad-landscape", w: 1194, h: 834 },
  { name: "ipad-pro-portrait", w: 1024, h: 1366 },
  { name: "desktop", w: 1440, h: 900 },
];

// Chromium в этом окружении предустановлен рядом, а не тянется npm-пакетом:
// версия пакета может не совпасть с версией сборки, поэтому путь явный.
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let bad = 0;
for (const c of CASES) {
  const page = await browser.newPage({
    viewport: { width: c.w, height: c.h },
    hasTouch: c.name !== "desktop",
    isMobile: c.name !== "desktop",
  });
  await page.goto("file:///tmp/bro-fit.html");
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const sheet = document.querySelector(".gtr-bro-sheet");
    const b = sheet.getBoundingClientRect();
    const wide = [...document.querySelectorAll(".gtr-bro-sheet *")].filter(
      (el) => el.getBoundingClientRect().right > b.right + 1 || el.getBoundingClientRect().left < b.left - 1,
    );
    const msg = document.querySelector(".gtr-bro-msg.bro").getBoundingClientRect();
    return {
      sheet: { w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left), top: Math.round(b.top) },
      fitsH: b.top >= -1 && b.bottom <= window.innerHeight + 1,
      overflowX: sheet.scrollWidth > sheet.clientWidth + 1,
      escaped: wide.map((el) => el.className),
      msgW: Math.round(msg.width),
      cut: sheet.scrollHeight > sheet.clientHeight + 1, // есть внутренняя прокрутка
    };
  });
  const ok = r.fitsH && !r.overflowX && r.escaped.length === 0 && r.msgW <= 640;
  if (!ok) bad++;
  console.log(
    `${ok ? "✓" : "✗"} ${c.name.padEnd(20)} ${c.w}×${c.h}  лист ${String(r.sheet.w).padStart(4)}×${String(r.sheet.h).padStart(4)} @${r.sheet.left},${r.sheet.top}  реплика ${r.msgW}px  ${r.cut ? "прокрутка внутри" : "влезло целиком"}${r.escaped.length ? `  ВЫЛЕЗЛИ: ${r.escaped.join(", ")}` : ""}${r.overflowX ? "  ГОРИЗОНТАЛЬНАЯ ПРОКРУТКА" : ""}${r.fitsH ? "" : "  ЛИСТ ЗА ЭКРАНОМ"}`,
  );
  if (shots) await page.screenshot({ path: `/tmp/bro-${c.name}.png` });
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
