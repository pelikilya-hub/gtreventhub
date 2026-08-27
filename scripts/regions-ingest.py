# Приёмка сырья разведчиков в региональные базы (волна B и дальше).
#
# Разведчики пишут пачки JSON, качество у пачек разное: где-то пустой
# источник, где-то кластер назван по-своему, где-то площадка уже есть в
# базе под другим написанием. Скрипт — это фильтр между сырьём и базой:
# он ничего не досочиняет, а либо приводит запись к схеме, либо
# откладывает её с причиной.
#
# Правила отказа (площадка НЕ попадает в базу):
#   - нет имени;
#   - нет ни source, ни website — площадку нечем подтвердить;
#   - кластер не опознан по словарю региона.
# Координаты проверяем через OSM Nominatim: расхождение с агентской
# точкой больше 2,5 км — верим OSM.
#
# Запуск: python3 scripts/regions-ingest.py <папка с сырьём> <метка волны>
import glob, json, math, os, re, sys, time, html, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else "."
WAVE = sys.argv[2] if len(sys.argv) > 2 else "B"
REGISTRY = json.load(open(f"{REPO}/src/gtr/data/regions.json"))
GEO_PATH = f"{REPO}/src/gtr/data/venue-geo.json"
GEO = json.load(open(GEO_PATH))
BASE = json.load(open(f"{REPO}/src/gtr/data/venues.json"))

# Канон приложения (map-style MAP_CATS): по этим тегам красятся точки на
# карте и собираются фильтры. Разведчики пишут как придётся — приводим.
TAGS_OK = {"Beach club", "Nightclub", "Rooftop", "Bar / Lounge", "Resort / MICE",
           "Marina / Yacht", "Show / Park", "Live music", "Event space", "Villa", "Other"}
TAG_ALIAS = {"bar / lounge": "Bar / Lounge", "restaurant / bar": "Bar / Lounge",
             "hotel / resort": "Resort / MICE", "resort": "Resort / MICE",
             "marina": "Marina / Yacht", "restaurant": "Bar / Lounge"}
BBOX_D = {"smu": 0.35, "pgn": 0.35, "pty": 0.30, "bkk": 0.40, "pna": 0.60}
UA = "GTR-Event-geo/1.0 (region ingest)"

norm = lambda s: re.sub(r"[^a-zа-я0-9]+", "", (s or "").lower())


def clean(s):
    return html.unescape(str(s)).replace("&amp;", "&").strip() if isinstance(s, str) else ""


def dist_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "countrycodes": "th"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=15) as r:
            j = json.load(r)
            if j:
                return float(j[0]["lat"]), float(j[0]["lon"])
    except Exception:
        pass
    return None


def match_cluster(raw, clusters):
    """Кластер из словаря региона по имени или по общему слову."""
    raw = clean(raw)
    for c in clusters:
        if norm(c) == norm(raw):
            return c
    words = {w for w in re.split(r"[^A-Za-zА-Яа-я]+", raw.lower()) if len(w) > 3}
    for c in clusters:
        cw = {w for w in re.split(r"[^A-Za-zА-Яа-я]+", c.lower()) if len(w) > 3}
        if words & cw:
            return c
    return ""


def match_tag(raw, type_hint):
    raw = clean(raw)
    for t in TAGS_OK:
        if norm(t) == norm(raw):
            return t
    if raw.lower().strip() in TAG_ALIAS:
        return TAG_ALIAS[raw.lower().strip()]
    hay = f"{raw} {type_hint}".lower()
    for probe, tag in [("beach", "Beach club"), ("roof", "Rooftop"), ("club", "Nightclub"),
                       ("live", "Live music"), ("event", "Event space"), ("arena", "Event space"),
                       ("marina", "Marina / Yacht"), ("yacht", "Marina / Yacht"),
                       ("hotel", "Resort / MICE"), ("resort", "Resort / MICE"),
                       ("villa", "Villa"), ("show", "Show / Park")]:
        if probe in hay:
            return tag
    return "Bar / Lounge"


