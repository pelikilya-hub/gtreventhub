# Координаты площадки с её собственного сайта.
#
# Половина заведений Самуи и Пангана не заведена в OpenStreetMap — их
# точку взять неоткуда. Но на своём сайте площадка почти всегда сама
# показывает, где она: карта на странице контактов, ссылка «проложить
# маршрут», микроразметка адреса. Это первоисточник — точнее не бывает.
#
# Ищем на главной и на странице контактов, принимаем только координату
# внутри рамки региона: чужой офис сети в Бангкоке нам не нужен.
#
# Запуск: python3 scripts/regions-geo-site.py [коды регионов]
import glob, json, os, re, subprocess, sys
from urllib.parse import urljoin

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = json.load(open(f"{REPO}/src/gtr/data/regions.json"))
GEO_PATH = f"{REPO}/src/gtr/data/venue-geo.json"
GEO = json.load(open(GEO_PATH))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
BOX = {"smu": 0.16, "pgn": 0.16, "pty": 0.25, "bkk": 0.35, "pna": 0.60}

# Порядок важен: сначала явные координаты карты, потом микроразметка.
PATTERNS = [
    r"@(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})",              # google maps @lat,lng
    r"!3d(-?\d{1,2}\.\d{4,})!4d(-?\d{1,3}\.\d{4,})",             # embed !3d!4d
    r"[?&]q=(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})",         # ?q=lat,lng
    r"[?&]ll=(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})",        # ?ll=lat,lng
    r"destination=(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})",   # маршрут
    r'"latitude"\s*:\s*"?(-?\d{1,2}\.\d{4,})"?[^}]{0,80}?"longitude"\s*:\s*"?(-?\d{1,3}\.\d{4,})"?',
    r'data-lat="(-?\d{1,2}\.\d{4,})"[^>]{0,120}?data-lng="(-?\d{1,3}\.\d{4,})"',
    r'name="geo\.position"\s+content="(-?\d{1,2}\.\d{4,});\s*(-?\d{1,3}\.\d{4,})"',
]


def fetch(url):
    r = subprocess.run(["curl", "-sL", "--max-time", "25", "-A", UA, url], capture_output=True)
    return r.stdout.decode("utf-8", "ignore")


def coords_in(page, center, d):
    for pat in PATTERNS:
        for lat, lon in re.findall(pat, page):
            try:
                la, lo = float(lat), float(lon)
            except ValueError:
                continue
            if abs(la - center[0]) <= d and abs(lo - center[1]) <= d + 0.2:
                return la, lo
    return None


def main():
    codes = sys.argv[1:]
    found = tried = 0
    for f in sorted(glob.glob(f"{REPO}/src/gtr/data/regions/[a-z][a-z][a-z].json")):
        code = os.path.basename(f)[:3]
        if codes and code not in codes:
            continue
        reg = REGISTRY[code]
        d = BOX.get(code, 0.3)
        for v in json.load(open(f))["venues"]:
            if GEO.get(v["id"]):
                continue
            site = (v.get("website") or "").strip()
            if not site.startswith("http"):
                continue
            tried += 1
            page = fetch(site)
            pt = coords_in(page, reg["center"], d)
            # Контакты обычно на отдельной странице — идём по первой
            # подходящей ссылке, но не глубже: сайт мы не обходим целиком.
            if not pt:
                for href in re.findall(r'href="([^"]{0,120}(?:contact|location|find-us|kontakt)[^"]{0,40})"', page, re.I)[:2]:
                    sub = fetch(urljoin(site, href))
                    pt = coords_in(sub, reg["center"], d)
                    if pt:
                        break
            if pt:
                GEO[v["id"]] = {"lat": round(pt[0], 5), "lon": round(pt[1], 5), "src": "site-map"}
                found += 1
                print(f"  {v['id']} OK {v['name'][:40]}")
    with open(GEO_PATH, "w", encoding="utf-8") as fh:
        json.dump(GEO, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"с сайтов площадок: проверено {tried}, координат найдено {found}")


if __name__ == "__main__":
    main()
