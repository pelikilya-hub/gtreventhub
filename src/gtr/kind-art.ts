// Знаки блоков события из фирменного пака GTR (public/brand/emoji4):
// красно-белые стикеры в той же манере, что и вся графика продукта.
// Один источник для палитры конструктора и значков на плане.
import type { NodeKind } from "./data/app-data";
import { STK, type StkName } from "./ui";

export const KIND_STK: Record<NodeKind, StkName> = {
  venue: "pin",
  room: "door",
  slot: "clock",
  tech: "equalizer",
  promo: "ticket",
  money: "hundred",
  doc: "handshake",
  artist: "mic",
  staff: "crown",
  sound: "speaker",
  light: "disco",
  decor: "palm",
  content: "camera",
  gear: "fader",
  interactive: "dance",
};

export const kindArt = (k: NodeKind): string => STK[KIND_STK[k]];

// Значки кнопок холста: тонкая линия 24×24, одна манера для всех действий.
export const UI_IC = {
  plus: "M12 5v14 M5 12h14",
  minus: "M5 12h14",
  fit: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1 M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h.01",
  enter: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4 M10 16l4-4-4-4 M14 12H3",
  exit: "M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4 M15 16l4-4-4-4 M19 12H8",
  back: "M15 18l-6-6 6-6",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5h.01",
  contrast: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 3v18 M12 3a9 9 0 0 1 0 18z",
  trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14",
  cards: "M4 5h7v6H4z M13 5h7v6h-7z M4 13h7v6H4z M13 13h7v6h-7z",
  close: "M6 6l12 12 M18 6L6 18",
  undo: "M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  wand: "M3 21l11-11 M14 4V2 M14 12v-2 M18 8h2 M8 8h2 M17 5l1.5-1.5 M17 11l1.5 1.5 M11 5L9.5 3.5",
  arrow: "M5 12h14 M13 6l6 6-6 6",
} as const;
