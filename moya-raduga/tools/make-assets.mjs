// Рисует свои маски и иконку приложения из SVG в PNG.
//   node tools/make-assets.mjs   (нужен playwright)
// Лист маски — квадрат 32 см вокруг лица: глаза на (512±102, 416), нос (512, 530),
// рот (512, 624), макушка около y=130. Те же числа зашиты в MasksView.swift.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // глобальный или локальный — какой найдётся
import { mkdirSync } from "node:fs";

const INK = "#22223B";
const svg = (body, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

const star = (cx, cy, r, fill) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.48 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
};

const masks = {
  cat: svg(`
    <path d="M300 300 250 90l190 110z" fill="#FF9A1F"/><path d="M724 300l50-210-190 110z" fill="#FF9A1F"/>
    <path d="M318 262 292 150l96 60z" fill="#FF9A8F" stroke-width="8"/><path d="M706 262l26-112-96 60z" fill="#FF9A8F" stroke-width="8"/>
    <circle cx="360" cy="560" r="44" fill="#FF9A8F" stroke="none" opacity=".85"/><circle cx="664" cy="560" r="44" fill="#FF9A8F" stroke="none" opacity=".85"/>
    <path d="M472 500h80l-40 46z" fill="#F0483E"/>
    <path d="M512 546v30M512 576c-20 30-56 26-66 0M512 576c20 30 56 26 66 0"/>
    <path d="M400 540l-170-34M400 572l-176 20M400 600l-160 70M624 540l170-34M624 572l176 20M624 600l160 70" stroke-width="9"/>`),
  stars: svg(`
    ${star(410, 416, 120, "#F0483E")}${star(614, 416, 120, "#2D7FF9")}
    <circle cx="410" cy="420" r="34" fill="${INK}" opacity=".0" stroke="none"/>
    <path d="M470 404h84" stroke-width="14"/>
    <path d="M300 396l-90-30M724 396l90-30" stroke-width="14"/>`),
  crown: svg(`
    <path d="M300 250 270 60l130 96L512 20l112 136 130-96-30 190z" fill="#FFD21F"/>
    <path d="M300 250h424" stroke-width="16"/>
    <circle cx="512" cy="186" r="26" fill="#F0483E"/><circle cx="392" cy="204" r="18" fill="#2D7FF9"/><circle cx="632" cy="204" r="18" fill="#1FA85A"/>
    <circle cx="270" cy="60" r="16" fill="#F0483E"/><circle cx="512" cy="22" r="16" fill="#8A4DFF"/><circle cx="754" cy="60" r="16" fill="#2D7FF9"/>`),
  unicorn: svg(`
    <path d="M512 10l70 250H442z" fill="#FFF3B0"/>
    <path d="M470 150l76-30M456 200l100-38M448 246l120-44" stroke="#F0483E" stroke-width="10"/>
    <path d="M340 290 300 170l110 60z" fill="#FFFFFF"/><path d="M684 290l40-120-110 60z" fill="#FFFFFF"/>
    <path d="M700 250c90 10 130 70 120 150M730 300c60 40 80 100 60 170" stroke="#8A4DFF" stroke-width="22"/>
    <path d="M716 270c70 30 100 80 96 140" stroke="#2D7FF9" stroke-width="22"/>
    <path d="M330 250c-80 20-120 70-116 140" stroke="#FF9AD5" stroke-width="22"/>
    <circle cx="360" cy="570" r="40" fill="#FF9AD5" stroke="none" opacity=".8"/><circle cx="664" cy="570" r="40" fill="#FF9AD5" stroke="none" opacity=".8"/>
    ${star(250, 480, 34, "#FFD21F")}${star(790, 520, 28, "#FFD21F")}`),
  frog: svg(`
    <path d="M250 300c0-120 524-120 524 0v30H250z" fill="#7EDC9C"/>
    <circle cx="380" cy="180" r="92" fill="#7EDC9C"/><circle cx="644" cy="180" r="92" fill="#7EDC9C"/>
    <circle cx="380" cy="176" r="58" fill="#FFFFFF"/><circle cx="644" cy="176" r="58" fill="#FFFFFF"/>
    <circle cx="392" cy="186" r="22" fill="${INK}"/><circle cx="632" cy="186" r="22" fill="${INK}"/>
    <circle cx="350" cy="580" r="42" fill="#7EDC9C" stroke="none" opacity=".8"/><circle cx="674" cy="580" r="42" fill="#7EDC9C" stroke="none" opacity=".8"/>
    <path d="M470 520h6M548 520h6" stroke-width="16"/>`),
};

const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" stroke-linecap="round">
  <defs><pattern id="d" width="64" height="64" patternUnits="userSpaceOnUse"><circle cx="32" cy="32" r="4.5" fill="#D9D2BD"/></pattern></defs>
  <rect width="1024" height="1024" fill="#FFFBEF"/><rect width="1024" height="1024" fill="url(#d)"/>
  <g stroke-width="62">
    <path d="M132 740a380 380 0 0 1 760 0" stroke="#F0483E"/>
    <path d="M212 740a300 300 0 0 1 600 0" stroke="#FF9A1F"/>
    <path d="M292 740a220 220 0 0 1 440 0" stroke="#FFD21F"/>
    <path d="M372 740a140 140 0 0 1 280 0" stroke="#1FA85A"/>
    <path d="M452 740a60 60 0 0 1 120 0" stroke="#2D7FF9"/>
  </g>
  <path d="M110 850c120-40 230 30 400 0s280-40 404 0" stroke="${INK}" stroke-width="30"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
const shoot = async (markup, path, omitBackground) => {
  await page.setContent(`<body style="margin:0;background:transparent">${markup}</body>`);
  await page.screenshot({ path, omitBackground });
};
mkdirSync("ios/MoyaRaduga/Resources/Masks", { recursive: true });
for (const [name, markup] of Object.entries(masks)) {
  await shoot(markup, `ios/MoyaRaduga/Resources/Masks/mask-${name}.png`, true);
}
await shoot(icon, "ios/MoyaRaduga/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png", false);

// Контрольный лист: все маски поверх условного лица — чтобы глазами проверить посадку.
const face = `<circle cx="512" cy="500" r="300" fill="#FFE7CC" stroke="${INK}" stroke-width="10"/><circle cx="410" cy="416" r="22" fill="${INK}"/><circle cx="614" cy="416" r="22" fill="${INK}"/><path d="M450 624c40 30 84 30 124 0" stroke="${INK}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
await page.setViewportSize({ width: 1500, height: 330 });
await page.setContent(`<body style="margin:0;background:#CFE6FF;display:flex">${Object.values(masks)
  .map((m) => `<div style="position:relative;width:300px;height:330px"><svg style="position:absolute" width="300" height="300" viewBox="0 0 1024 1024">${face}</svg><div style="position:absolute;transform:scale(.293);transform-origin:0 0">${m}</div></div>`)
  .join("")}</body>`);
await page.screenshot({ path: process.env.PREVIEW || "/tmp/masks-preview.png" });
await browser.close();
console.log("готово: маски и иконка");
