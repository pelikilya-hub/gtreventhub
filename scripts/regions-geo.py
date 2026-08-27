# Догеокодирование площадок регионов по названию (OSM Nominatim).
#
# Свободный поиск «имя, остров» промахивается по половине заведений, зато
# поиск, ограниченный рамкой региона, находит их уверенно. Но у такого
# поиска есть цена: он охотно отдаёт похожее вместо точного — на запрос
# «Elephant Beach Club» приходит «Red Elephant Beach Club». Поэтому ответ
# принимаем, только если имя действительно совпало: нормализованное имя
# входит в ответ целиком либо совпало не меньше двух третей слов.
#
# Площадка без координаты остаётся без неё — на карту не попадает, но и
# ложной точки в море не появляется.
#
# Запуск: python3 scripts/regions-geo.py [коды регионов]
import glob, json, os, re, sys, time, urllib.parse, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = json.load(open(f"{REPO}/src/gtr/data/regions.json"))
GEO_PATH = f"{REPO}/src/gtr/data/venue-geo.json"
GEO = json.load(open(GEO_PATH))
UA = "GTR-Event-geo/1.0 (region geocode)"
# рамка региона: центр ± дельта по широте и долготе
BOX = {"smu": 0.14, "pgn": 0.14, "pty": 0.22, "bkk": 0.30, "pna": 0.55}
STOP = {"the", "bar", "club", "beach", "restaurant", "lounge", "rooftop", "hotel",
        "resort", "spa", "cafe", "pub", "and", "koh", "samui", "bangkok", "pattaya"}


def words(s):
    return {w for w in re.split(r"[^a-z0-9]+", s.lower()) if len(w) > 2 and w not in STOP}


def same_place(name, display):
    n, d = name.lower(), display.lower()
    if re.sub(r"[^a-z0-9]", "", n) in re.sub(r"[^a-z0-9]", "", d):
        return True
    w = words(name)
    if not w:
        return False
    return len(w & words(display)) / len(w) >= 0.66


def search(name, box):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": name, "format": "json", "limit": 3, "bounded": 1,
        "viewbox": f"{box[0]},{box[1]},{box[2]},{box[3]}",
    })
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=15) as r:
            return json.load(r)
    except Exception:
        return []


def main():
    codes = sys.argv[1:]
    found = miss = 0
    misses = []
    for f in sorted(glob.glob(f"{REPO}/src/gtr/data/regions/[a-z][a-z][a-z].json")):
        code = os.path.basename(f)[:3]
        if codes and code not in codes:
            continue
        reg = REGISTRY[code]
        lat, lon = reg["center"]
        d = BOX.get(code, 0.25)
        box = (lon - d, lat + d, lon + d, lat - d)  # left, top, right, bottom
        for v in json.load(open(f))["venues"]:
            if GEO.get(v["id"]):
                continue
            hit, src = None, "osm-bounded"
            for cand in search(v["name"], box):
                if same_place(v["name"], cand.get("display_name", "")):
                    hit = cand
                    break
            time.sleep(1.05)
            # Заведения нет в OSM — заходим по адресу. Такая точка стоит на
            # улице, а не на двери, поэтому помечаем её отдельным источником:
            # карта покажет её как приблизительную, а не как выверенную.
            if not hit:
                addr = (v.get("address") or "").strip()
                if len(addr) > 12:
                    got = search(addr, box)
                    time.sleep(1.05)
                    if got:
                        hit, src = got[0], "osm-address"
            if hit:
                GEO[v["id"]] = {"lat": round(float(hit["lat"]), 5),
                                "lon": round(float(hit["lon"]), 5), "src": src}
                found += 1
            else:
                miss += 1
                misses.append(f"{code} · {v['name']}")
    with open(GEO_PATH, "w", encoding="utf-8") as f:
        json.dump(GEO, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"координаты: найдено {found}, без координаты {miss}")
    for m in misses:
        print("  нет точки:", m)


if __name__ == "__main__":
    main()
