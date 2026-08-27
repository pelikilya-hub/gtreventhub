// Печатная версия сметы GTR: открывается в отдельном окне и уходит в PDF
// через диалог печати браузера. Бумага белая — тёмная тема интерфейса на
// печати съедает тонер и плохо читается.
import { fmtThb, RATE_LABEL, type Quote, type RateKind } from "./data/app-data";

const esc = (s: string) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Цвета статуса цены на белом фоне — контрастнее экранных
const PRINT_RATE_COLOR: Record<RateKind, string> = {
  published: "#1B7F3B",
  quoted: "#1B7F3B",
  "gtr-estimate": "#9A6100",
  inquiry: "#6B6B6B",
};

const GROUP_LABEL: Record<string, string> = {
  venue: "Площадка",
  artist: "Артисты",
  sound: "Звук",
  light: "Свет",
  decor: "Декор",
  content: "Фото и видео",
  other: "Прочее",
};

export function quoteDocument({
  no,
  venue,
  rooms,
  when,
  quote,
}: {
  no: string;
  venue: string;
  /** vid больше не печатаем в клиентском документе — внутренний код
   *  площадки не должен уехать площадке или подрядчику. Оставлен в типе
   *  опционально, чтобы не ломать вызовы. */
  vid?: string;
  rooms: string;
  when: string;
  quote: Quote;
}) {
  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const rows = quote.lines
    .map(
      (l) => `<tr>
      <td class="g">${esc(GROUP_LABEL[l.group] ?? l.group)}</td>
      <td>
        <span class="ttl">${esc(l.label)}</span>
        <span class="note">${esc(l.note)}</span>
      </td>
      <td class="st" style="color:${PRINT_RATE_COLOR[l.kind]}">${esc(RATE_LABEL[l.kind])}</td>
      <td class="amt">${l.amount ? esc(fmtThb(l.amount)) : "по запросу"}</td>
    </tr>`,
    )
    .join("");

  const missing = quote.missing.length
    ? `<section class="warn">
        <h2>Требует уточнения</h2>
        <ul>${quote.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
      </section>`
    : "";

  const origin = typeof location !== "undefined" ? location.origin : "";
  return `<!doctype html><html lang="ru"><head><base href="${origin}/"><meta charset="utf-8">
<title>${esc(no)} · ${esc(venue)}</title>
<style>
@font-face{font-family:Oswald;font-weight:600;src:url(/fonts/gtr/Oswald-600-cyrillic.woff2) format('woff2');font-display:swap}
@font-face{font-family:Oswald;font-weight:700;src:url(/fonts/gtr/Oswald-700-cyrillic.woff2) format('woff2');font-display:swap}
@font-face{font-family:'Golos Text';font-weight:400;src:url(/fonts/gtr/GolosText-400-cyrillic.woff2) format('woff2');font-display:swap}
@font-face{font-family:'Golos Text';font-weight:500;src:url(/fonts/gtr/GolosText-500-cyrillic.woff2) format('woff2');font-display:swap}
@font-face{font-family:'JetBrains Mono';font-weight:500;src:url(/fonts/gtr/JetBrainsMono-500-cyrillic.woff2) format('woff2');font-display:swap}
*{box-sizing:border-box}
body{margin:0;padding:32px 34px;background:#fff;color:#111;
  font:400 12px/1.55 'Golos Text',system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{display:flex;justify-content:space-between;align-items:flex-start;
  border-bottom:2px solid #E5231B;padding-bottom:12px;margin-bottom:18px}
.brand{font:700 22px/1 Oswald,sans-serif;letter-spacing:.02em}
.brand span{color:#E5231B}
.sub{font:500 9.5px/1.4 'JetBrains Mono',monospace;color:#666;margin-top:4px;letter-spacing:.06em}
.doc{text-align:right;font:500 10px/1.5 'JetBrains Mono',monospace;color:#444}
.doc b{display:block;font:700 13px/1.3 Oswald,sans-serif;color:#111;letter-spacing:.04em}
h1{font:700 17px/1.25 Oswald,sans-serif;margin:0 0 3px}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0 20px;
  border:1px solid #E3E3E3;border-radius:6px;padding:12px 14px}
.meta div{display:flex;flex-direction:column;gap:2px}
.k{font:500 8px/1 'JetBrains Mono',monospace;letter-spacing:.13em;text-transform:uppercase;color:#8A8A8A}
.v{font:500 11.5px/1.35 'Golos Text',sans-serif}
table{width:100%;border-collapse:collapse;margin-bottom:4px}
th{font:500 8px/1 'JetBrains Mono',monospace;letter-spacing:.13em;text-transform:uppercase;
  color:#8A8A8A;text-align:left;padding:0 8px 7px;border-bottom:1px solid #E3E3E3}
th:last-child{text-align:right}
td{padding:9px 8px;border-bottom:1px solid #F0F0F0;vertical-align:top}
.g{font:500 9px/1.4 'JetBrains Mono',monospace;color:#8A8A8A;white-space:nowrap;width:78px}
.ttl{display:block;font-weight:500;font-size:12px}
.note{display:block;font-size:10px;color:#777;margin-top:1px}
.st{font:500 9px/1.4 'JetBrains Mono',monospace;white-space:nowrap;width:130px}
.amt{text-align:right;font:500 12px/1.4 'JetBrains Mono',monospace;
  white-space:nowrap;font-variant-numeric:tabular-nums;width:105px}
.tot{margin-left:auto;width:290px;margin-top:12px}
.tot div{display:flex;justify-content:space-between;padding:5px 8px;font-size:11.5px}
.tot .fin{border-top:2px solid #111;margin-top:5px;padding-top:9px;
  font:700 15px/1 Oswald,sans-serif;letter-spacing:.02em}
.tot .amt2{font:500 12px/1.4 'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
.warn{margin-top:22px;border-left:2px solid #E5231B;padding:2px 0 2px 13px}
.warn h2{font:600 11px/1 Oswald,sans-serif;letter-spacing:.09em;text-transform:uppercase;margin:0 0 7px}
.warn ul{margin:0;padding-left:15px}
.warn li{font-size:11px;color:#444;margin-bottom:3px}
footer{margin-top:26px;padding-top:11px;border-top:1px solid #E3E3E3;
  font-size:9.5px;line-height:1.6;color:#777}
@page{size:A4;margin:14mm}
@media print{body{padding:0}.appbar{display:none!important}}
.appbar{position:fixed;top:0;left:0;right:0;z-index:99;display:flex;gap:8px;align-items:center;
  padding:9px 14px;background:#0B0B0D;box-shadow:0 2px 12px rgba(0,0,0,.35)}
.appbar button{font:600 11px/1 'Golos Text',system-ui,sans-serif;letter-spacing:.03em;
  padding:9px 14px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;cursor:pointer}
.appbar .go{background:#E5231B;border-color:#E5231B}
body{padding-top:76px}
</style></head><body>
<div class="appbar">
  <button onclick="window.close();setTimeout(function(){if(!window.closed){if(history.length>1)history.back();else location.href='/gtr/dash'}},200)">← В приложение</button>
  <button class="go" onclick="window.print()">Скачать PDF</button>
</div>
<header>
  <div>
    <img src="/brand/GTR_horizontal_light.svg" alt="GTR" style="height:40px;width:auto">
    <div class="sub">GTR EVENT · ОПЕРАЦИОННАЯ ПЛАТФОРМА ПЛОЩАДОК ПХУКЕТА</div>
  </div>
  <div class="doc"><b>${esc(no)}</b>${esc(today)}</div>
</header>

<h1>Предложение по событию</h1>

<div class="meta">
  <div><span class="k">Площадка</span><span class="v">${esc(venue)}</span></div>
  <div><span class="k">Залы</span><span class="v">${esc(rooms)}</span></div>
  <div><span class="k">Когда</span><span class="v">${esc(when)}</span></div>
</div>

<table>
  <thead><tr><th>Раздел</th><th>Позиция</th><th>Статус цены</th><th>Сумма</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="tot">
  <div><span>Подытог</span><span class="amt2">${esc(fmtThb(quote.subtotal))}</span></div>
  <div><span>Комиссия GTR · ${quote.commissionPct}%</span><span class="amt2">${esc(fmtThb(quote.commission))}</span></div>
  <div class="fin"><span>Итого</span><span>${esc(fmtThb(quote.total))}</span></div>
</div>

${missing}

<footer>
  Суммы указаны в тайских батах. Позиции со статусом «Ориентир GTR» и «По запросу»
  не являются офертой: точные ставки подтверждаются площадкой и подрядчиками
  при бронировании. Документ сформирован ${esc(today)}.
</footer>
</body></html>`;
}
