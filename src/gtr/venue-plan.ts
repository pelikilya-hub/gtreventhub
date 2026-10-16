// Схема площадки по размерам залов — подложка режима «План», когда
// настоящего чертежа ещё никто не загрузил.
//
// Откуда данные. У площадок в базе есть размеры залов из открытых
// источников («Dimensions/configuration: 29.4 x 19.5 x 4.7 m»). Этого
// хватает, чтобы нарисовать залы в масштабе и поставить их значки на
// свои места. Как залы стыкуются между собой, из размеров не следует —
// поэтому взаимное расположение задаётся вручную, и только там, где оно
// сходится с цифрами (A + B + C = Grand Ballroom). Всё остальное
// честно подписано как схема, а не официальный план.
//
// Внутри открытого зала рисуется сам зал: прямоугольник в масштабе с
// метровой сеткой. Его хватает любому залу, у которого известны размеры.
import { SPACES } from "./data/app-data";

export const PLAN_WORLD = 1000; // ширина мира плана, как в PlanCanvas

type Rect = { x: number; y: number; w: number; h: number };
// name — точное имя зала из базы (по нему узнаём узел графа)
type PlanRoom = Rect & { name: string; label?: string };
type VenueLayout = {
  title: string;
  rooms: PlanRoom[]; // нарисованные залы, метры от левого верхнего угла
  // составные залы: своей стены нет, только якорь для значка
  unions: { name: string; of: string[] }[];
  // раздвижные перегородки между секциями, метры
  partitions: [number, number, number, number][];
  note: string;
};

// Phuket Marriott Merlin Beach. Grand Ballroom 29.4 × 19.5 — это C
// (15.8 × 19.5) плюс две секции 13.6 × 9.8 рядом: 13.6 + 15.8 = 29.4,
// 9.8 + 9.8 ≈ 19.5. Переговорные — отдельным блоком справа (схема выходит
// широкой, а не высокой, и влезает в экран): где именно они в здании, в
// открытых данных нет.
const LAYOUTS: Record<string, VenueLayout> = {
  "VEN-0069": {
    title: "Phuket Marriott · Merlin Beach",
    rooms: [
      { name: "Merlin Ballroom A", label: "Ballroom A", x: 0, y: 0, w: 13.6, h: 9.75 },
      { name: "Merlin Ballroom B", label: "Ballroom B", x: 0, y: 9.75, w: 13.6, h: 9.75 },
      { name: "Merlin Ballroom C", label: "Ballroom C", x: 13.6, y: 0, w: 15.8, h: 19.5 },
      { name: "Vanda", x: 34.4, y: 0, w: 7.6, h: 11.1 },
      { name: "Mokara 1", x: 44.6, y: 0, w: 8.5, h: 3.8 },
      { name: "Mokara 2", x: 44.6, y: 3.8, w: 8.5, h: 3.8 },
      { name: "Farland", x: 44.6, y: 10.2, w: 6.8, h: 3.4 },
    ],
    unions: [
      { name: "Merlin Grand Ballroom", of: ["Merlin Ballroom A", "Merlin Ballroom B", "Merlin Ballroom C"] },
      { name: "Merlin Ballroom A & B", of: ["Merlin Ballroom A", "Merlin Ballroom B"] },
      { name: "Mokara 1 & 2", of: ["Mokara 1", "Mokara 2"] },
    ],
    partitions: [
      [13.6, 0, 13.6, 19.5],
      [0, 9.75, 13.6, 9.75],
      [44.6, 3.8, 53.1, 3.8],
    ],
    note: "schematic from published room sizes · not an official floor plan",
  },
};

const PX = 22; // точек SVG на метр
const PAD = 40;

