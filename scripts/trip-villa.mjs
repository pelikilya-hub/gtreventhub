// Извлечение виллы с trip.com в формат нашей базы.
//   node scripts/trip-villa.mjs "<ссылка trip.com>" [VEN-0107]
// Печатает готовые куски для venues.json / venue-geo.json / rich.json /
// villas.json. Ничего сам не пишет — правки в базу делаем осознанно.
//
// Цена: со страницы забирается SEO-поле «Средняя цена от». Оно НЕ всегда
// за ночь (иногда — за весь выбранный период), поэтому кладём его как
// basePriceRaw + пометку needsPriceCheck. Наценка GTR считается от
// подтверждённой базы, а не от догадки.

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export const MARKUP = 1.15; // прайс GTR = trip.com +15%

const arg = process.argv[2];
const forcedId = process.argv[3];
if (!arg) {
  console.error('Использование: node scripts/trip-villa.mjs "<ссылка trip.com>" [VEN-0107]');
  process.exit(1);
}

const hid = new URL(arg).searchParams.get("h-id") || new URL(arg).searchParams.get("hotelId");
if (!hid) {
  console.error("В ссылке нет h-id / hotelId — это не страница объекта trip.com");
  process.exit(1);
}

const get = async (url) => {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9" },
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
};

const nextData = (html) => {
  const m = html.match(/__NEXT_DATA__[^>]*>(\{.*?\})<\/script>/s);
  if (!m) throw new Error("на странице нет __NEXT_DATA__ — вёрстка trip.com изменилась");
  return JSON.parse(m[1]);
};

const villaUrl = `https://www.trip.com/m/vacation-rentals/w/detail?h-id=${hid}&locale=ru-RU&curr=THB`;
const seoUrl = `https://www.trip.com/hotels/detail/?hotelId=${hid}&curr=THB&locale=ru-RU`;

const detail = nextData(await get(villaUrl)).props.pageProps.initialState.detailResponse;
const seoHtml = await get(seoUrl);

const base = detail.hotelBaseInfo ?? {};
const pos = detail.hotelPositionInfo ?? {};
const desc = detail.hotelDescriptionInfo ?? {};
const comment = detail.hotelComment?.comment ?? {};
const imgs = detail.hotelTopImage?.imgUrlList ?? [];
const coord = (pos.hotelCoordinateInfoList ?? [])[0] ?? {};

// цена: SEO-блок «Средняя цена от»
const priceMatch = seoHtml.match(/Средняя цена от[^}]*?answer\\*"\s*:\s*\\*"([A-Z]{3})([\d,.]+)/);
const currency = priceMatch?.[1] ?? "THB";
const basePriceRaw = priceMatch ? Number(priceMatch[2].replace(/[,\s]/g, "")) : null;

const photos = imgs.filter((i) => i.imgUrl).map((i) => i.imgUrl);
const video = imgs.find((i) => i.videoUrl)?.videoUrl ?? "";
const tel = (base.tels ?? [])[0]?.call ?? "";
const facilities = (detail.hotelFacilityBelt?.facilityList ?? [])
  .map((f) => f.facilityNameV2 || f.facilityDesc)
  .filter(Boolean);

const id = forcedId || "VEN-XXXX";
const out = {
  venue: {
    catering: "External / confirm",
    phone: tel,
    email: "",
    website: `https://www.trip.com/hotels/detail/?hotelId=${hid}`,
    social: "",
    sourceType: "trip.com",
    confidence: "high",
    status: "active",
    verified: false,
    notes: `Вилла из trip.com (id ${hid}). Бронь и занятость — на стороне trip.com. Цена «${currency} ${basePriceRaw}» взята из SEO-поля «Средняя цена от» и НЕ подтверждена как ставка за ночь — сверить перед продажей.`,
    readiness: "",
    id,
    name: base.nameInfo?.name ?? "",
    type: "Private villa",
    tag: "Villa",
    area: pos.addressEn || "",
    cluster: "",
    district: "",
    concept: (desc.propertyHostInfo?.propertyInfo?.hostIntro ?? "").trim().slice(0, 600),
    events: "Приватные события; вечеринки у бассейна; ретриты; съёмки",
    facilities: facilities.join("; "),
    capacity: "",
    music: "Приватная — по договорённости с владельцем",
    address: pos.address ?? "",
    source: villaUrl,
  },
  geo: coord.latitude
    ? { [id]: { lat: Number(coord.latitude), lon: Number(coord.longitude), src: "trip.com" } }
    : null,
  rich: {
    [id]: {
      src: "TRIP.COM",
      credit: `${base.nameInfo?.name ?? ""} · trip.com`,
      hero: photos[1] ?? photos[0] ?? "",
      video,
      gallery: photos.slice(0, 10),
    },
  },
  villa: {
    id,
    tripId: Number(hid),
    tripUrl: `https://www.trip.com/hotels/detail/?hotelId=${hid}`,
    stars: base.starInfo?.level ?? null,
    rating: comment.score ? Number(comment.score) : null,
    ratingOf: comment.fullRating ? Number(comment.fullRating) : 10,
    reviews: comment.totalComment ?? 0,
    host: desc.propertyHostInfo?.hostInfo?.nickName ?? "",
    hostLangs: desc.propertyHostInfo?.hostInfo?.languageSkill ?? "",
    currency,
    basePriceRaw,
    // Наценка GTR. Считается от подтверждённой базы — пока база не
    // подтверждена, gtrPrice остаётся null, чтобы в продукт не утекла
    // цифра, взятая из неоднозначного SEO-поля.
    markup: MARKUP,
    gtrPrice: null,
    needsPriceCheck: true,
    openedYear: base.openYear ?? "",
    photos,
    video,
  },
};

console.log(JSON.stringify(out, null, 1));
