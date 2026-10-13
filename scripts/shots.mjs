// Скриншоты экранов для docs/design-debt: iPhone 12 Pro Max (428×746,
// видимая область Safari) и десктоп 1440×900. Заодно ловит ошибки консоли и
// горизонтальную прокрутку — это проверка каждого PR по дизайну.
//
//   node scripts/shots.mjs <outDir> [baseUrl]
//
// Требует запущенный dev-сервер (npm run dev) и демо-режим входа.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] || "docs/design-debt/before";
const base = process.argv[3] || "http://127.0.0.1:3000";
mkdirSync(out, { recursive: true });

const PUBLIC = [
  ["landing", "/"],
  ["afisha", "/afisha"],
  ["login", "/gtr/login"],
];
const APP = [
  ["tonight", "/gtr/tonight"],
  ["dash", "/gtr/dash"],
  ["map", "/gtr/map"],
  ["base", "/gtr/base"],
  ["events", "/gtr/events"],
  ["constructor", "/gtr/constructor"],
  ["calendar", "/gtr/calendar"],
  ["organizer", "/gtr/organizer"],
];

const PROFILES = [
  { name: "iphone", ...devices["iPhone 12 Pro Max"], viewport: { width: 428, height: 746 } },
  { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
];

const report = [];
// В облачной сессии Chromium предустановлен; локально путь можно не задавать.
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
for (const prof of PROFILES) {
  const { name, ...opts } = prof;
  const ctx = await browser.newContext({ ...opts, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 1400)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 200)));

  const shoot = async (id, path) => {
    errors.length = 0;
    await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(900);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const url = page.url().replace(base, "");
    await page.screenshot({ path: join(out, `${id}-${name}.png`), fullPage: false });
    report.push({ id, profile: name, url, scrollW, vw: opts.viewport.width, errors: [...errors] });
  };

  for (const [id, path] of PUBLIC) await shoot(id, path);

  // демо-вход: владелец площадки
  await page.goto(base + "/gtr/login", { waitUntil: "networkidle" });
  const ok = await page.evaluate(async () => {
    const r = await fetch("/gtr/login", {
      method: "POST",
      body: new URLSearchParams({ email: "owner@gtr.events", password: "gtr2026" }),
      redirect: "manual",
    });
    return r.type === "opaqueredirect" || r.status === 303 || r.ok;
  });
  if (!ok) console.warn("demo login failed");
  for (const [id, path] of APP) await shoot(id, path);
  // открытое меню (телефон): лист разделов под шапкой
  if (name === "iphone") {
    await page.goto(base + "/gtr/dash", { waitUntil: "networkidle" }).catch(() => {});
    await page.click(".gtr-burger").catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `menu-${name}.png`) });
  }
  await ctx.close();
}
await browser.close();

for (const r of report) {
  const side = r.scrollW > r.vw ? ` ВБОК +${r.scrollW - r.vw}px` : "";
  const err = r.errors.length ? ` ОШИБКИ(${r.errors.length}): ${process.env.FULL ? r.errors[0] : r.errors[0].slice(0, 160)}` : "";
  console.log(`${r.id.padEnd(12)} ${r.profile.padEnd(8)} ${r.url.padEnd(22)}${side}${err}`);
}