/** Размеры зала из заметок базы: «29.4 x 19.5 x 4.7 m» → [29.4, 19.5]. */
export const spaceDims = (notes?: string | null): [number, number] | null => {
  const m = String(notes ?? "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*m\b/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  return w > 0 && h > 0 ? [w, h] : null;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const spaceOf = (vid: string, name: string) =>
  SPACES(vid).find((s) => String(s.name) === name) as Record<string, unknown> | undefined;

const capLine = (s?: Record<string, unknown>) => {
  if (!s) return "";
  const nums = [s.capBanquet, s.capCocktail, s.capTheatre]
    .map((v) => parseInt(String(v ?? ""), 10))
    .filter((n) => n > 0);
  if (!nums.length) return "";
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? `${hi} pax` : `${lo}–${hi} pax`;
};

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// Метровая сетка и масштабная линейка — общие для обоих видов схемы.
const gridDefs = `<defs><pattern id="m" width="${PX}" height="${PX}" patternUnits="userSpaceOnUse"><path d="M${PX} 0H0V${PX}" fill="none" stroke="#ffffff" stroke-opacity=".06" stroke-width="1"/></pattern></defs>`;
const scaleBar = (x: number, y: number, meters: number) =>
  `<g font-family="Arial,sans-serif" font-size="13" fill="#8a8d93"><path d="M${x} ${y}h${meters * PX}M${x} ${y - 5}v10M${x + meters * PX} ${y - 5}v10" stroke="#8a8d93" stroke-width="2"/><text x="${x + (meters * PX) / 2}" y="${y - 10}" text-anchor="middle">${meters} m</text></g>`;

export type VenuePlan = {
  image: { src: string; w: number; h: number };
  /** центр зала в координатах мира плана (ширина PLAN_WORLD) */
  anchor: (roomName: string) => { x: number; y: number } | null;
  /** места для блоков внутри зала: i-й из n — сеткой по залу */
  slot?: (i: number, n: number) => { x: number; y: number };
};

/** Схема всей площадки: только там, где известна раскладка залов. */
export function venuePlan(vid: string): VenuePlan | null {
  const L = LAYOUTS[vid];
  if (!L) return null;
  const maxX = Math.max(...L.rooms.map((r) => r.x + r.w));
  const maxY = Math.max(...L.rooms.map((r) => r.y + r.h));
  const W = Math.round(maxX * PX + PAD * 2);
  const H = Math.round(maxY * PX + PAD * 2 + 70);
  const X = (m: number) => PAD + m * PX;
  const Y = (m: number) => PAD + 30 + m * PX;

  const rooms = L.rooms
    .map((r) => {
      const s = spaceOf(vid, r.name);
      const cx = X(r.x + r.w / 2);
      const cy = Y(r.y + r.h / 2);
      const small = r.w * PX < 170 || r.h * PX < 80;
      const sqm = Math.round(r.w * r.h);
      const cap = capLine(s);
      return `<g><rect x="${X(r.x)}" y="${Y(r.y)}" width="${r.w * PX}" height="${r.h * PX}" fill="#ffffff" fill-opacity=".035" stroke="#c9cbd0" stroke-opacity=".7" stroke-width="3"/>
<text x="${cx}" y="${cy - (small ? 4 : 14)}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="${small ? 13 : 18}" fill="#ffffff" fill-opacity=".8">${esc(r.label ?? r.name)}</text>
<text x="${cx}" y="${cy + (small ? 12 : 8)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${small ? 11 : 13}" fill="#8a8d93">${r.w} × ${r.h} m · ${sqm} m²</text>
${cap && !small ? `<text x="${cx}" y="${cy + 28}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#8a8d93">${cap}</text>` : ""}</g>`;
    })
    .join("");
  const parts = L.partitions
    .map(
      ([x1, y1, x2, y2]) =>
        `<path d="M${X(x1)} ${Y(y1)}L${X(x2)} ${Y(y2)}" stroke="#e5231b" stroke-opacity=".7" stroke-width="3" stroke-dasharray="10 7"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${gridDefs}
<rect width="${W}" height="${H}" fill="#0c0d10"/><rect width="${W}" height="${H}" fill="url(#m)"/>
<text x="${PAD}" y="${PAD + 4}" font-family="Arial,sans-serif" font-weight="700" font-size="16" fill="#ffffff" fill-opacity=".75">${esc(L.title)}</text>
${rooms}${parts}
${scaleBar(PAD, H - 26, 10)}
<text x="${W - PAD}" y="${H - 22}" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#55585e">${esc(L.note)}</text></svg>`;

  const k = PLAN_WORLD / W;
  // составной зал — значок у верхней стены: в центре он лёг бы на значки
  // своих же секций
  const isUnion = (name: string) => L.unions.some((u) => u.name === name);
  const rectOf = (name: string): Rect | null => {
    const r = L.rooms.find((x) => x.name === name);
    if (r) return r;
    const u = L.unions.find((x) => x.name === name);
    if (!u) return null;
    const rs = L.rooms.filter((x) => u.of.includes(x.name));
    if (!rs.length) return null;
    const x = Math.min(...rs.map((q) => q.x));
    const y = Math.min(...rs.map((q) => q.y));
    return {
      x,
      y,
      w: Math.max(...rs.map((q) => q.x + q.w)) - x,
      h: Math.max(...rs.map((q) => q.y + q.h)) - y,
    };
  };
  return {
    image: { src: svgUrl(svg), w: W, h: H },
    anchor: (name) => {
      const r = rectOf(name);
      // значок — чуть выше центра: подпись под ним не наезжает на надписи зала
      if (!r) return null;
      return isUnion(name)
        ? { x: X(r.x + r.w / 2) * k, y: (Y(r.y) - 4) * k }
        : { x: X(r.x + r.w / 2) * k, y: (Y(r.y + r.h / 2) - 34) * k };
    },
  };
}

/** Схема одного зала: прямоугольник в масштабе с метровой сеткой. */
export function roomPlan(vid: string, roomName: string): VenuePlan | null {
  const s = spaceOf(vid, roomName);
  const dims = spaceDims(s?.notes as string | undefined);
  if (!dims) return null;
  const [mw, mh] = dims;
  // длинный зал (пляж 120 × 46 м) рисуем мельче, чтобы схема не была километровой
  const px = Math.max(6, Math.min(PX * 1.6, 900 / Math.max(mw, mh)));
  const W = Math.round(mw * px + PAD * 2);
  const H = Math.round(mh * px + PAD * 2 + 60);
  const step = mw > 60 ? 10 : mw > 25 ? 5 : 1; // шаг сетки, метры
  const cap = capLine(s);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><pattern id="g" width="${step * px}" height="${step * px}" patternUnits="userSpaceOnUse" x="${PAD}" y="${PAD + 30}"><path d="M${step * px} 0H0V${step * px}" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="1"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#0c0d10"/>
<text x="${PAD}" y="${PAD + 4}" font-family="Arial,sans-serif" font-weight="700" font-size="16" fill="#ffffff" fill-opacity=".75">${esc(roomName)} · ${mw} × ${mh} m${cap ? " · " + cap : ""}</text>
<rect x="${PAD}" y="${PAD + 30}" width="${mw * px}" height="${mh * px}" fill="url(#g)" stroke="#c9cbd0" stroke-opacity=".7" stroke-width="3"/>
<g font-family="Arial,sans-serif" font-size="13" fill="#8a8d93"><path d="M${PAD} ${H - 26}h${step * px}M${PAD} ${H - 31}v10M${PAD + step * px} ${H - 31}v10" stroke="#8a8d93" stroke-width="2"/><text x="${PAD + step * px + 10}" y="${H - 21}">${step} m</text></g>
<text x="${W - PAD}" y="${H - 22}" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#55585e">schematic from published room size</text></svg>`;
  const k = PLAN_WORLD / W;
  return {
    image: { src: svgUrl(svg), w: W, h: H },
    // сам зал — у верхней стены, его блоки — сеткой по залу ниже
    anchor: () => ({ x: (PAD + (mw * px) / 2) * k, y: (PAD + 30 + 40) * k }),
    slot: (i, n) => {
      const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * (mw / mh)))));
      const rows = Math.ceil(n / cols);
      const c = i % cols;
      const r = Math.floor(i / cols);
      const top = 110; // под значком зала
      return {
        x: (PAD + ((c + 0.5) * mw * px) / cols) * k,
        y: (PAD + 30 + top + ((r + 0.5) * (mh * px - top - 20)) / rows) * k,
      };
    },
  };
}
