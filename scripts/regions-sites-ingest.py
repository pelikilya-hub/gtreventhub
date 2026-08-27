# Приёмка сайтов и контактов, найденных агентами-разведчиками.
#
# Агент видит только выдачу поиска и ошибается двумя способами: даёт
# ссылку на агрегатор вместо самой площадки и даёт домен, которого уже
# нет. Поэтому каждый URL здесь пробивается запросом: не ответил кодом
# 200 — не берём. Агрегаторы отсекаем списком: booking и tripadvisor в
# поле «официальный сайт» — это ложь в паспорте.
#
# Занятые поля не трогаем: то, что уже проверено, ценнее свежей находки.
#
# Запуск: python3 scripts/regions-sites-ingest.py <папка с sites-*.json>
import glob, json, os, re, subprocess, sys
from urllib.parse import urlparse

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else "."
NIGHT_PATH = f"{REPO}/src/gtr/data/venue-night.json"
NIGHT = json.load(open(NIGHT_PATH))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
BAD_HOST = re.compile(
    r"tripadvisor|booking\.com|agoda|expedia|facebook|instagram|foursquare|yelp|"
    r"google\.|maps\.|wikipedia|hotels\.com|trip\.com|klook|getyourguide|"
    r"restaurantguru|wanderlog|thefork", re.I)


def alive(url):
    """Живой ли сайт. Смотрим код ответа: 404 и мёртвый домен не берём."""
    r = subprocess.run(
        ["curl", "-sL", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", "-A", UA, url],
        capture_output=True, text=True)
    return r.stdout.strip() in {"200", "201", "202", "203"}


def main():
    found = {}
    for f in sorted(glob.glob(f"{SRC}/sites-*.json")):
        try:
            for row in json.load(open(f)):
                if row.get("vid"):
                    found[row["vid"]] = row
        except Exception as e:
            print(f"  {os.path.basename(f)}: не парсится — {e}")
    print(f"кандидатов от агентов: {len(found)}")

    took = dead = agg = hours = phones = 0
    for path in sorted(glob.glob(f"{REPO}/src/gtr/data/regions/[a-z][a-z][a-z].json")):
        doc = json.load(open(path))
        touched = 0
        for v in doc["venues"]:
            row = found.get(v["id"])
            if not row:
                continue
            site = (row.get("website") or "").strip()
            if site and not site.startswith("http"):
                site = "https://" + site.lstrip("/")
            if site and not (v.get("website") or "").strip():
                host = urlparse(site).netloc
                if BAD_HOST.search(host):
                    agg += 1
                elif not alive(site):
                    dead += 1
                    print(f"  мёртвая ссылка: {v['name']} — {site}")
                else:
                    v["website"] = site
                    took += 1
                    touched += 1
            tel = (row.get("phone") or "").strip()
            if tel and not (v.get("phone") or "").strip():
                v["phone"] = tel
                phones += 1
                touched += 1
            hrs = (row.get("hours") or "").strip()
            if hrs and not (NIGHT.get(v["id"]) or {}).get("hours"):
                ent = NIGHT.setdefault(v["id"], {})
                ent["hours"] = hrs
                ent.setdefault("src", "разведка GTR")
                hours += 1
        if touched:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False, indent=1)
                fh.write("\n")
    with open(NIGHT_PATH, "w", encoding="utf-8") as fh:
        json.dump(NIGHT, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"принято сайтов {took}, телефонов {phones}, часов работы {hours}; "
          f"отброшено: мёртвых {dead}, агрегаторов {agg}")


if __name__ == "__main__":
    main()
