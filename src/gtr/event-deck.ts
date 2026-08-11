// Клиентская презентация события: брендовый документ, который организатор
// отдаёт заказчику. Открывается в отдельном окне и уходит в PDF через печать.
// В отличие от сметы (белая, тонер-бережная) дека — digital-first: тёмные
// слайды A4 landscape с обложкой из ИМПУЛЬСА.
import {
  fmtThb,
  TIER_LABEL,
  TIER_NOTE,
  type Quote,
  type TierPlan,
} from "./data/app-data";
import photosRaw from "./data/artist-photos.json";

const PHOTOS = (photosRaw as { photos: Record<string, { photoMed: string; name: string }> })
  .photos;
const photoByName = new Map(
  Object.values(PHOTOS).map((p) => [p.name.toLowerCase(), p.photoMed]),
);

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type DeckArtist = { name: string; sub: string; badge: string };
export type DeckRoom = { name: string; meta: string };
export type DeckModule = { kind: string; title: string; sub: string };

export function eventDeckDocument({
  title,
  venue,
  area,
  when,
  guests,
  vibe,
  coverArt,
  heroImg,
  rooms,
  artists,
  modules,
  quote,
  tiers,
}: {
  title: string;
  venue: string;
  area: string;
  when: string;
  guests: string;
  vibe?: string;
  coverArt: string; // dataURL ИМПУЛЬСА c сидом события
  heroImg?: string; // фото площадки, если есть
  rooms: DeckRoom[];
  artists: DeckArtist[];
  modules: DeckModule[];
  quote: Quote;
  tiers: TierPlan[];
}) {
  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Слайды лайнапа и программы условные — нумеруем по факту, не статикой
  let pg = 1;
  const pageNo = (label: string) => `${label} · ${String(++pg).padStart(2, "0")}`;

  const artistCards = artists
    .map((a) => {
      const ph = photoByName.get(a.name.toLowerCase());
      const face = ph
        ? `<img src="${esc(ph)}" alt="" class="face">`
        : `<div class="face letter">${esc(a.name.trim()[0] || "?")}</div>`;
      return `<div class="artist">${face}
        <div><b>${esc(a.name)}</b><span>${esc(a.sub)}</span></div>
        <i>${esc(a.badge)}</i></div>`;
    })
    .join("");

  const moduleRows = modules
    .map((m) => `<div class="mod"><i></i><b>${esc(m.title)}</b><span>${esc(m.sub)}</span></div>`)
    .join("");

  const tierCards = tiers
    .map(
      (t) => `<div class="tier ${t.tier === "optimum" ? "hot" : ""}">
      <div class="tname">${esc(TIER_LABEL[t.tier])}</div>
      <div class="tsum">${esc(fmtThb(t.total))}</div>
      <div class="tnote">${esc(TIER_NOTE[t.tier])}</div>
      ${t.picks
        .map(
          (p) =>
            `<div class="pick"><span>${esc(p.pkg.package)}</span><b>${esc(fmtThb(p.pkg.price))}</b></div>`,
        )
        .join("")}
    </div>`,
    )
    .join("");

  // Окно создаётся через document.write в about:blank — без <base>
  // относительные /fonts и /brand не резолвятся
  const origin = typeof location !== "undefined" ? location.origin : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<base href="${origin}/">
<title>GTR · ${esc(title)}</title>
<style>
@font-face{font-family:'Oswald';font-weight:700;src:url(/fonts/gtr/Oswald-700-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:'Oswald';font-weight:700;src:url(/fonts/gtr/Oswald-700-latin.woff2) format('woff2');unicode-range:U+0000-00FF}
@font-face{font-family:'Golos Text';font-weight:400;src:url(/fonts/gtr/GolosText-400-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:'Golos Text';font-weight:400;src:url(/fonts/gtr/GolosText-400-latin.woff2) format('woff2');unicode-range:U+0000-00FF}
@font-face{font-family:'Golos Text';font-weight:600;src:url(/fonts/gtr/GolosText-600-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:'Golos Text';font-weight:600;src:url(/fonts/gtr/GolosText-600-latin.woff2) format('woff2');unicode-range:U+0000-00FF}
@font-face{font-family:'JetBrains Mono';font-weight:500;src:url(/fonts/gtr/JetBrainsMono-500-cyrillic.woff2) format('woff2');unicode-range:U+0400-045F}
@font-face{font-family:'JetBrains Mono';font-weight:500;src:url(/fonts/gtr/JetBrainsMono-500-latin.woff2) format('woff2');unicode-range:U+0000-00FF}
@font-face{font-family:'Trashed GTR';src:url(/fonts/gtr/Trashed.woff2) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4 landscape;margin:0}
html,body{background:#0A0B0D;color:#EAEAEA;font:14px/1.5 'Golos Text',sans-serif;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide{width:297mm;height:209mm;position:relative;overflow:hidden;page-break-after:always;
  padding:16mm 18mm;display:flex;flex-direction:column;justify-content:center}
.slide:last-child{page-break-after:auto}
.no{position:absolute;top:9mm;right:18mm;font:500 8px/1 'JetBrains Mono',monospace;
  color:#8A8D93;letter-spacing:.2em}
.eyebrow{font:500 10px/1 'JetBrains Mono',monospace;letter-spacing:.22em;
  text-transform:uppercase;color:#E5231B;margin-bottom:7mm}
h2{font:700 34px/0.95 'Oswald',sans-serif;text-transform:uppercase;
  letter-spacing:-.02em;margin-bottom:8mm}
.impulse{position:absolute;width:4px;top:-5%;bottom:-5%;background:#E5231B;opacity:.85}
/* обложка */
.cover{justify-content:flex-end;padding-bottom:20mm}
.cover .art{position:absolute;inset:0;object-fit:cover;width:100%;height:100%;opacity:.9}
.cover .shade{position:absolute;inset:0;
  background:linear-gradient(0deg,#0A0B0Df0 18%,#0A0B0D55 55%,#0A0B0D22)}
.cover .brand{position:absolute;top:12mm;left:18mm;height:15mm}
.cover h1{position:relative;font:400 62px/0.95 'Trashed GTR','Oswald',sans-serif;
  max-width:75%;text-wrap:balance}
.cover h1 b{color:#E5231B;font-weight:400}
.cover .meta{position:relative;margin-top:6mm;font:500 12px/1.7 'JetBrains Mono',monospace;color:#c9cbd0}
.cover .meta b{color:#FF3427}
/* площадка */
.vgrid{display:grid;grid-template-columns:1.15fr 1fr;gap:10mm;align-items:center}
.vphoto{width:100%;height:120mm;object-fit:cover;border:1px solid #ffffff22;
  clip-path:polygon(0 0,calc(100% - 8mm) 0,100% 8mm,100% 100%,0 100%)}
.room{display:flex;justify-content:space-between;gap:6mm;padding:3.2mm 0;
  border-bottom:1px solid #ffffff14;font-size:13px}
.room b{font-weight:600}
.room span{font:500 11px/1.5 'JetBrains Mono',monospace;color:#8A8D93;text-align:right}
/* лайнап */
.lineup{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
.artist{display:flex;align-items:center;gap:5mm;background:#0F1013;
  border:1px solid #ffffff14;padding:5mm;
  clip-path:polygon(0 0,calc(100% - 5mm) 0,100% 5mm,100% 100%,0 100%)}
.face{width:22mm;height:22mm;object-fit:cover;flex:none;
  clip-path:polygon(0 0,calc(100% - 3mm) 0,100% 3mm,100% 100%,0 100%)}
.face.letter{display:flex;align-items:center;justify-content:center;
  font:400 34px/1 'Trashed GTR',sans-serif;color:#fff;
  background:linear-gradient(135deg,#E5231B48,#E5231B10);border:1px solid #E5231B55}
.artist b{display:block;font-size:15px}
.artist span{display:block;font:400 11px/1.4 'Golos Text',sans-serif;color:#9a9da3;margin-top:1mm}
.artist i{margin-left:auto;font:700 9px/1 'JetBrains Mono',monospace;color:#E5231B;
  border:1.5px solid #E5231B;padding:1.6mm 2mm;font-style:normal;transform:rotate(-2deg)}
/* программа */
.mods{display:grid;grid-template-columns:1fr 1fr;gap:4mm 10mm;max-width:230mm}
.mod{display:flex;align-items:baseline;gap:4mm;padding:3mm 0;border-bottom:1px solid #ffffff12}
.mod i{width:3mm;height:3mm;background:#E5231B;flex:none;align-self:center}
.mod b{font-size:14px;white-space:nowrap}
.mod span{font:400 11px/1.4 'Golos Text',sans-serif;color:#9a9da3;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
/* инвестиции */
.tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}
.tier{border:1px solid #ffffff1c;padding:7mm;background:#0F1013}
.tier.hot{border-color:#E5231B;background:#E5231B12}
.tname{font:700 15px/1 'Oswald',sans-serif;text-transform:uppercase;letter-spacing:.05em}
.tsum{font:500 26px/1 'JetBrains Mono',monospace;margin:4mm 0 2mm;color:#fff}
.tier.hot .tsum{color:#FF3427}
.tnote{font:400 10.5px/1.5 'Golos Text',sans-serif;color:#9a9da3;margin-bottom:4mm;min-height:12mm}
.pick{display:flex;justify-content:space-between;gap:4mm;font-size:11px;
  padding:2mm 0;border-top:1px solid #ffffff10;color:#c9cbd0}
.pick b{font:600 11px/1.4 'JetBrains Mono',monospace}
.fine{margin-top:7mm;font:400 10px/1.6 'Golos Text',sans-serif;color:#8A8D93;max-width:230mm}
/* финал */
.final{align-items:flex-start}
.final .brand{height:22mm;margin-bottom:10mm}
.contact{font:500 13px/2 'JetBrains Mono',monospace;color:#c9cbd0}
.contact b{color:#FF3427}
</style></head><body>

<section class="slide cover">
  <img class="art" src="${coverArt}" alt="">
  <div class="shade"></div>
  <img class="brand" src="/brand/GTR_horizontal_dark.svg" alt="GTR">
  <div class="no">GTR EVENT · ${esc(today)}</div>
  <h1>${esc(title)}</h1>
  <div class="meta">${esc(venue)} · ${esc(area)}<br>
  <b>${esc(when)}</b>${guests ? ` · гостей: ${esc(guests)}` : ""}${vibe ? ` · вайб: ${esc(vibe)}` : ""}</div>
</section>

<section class="slide">
  <div class="impulse" style="left:64%"></div>
  <div class="no">${pageNo("ПЛОЩАДКА")}</div>
  <div class="eyebrow">Площадка</div>
  <h2>${esc(venue)}</h2>
  <div class="vgrid">
    ${heroImg ? `<img class="vphoto" src="${esc(heroImg)}" alt="">` : `<img class="vphoto" src="${coverArt}" alt="">`}
    <div>${rooms.map((r) => `<div class="room"><b>${esc(r.name)}</b><span>${esc(r.meta)}</span></div>`).join("") || '<div class="room"><b>Залы уточняются</b><span>—</span></div>'}</div>
  </div>
</section>

${
  artists.length
    ? `<section class="slide">
  <div class="no">${pageNo("ЛАЙНАП")}</div>
  <div class="eyebrow">Лайнап</div>
  <h2>Артисты вечера</h2>
  <div class="lineup">${artistCards}</div>
</section>`
    : ""
}

${
  modules.length
    ? `<section class="slide">
  <div class="impulse" style="left:12%;opacity:.35;width:2px"></div>
  <div class="no">${pageNo("ПРОГРАММА")}</div>
  <div class="eyebrow">Наполнение</div>
  <h2>Программа события</h2>
  <div class="mods">${moduleRows}</div>
</section>`
    : ""
}

<section class="slide">
  <div class="no">${pageNo("ИНВЕСТИЦИИ")}</div>
  <div class="eyebrow">Инвестиции</div>
  <h2>Три уровня комплектации</h2>
  <div class="tiers">${tierCards}</div>
  <div class="fine">Суммы в THB, включая комиссию GTR ${quote.commissionPct}%. Текущая
  конфигурация события: ${esc(fmtThb(quote.total))}. Пакеты отличаются составом — числом дек,
  часами съёмки, мощностью звука. Точные ставки подтверждают площадка и подрядчики.</div>
</section>

<section class="slide final">
  <div class="impulse" style="left:78%"></div>
  <div class="no">${pageNo("КОНТАКТ")}</div>
  <img class="brand" src="/brand/GTR_exact_expressive_dark.svg" alt="GTR — Global Transformation Reality">
  <h2 style="max-width:70%">Соберём эту ночь вместе</h2>
  <div class="contact">GTR Event · операционная платформа площадок Пхукета<br>
  <b>gtr-event-hub.netlify.app</b> · запрос уходит площадке в один клик</div>
</section>

</body></html>`;
}
