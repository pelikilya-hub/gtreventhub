import type * as LType from "leaflet";

// Тёмная подложка карты в цвет продукта.
//
// История вопроса. Сначала стояли тёмные плитки CARTO — они внезапно
// потребовали API-ключ и вывесили «API KEY REQUIRED» прямо на проде.
// Переехали на OpenStreetMap: он бесплатный и без ключа, но светлый.
// Покрасить его в чёрный фильтром нельзя красиво: на светлой карте дороги
// СВЕТЛЕЕ земли, и после инверсии они становятся ТЕМНЕЕ земли — выходит
// серая каша, а не карта. Поэтому основной слой — настоящая тёмная
// картография Esri Dark Gray Canvas (без ключа), а OSM остаётся страховкой.
//
// Урок CARTO закрыт фолбэком: если подложка перестанет отдавать плитки,
// карта сама перейдёт на OSM с затемняющим фильтром, а не покажет пустоту
// или чужой водяной знак.

const ESRI_DARK =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const OSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Сколько битых плиток подряд считаем отказом источника. Одиночные
 *  промахи — обычное дело на краю мира и при быстром зуме. */
const FAIL_LIMIT = 6;

export function addDarkBasemap(L: typeof LType, map: LType.Map): LType.TileLayer {
  let fails = 0;
  let swapped = false;

  const osm = () =>
    L.tileLayer(OSM, {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
      className: "gtr-tiles-osm",
    });

  const esri = L.tileLayer(ESRI_DARK, {
    attribution: "&copy; Esri · OpenStreetMap contributors",
    // Тёмная подложка Esri нарезана до 16-го зума; дальше Leaflet тянет
    // последний доступный уровень, иначе на приближении был бы провал.
    maxZoom: 19,
    maxNativeZoom: 16,
    className: "gtr-tiles-dark",
  });

  esri.on("tileerror", () => {
    if (swapped) return;
    fails += 1;
    if (fails < FAIL_LIMIT) return;
    swapped = true;
    map.removeLayer(esri);
    osm().addTo(map);
  });

  esri.addTo(map);
  return esri;
}