def main():
    # всё, что уже есть в базе: имена — чтобы не завести дубль под другим написанием
    seen = {norm(v["name"]) for v in BASE["venues"]}
    reports = []
    for code in sorted(REGISTRY):
        reg = REGISTRY[code]
        path = f"{REPO}/src/gtr/data/regions/{code}.json"
        if not os.path.exists(path):
            continue
        doc = json.load(open(path))
        for v in doc["venues"]:
            seen.add(norm(v["name"]))
        nmax = max([int(v["id"].split("-")[-1]) for v in doc["venues"]] or [0])
        added, skipped = [], []
        for f in sorted(glob.glob(f"{SRC}/{code}-*.json")):
            try:
                raw = json.load(open(f))
            except Exception as e:
                print(f"  {os.path.basename(f)}: не парсится — {e}")
                continue
            for v in raw.get("venues", []):
                name = clean(v.get("name"))
                if not name:
                    continue
                if norm(name) in seen:
                    skipped.append((name, "уже в базе"))
                    continue
                # Разведчики пишут сайт то ссылкой, то голым доменом, а источник
                # иногда называют словом («Tripadvisor»). Ссылку достраиваем,
                # словесный источник принимаем как есть — валидатор пометит его
                # предупреждением, и при первом контакте он будет заменён. Без
                # источника вообще площадку не берём: подтвердить нечем.
                site = clean(v.get("website"))
                if site and not site.startswith("http"):
                    site = "https://" + site.lstrip("/")
                source = clean(v.get("source")) or site
                if not source:
                    skipped.append((name, "нет источника"))
                    continue
                cluster = match_cluster(v.get("cluster"), reg["clusters"])
                if not cluster:
                    skipped.append((name, f"кластер «{clean(v.get('cluster'))}» не опознан"))
                    continue
                seen.add(norm(name))
                nmax += 1
                vid = f"{reg['prefix']}-{nmax:04d}"
                tag = match_tag(v.get("tag"), v.get("type"))
                # координата: агентская против OSM
                lat, lon = v.get("lat"), v.get("lon")
                pt = (lat, lon) if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and lat and lon else None
                got = nominatim(f"{name}, {clean(v.get('district')) or reg['en']}")
                time.sleep(1.05)
                c, d = reg["center"], BBOX_D.get(code, 0.4)
                if got and abs(got[0] - c[0]) <= d and abs(got[1] - c[1]) <= d + 0.2:
                    if pt and dist_km(pt, got) <= 2.5:
                        GEO[vid] = {"lat": round(pt[0], 5), "lon": round(pt[1], 5), "src": "agent-sweep+osm-ok"}
                    else:
                        GEO[vid] = {"lat": round(got[0], 5), "lon": round(got[1], 5), "src": "osm-nominatim"}
                elif pt and abs(pt[0] - c[0]) <= d and abs(pt[1] - c[1]) <= d + 0.2:
                    GEO[vid] = {"lat": round(pt[0], 5), "lon": round(pt[1], 5), "src": "agent-sweep"}
                notes = clean(v.get("notes"))
                tail = f"Волна {WAVE}: автосбор агентом-разведчиком, факты сверить при первом контакте."
                added.append({
                    "id": vid, "name": name,
                    "type": clean(v.get("type")) or tag, "tag": tag,
                    "area": clean(v.get("area")) or cluster,
                    "cluster": cluster,
                    "district": clean(v.get("district")) or reg["en"],
                    "region": code,
                    "concept": clean(v.get("concept")), "events": clean(v.get("events")),
                    "facilities": clean(v.get("facilities")), "capacity": clean(v.get("capacity")),
                    "catering": clean(v.get("catering")), "music": clean(v.get("music")),
                    "address": clean(v.get("address")), "phone": clean(v.get("phone")),
                    "email": clean(v.get("email")), "website": site,
                    "social": clean(v.get("social")), "source": source,
                    "sourceType": f"region-sweep-2026-{WAVE.lower()}",
                    "confidence": (clean(v.get("confidence")) or "medium").lower(),
                    "status": "active", "verified": False,
                    "notes": (notes + (" " if notes else "") + tail),
                    "readiness": "",
                })
        if not added and not skipped:
            continue
        doc["venues"] += added
        doc["meta"]["total"] = len(doc["venues"])
        doc["meta"]["updated"] = "2026-08-27"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write("\n")
        geo_n = sum(1 for v in added if GEO.get(v["id"]))
        reports.append((code, len(added), geo_n, skipped))
        print(f"{code}: +{len(added)} (с координатой {geo_n}), отклонено {len(skipped)}")

    with open(GEO_PATH, "w", encoding="utf-8") as f:
        json.dump(GEO, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("\nотклонённые:")
    for code, _, _, skipped in reports:
        for name, why in skipped:
            print(f"  {code} · {name}: {why}")


if __name__ == "__main__":
    main()
