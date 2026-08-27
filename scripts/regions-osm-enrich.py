# Обогащение паспортов регионов данными OpenStreetMap.
#
# У части заведений в OSM проставлены website, phone и opening_hours —
# это данные, которые ставили сами владельцы или местные картографы, и
# для нас они лучше любых догадок. Берём только пустые поля: то, что уже
# нашёл разведчик и проверил человек, не перетираем.
#
# Часы работы уезжают в venue-night.json — оттуда их берёт вечерняя
# карточка «куда пойти сегодня». Формат OSM («Mo-Su 11:00-02:00»)
# переводим в человеческий, а что не разобрали — оставляем как есть,
# честно помечая источник.
#
# Запуск: python3 scripts/regions-osm-enrich.py [коды регионов]
import glob, json, os, re, sys, time, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = json.load(open(f"{REPO}/src/gtr/data/regions.json"))
NIGHT_PATH = f"{REPO}/src/gtr/data/venue-night.json"
NIGHT = json.load(open(NIGHT_PATH))
UA = "GTR-Event-geo/1.0 (region enrich)"
BOX = {"smu": 0.14, "pgn": 0.14, "pty": 0.22, "bkk": 0.30, "pna": 0.55}
STOP = {"the", "bar", "club", "beach", "restaurant", "lounge", "rooftop", "hotel",
        "resort", "spa", "cafe", "pub", "and", "koh", "samui", "bangkok", "pattaya"}
DAYS = {"Mo-Su": "ежедневно", "Mo-Sa": "пн-сб", "Tu-Su": "вт-вс", "We-Su": "ср-вс",
        "Th-Su": "чт-вс", "Fr-Sa": "пт-сб", "Mo-Fr": "будни", "Sa-Su": "выходные"}


def words(s):
    return {w for w in re.split(r"[^a-z0-9]+", s.lower()) if len(w) > 2 and w not in STOP}


def same_place(name, display):
    n, d = name.lower(), display.lower()
    if re.sub(r"[^a-z0-9]", "", n) in re.sub(r"[^a-z0-9]", "", d):
        return True
    w = words(name)
    return bool(w) and len(w & words(display)) / len(w) >= 0.66


def human_hours(raw):
    """«Mo-Su 11:00-02:00» -> «11:00–02:00 · ежедневно». Не разобрали — как есть."""
    m = re.fullmatch(r"([A-Za-z]{2}-[A-Za-z]{2})\s+(\d{2}:\d{2})-(\d{2}:\d{2})", raw.strip())
    if not m:
        return raw.strip()
    day = DAYS.get(m.group(1), m.group(1))
    return f"{m.group(2)}–{m.group(3)} · {day}"


def search(name, box):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": name, "format": "jsonv2", "limit": 3, "bounded": 1, "extratags": 1,
        "viewbox": f"{box[0]},{box[1]},{box[2]},{box[3]}",
    })
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=15) as r:
            return json.load(r)
    except Exception:
        return []


def main():
    codes = sys.argv[1:]
    sites = phones = hours = 0
    for f in sorted(glob.glob(f"{REPO}/src/gtr/data/regions/[a-z][a-z][a-z].json")):
        code = os.path.basename(f)[:3]
        if codes and code not in codes:
            continue
        reg = REGISTRY[code]
        lat, lon = reg["center"]
        d = BOX.get(code, 0.25)
        box = (lon - d, lat + d, lon + d, lat - d)
        doc = json.load(open(f))
        touched = 0
        for v in doc["venues"]:
            need_site = not (v.get("website") or "").strip()
            need_phone = not (v.get("phone") or "").strip()
            need_hours = not (NIGHT.get(v["id"]) or {}).get("hours")
            if not (need_site or need_phone or need_hours):
                continue
            hit = None
            for cand in search(v["name"], box):
                if same_place(v["name"], cand.get("display_name", "")):
                    hit = cand
                    break
            time.sleep(1.05)
            tags = (hit or {}).get("extratags") or {}
            if not tags:
                continue
            site = tags.get("website") or tags.get("contact:website") or ""
            if need_site and site.startswith("http"):
                v["website"] = site
                sites += 1
                touched += 1
            tel = tags.get("phone") or tags.get("contact:phone") or ""
            if need_phone and tel:
                v["phone"] = tel
                phones += 1
                touched += 1
            oh = tags.get("opening_hours") or ""
            if need_hours and oh:
                ent = NIGHT.setdefault(v["id"], {})
                ent["hours"] = human_hours(oh)
                ent.setdefault("src", "OpenStreetMap")
                hours += 1
        if touched:
            with open(f, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False, indent=1)
                fh.write("\n")
        print(f"{code}: обогащено полей {touched}")
    with open(NIGHT_PATH, "w", encoding="utf-8") as fh:
        json.dump(NIGHT, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"из OSM: сайтов {sites}, телефонов {phones}, часов работы {hours}")


if __name__ == "__main__":
    main()
