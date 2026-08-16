// Язык карты: категория площадки — знак плюс цвет.
//
// Знак несёт смысл, цвет — только группировку. Так сделано намеренно:
// одиннадцать цветов на тёмной карте различить трудно, а пальму от
// диско-шара глаз отличает мгновенно, даже боковым зрением.
//
// Про цвета отдельно. В конструкторе события своя палитра ролей —
// площадка, зал, слот, техника, промо и так далее, одиннадцать значений.
// Совпадать они не должны: один и тот же цвет не может означать «зал» на
// одном экране и «крышу» на другом. Палитра карты подобрана и измерена
// против конструкторской по CIE-расстоянию в Lab: минимум по всем парам
// — 20 единиц, то есть цвета различимы не «на глаз опытного дизайнера»,
// а численно. Заодно карта живёт в другом регистре: светлые тона на
// чёрном против плотных примитивов конструктора.

export type MapCat = {
  tag: string;
  ru: string;
  color: string;
  sticker: string;
};

export const MAP_CATS: MapCat[] = [
  { tag: "Beach club", ru: "Пляжный клуб", color: "#F08C51", sticker: "palm" },
  { tag: "Nightclub", ru: "Ночной клуб", color: "#C77DFF", sticker: "discoball2" },
  { tag: "Rooftop", ru: "Крыша", color: "#7DE2FF", sticker: "moon" },
  { tag: "Bar / Lounge", ru: "Бар и лаунж", color: "#E8C07D", sticker: "cocktail" },
  { tag: "Resort / MICE", ru: "Отель и банкет", color: "#A8E06B", sticker: "crown2" },
  { tag: "Marina / Yacht", ru: "Марина", color: "#8FA8FF", sticker: "champagne2" },
  { tag: "Show / Park", ru: "Шоу и парк", color: "#FF7DC8", sticker: "star" },
  { tag: "Live music", ru: "Живая музыка", color: "#FF6F6F", sticker: "mic" },
  { tag: "Event space", ru: "Событийная площадка", color: "#9EFFC2", sticker: "fader" },
  { tag: "Villa", ru: "Вилла", color: "#D9B8FF", sticker: "door" },
  { tag: "Other", ru: "Прочее", color: "#4A5085", sticker: "pin" },
];

const BY_TAG = new Map(MAP_CATS.map((c) => [c.tag, c]));
export const catOf = (tag: string): MapCat => BY_TAG.get(tag) ?? MAP_CATS[MAP_CATS.length - 1];

export const stickerUrl = (name: string) => `/brand/emoji4/${name}-256.png`;

/** Разметка точки на карте.
 *
 *  Точка компактная: знак 20 точек в кольце категории. Кольцо тонкое —
 *  на карте с сотней точек толстая обводка сливается в кашу. Приблизительный
 *  адрес отличается пунктиром: менеджеру видно, где геокод точный, а где
 *  мы поставили центр района. */
export const pinHtml = (cat: MapCat, exact: boolean, dim: boolean): string => {
  const ring = exact ? `1.5px solid ${cat.color}` : `1.5px dashed ${cat.color}`;
  return `<span class="gtr-map-pin${dim ? " off" : ""}" style="--c:${cat.color};border:${ring}">
    <img src="${stickerUrl(cat.sticker)}" alt="" />
  </span>`;
};
