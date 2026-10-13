// Проверка прода после выкатки: что реально доехало до живого сайта.
//
// Смотрим не «деплой зелёный», а признаки конкретных работ. Зелёный
// деплой, не доехавший до воркера, уже случался — именно из-за него
// прод полтора месяца отдавал августовскую сборку.
import { chromium } from "playwright";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const get = async (path) => {
  const r = await fetch(`https://gtrevent.com${path}`, {
    headers: { "User-Agent": UA },
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
  return { code: r.status, text: await r.text().catch(() => "") };
};

const ok = [];
const bad = [];
const say = (good, line) => (good ? ok : bad).push(line);

// 1. Отпечаток сборки: он печатается в бандл на сборке, поэтому свежий
//    отпечаток — единственное надёжное доказательство, что выкатка доехала.
const v = await get("/api/version");
const build = Number((v.text.match(/\d+/) || [0])[0]);
const ageH = ((Date.now() - build) / 3600e3).toFixed(1);
say(build > Date.now() - 6 * 3600e3, `сборка в проде: ${new Date(build).toISOString()} (${ageH} ч назад)`);

// 2. Роуты, которых в августовской сборке не было вовсе.
//    401 = роут есть и просит ключ. 404 = старый код.
for (const [path, what] of [
  ["/api/fill-digest?key=x", "утренняя сводка конвейера (PR #36)"],
  ["/api/google-auth", "дверь Google (PR #37)"],
]) {
  const r = await get(path);
  say(r.code !== 404, `${what}: HTTP ${r.code}${r.code === 404 ? " — НЕ ВЫКАЧЕНО" : ""}`);
}

// 3. Экран входа глазами браузера: новый дизайн и три двери.
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, locale: "ru-RU", ignoreHTTPSErrors: true });
const p = await ctx.newPage();
const jsErrs = [];
p.on("pageerror", (e) => jsErrs.push(String(e).slice(0, 110)));
await p.goto("https://gtrevent.com/gtr/login", { waitUntil: "domcontentloaded", timeout: 45_000 });
await p.waitForTimeout(4000);
const ui = await p.evaluate(() => {
  const t = document.querySelector(".gtr-auth-title");
  const body = (document.body.innerText || "").replace(/\s+/g, " ");
  return {
    newDesign: Boolean(t),
    font: t ? getComputedStyle(t).fontFamily.split(",")[0].replace(/"/g, "") : null,
    cut: Boolean(document.querySelector(".gtr-auth-panel.gtr-cut")),
    telegram: /Войти через Telegram/i.test(body),
    google: /Войти через Google/i.test(body),
    phone: /по номеру телефона/i.test(body),
    demo: /gtr2026|ДЕМО-РОЛИ/i.test(body),
    ov: (() => { window.scrollTo(400, 0); const x = window.scrollX; window.scrollTo(0, 0); return x; })(),
  };
});
say(ui.newDesign, `новый экран входа: ${ui.newDesign ? `есть, заголовок ${ui.font}` : "НЕТ — старая вёрстка"}`);
say(ui.cut, `срезанный угол панели: ${ui.cut ? "есть" : "НЕТ"}`);
say(ui.telegram, `дверь Telegram: ${ui.telegram ? "видна" : "НЕ видна (нужен TELEGRAM_BOT_TOKEN в воркере)"}`);
say(!ui.ov, `горизонтальный вынос: ${ui.ov}px`);
say(!ui.demo, `демо-пароль на экране: ${ui.demo ? "ПОКАЗАН — демо-режим включён!" : "скрыт"}`);
console.log(`двери Google / телефон: ${ui.google ? "Google есть" : "Google нет"}, ${ui.phone ? "телефон есть" : "телефона нет"} (ожидаемо, пока не заданы ключи)`);
if (jsErrs.length) bad.push(`ошибки JS: ${[...new Set(jsErrs)].join(" | ")}`);
await b.close();

console.log("\n✅ В ПОРЯДКЕ:");
ok.forEach((l) => console.log("  " + l));
if (bad.length) {
  console.log("\n❌ ПРОБЛЕМЫ:");
  bad.forEach((l) => console.log("  " + l));
}
console.log(`\nИТОГ: ${ok.length} хорошо, ${bad.length} плохо`);
