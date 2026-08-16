#!/usr/bin/env python3
"""Поиск собственных сайтов площадок, у которых в базе нет ссылки.

Сайт нужен не только ради логотипа: разведка афиш ходит ровно по нему,
и площадка без сайта для движка событий невидима. Поэтому находка тут
закрывает сразу две дыры.

Метод простой и проверяемый: собрать правдоподобные имена доменов из
названия площадки и её инстаграм-ника, постучаться в каждый и оставить
только тот, чья страница действительно говорит об этой площадке.

Проверка — самая важная часть. Домен, который просто открылся, ничего
не значит: половина коротких имён занята парковками и заглушками
регистраторов. Поэтому страница обязана: ответить кодом 200, содержать
слова из названия площадки, не быть страницей продажи домена и не
оказаться чужим заведением с похожим именем.
"""

import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUES = os.path.join(ROOT, "src", "gtr", "data", "venues.json")
OUT = os.path.join(ROOT, "scripts", "venue-sites-found.json")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

# Слова, которые есть у половины заведений острова и потому ничего не
# опознают. Из названия их выбрасываем, чтобы остался différentiateur.
GENERIC = {
    "the", "at", "and", "of", "phuket", "thailand", "beach", "club", "bar",
    "lounge", "restaurant", "resort", "hotel", "spa", "pool", "sky", "cafe",
    "café", "villa", "villas", "house", "grill", "kitchen", "rooftop", "sunset",
    "by", "with", "de", "la", "le", "on", "in", "an", "a", "co", "ltd",
}

# Заглушки регистраторов и парковки: домен открылся, но там пусто.
PARKED = re.compile(
    r"domain (?:is )?(?:for sale|parking)|hugedomains|sedoparking|afternic|"
    r"buy this domain|godaddy\.com/domainsearch|namecheap parking|"
    r"this domain (?:is|may be) for sale|website coming soon|under construction",
    re.I,
)

TLDS = (".com", ".co.th", ".net", ".asia", ".club", ".th", ".org")


def words(name: str):
    return [w for w in re.split(r"[^a-z0-9]+", name.lower()) if w]


def core(name: str):
    """Опознавательные слова названия — без общих для всего острова."""
    ws = words(name)
    keep = [w for w in ws if w not in GENERIC and len(w) > 2]
    return keep or ws


def candidates(name: str, social: str):
    """Правдоподобные хосты. Порядок — от самого вероятного."""
    ws = words(name)
    ck = core(name)
    stems = []

    handle = ""
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", social or "")
    if m:
        handle = re.sub(r"[._]", "", m.group(1).lower())
        stems.append(handle)                       # ник в инстаграме часто = домен
        stems.append(handle.replace("phuket", ""))

    stems.append("".join(ws))                      # полное название слитно
    stems.append("".join(ws) + "phuket")
    stems.append("".join(ck))                      # только опознавательные слова
    stems.append("".join(ck) + "phuket")
    if len(ck) == 1:
        stems.append(ck[0] + "beachclub")
        stems.append(ck[0] + "phuket")

    # Гостиничные сети чаще всего живут на «первых словах» названия:
    # у «Pullman Phuket Arcadia Naithon Beach» это pullmanphuketarcadia,
    # у «Novotel Phuket Vintage Park Resort» — novotelphuketvintagepark.
    # Полное название слитно такие домены не ловит, поэтому пробуем
    # каждый префикс от двух до четырёх слов, с «phuket» и без.
    for k in (2, 3, 4):
        if len(ws) > k:
            pre = "".join(ws[:k])
            stems.append(pre)
            if "phuket" not in pre:
                stems.append(pre + "phuket")

    # Часть площадок пишет имя через дефис: twinpalms-phuket.com.
    for base in ("-".join(ws[:2]), "-".join(ck[:2])):
        if base.count("-") == 1 and len(base) > 6:
            stems.append(base)
            stems.append(base + "-phuket")

    clean, seen = [], set()
    for st in stems:
        st = re.sub(r"[^a-z0-9-]", "", st).strip("-")
        if len(st) < 4 or st in seen:
            continue
        seen.add(st)
        clean.append(st)

    # Порядок перебора — по зонам, а не по именам: .com у всех имён
    # вероятнее, чем .org у первого. При обратном порядке очередь
    # съедали семь зон одного-единственного имени, и до правильного
    # варианта с префиксом дело не доходило.
    return [st + tld for tld in TLDS for st in clean]


def get(url: str, timeout: int = 9):
    try:
        r = subprocess.run(
            ["curl", "-sL", "-m", str(timeout), "-A", UA, "--compressed",
             "--max-filesize", "800000", "-w", "\n%{http_code}", url],
            capture_output=True, timeout=timeout + 6,
        )
        body = r.stdout.decode("utf-8", "replace")
        code = body.rsplit("\n", 1)[-1].strip()
        return body[: body.rfind("\n")], code
    except Exception:
        return "", ""


def verify(html: str, code: str, name: str):
    """Страница действительно про эту площадку?

    Три условия, и все обязательны. Слово из названия — в заголовке
    страницы: в теле оно может встретиться случайно, в заголовке — нет.
    Слово «Пхукет» где-нибудь на странице: все наши площадки на острове,
    и это отсекает однофамильцев с другого конца света — по имени XANA
    первым отвечала аптека в Испании. И отсутствие заглушки регистратора.
    """
    if code != "200" or len(html) < 500:
        return 0
    if PARKED.search(html[:6000]):
        return 0
    low = html.lower()
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    title = (m.group(1) if m else "").lower()

    if "phuket" not in low[:60000]:
        return 0

    ck = core(name)
    hit_title = sum(1 for w in ck if w in title)
    if not hit_title:
        return 0
    hit_body = sum(1 for w in ck if w in low[:60000])
    # все опознавательные слова в заголовке — совпадение без сомнений
    return hit_title * 40 + hit_body * 15 + (30 if hit_title == len(ck) else 0)


def probe(job):
    vid, name, social = job
    if not [w for w in words(name) if w not in GENERIC and len(w) > 2]:
        # «The Beach Phuket» — все слова общие. Любой домен с этими
        # словами подойдёт формально и почти наверняка окажется чужим
        # заведением: так thebeachphuket.com оказался отелем в Кароне.
        return vid, name, None
    best = None
    for host in candidates(name, social)[:34]:
        url = "https://" + host
        html, code = get(url)
        s = verify(html, code, name)
        if s and (not best or s > best[0]):
            t = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
            best = (s, url, re.sub(r"\s+", " ", (t.group(1) if t else "")).strip()[:90])
        if best and best[0] >= 90:
            break  # заголовок совпал — дальше искать нечего
    return vid, name, best


def main():
    rows = json.load(open(VENUES, encoding="utf-8"))
    rows = rows if isinstance(rows, list) else rows.get("venues", rows)
    jobs = [
        (r["id"], r["name"], r.get("social") or "")
        for r in rows
        if not (r.get("website") or "").startswith("http")
    ]
    if len(sys.argv) > 1:
        jobs = jobs[: int(sys.argv[1])]

    found, miss = {}, []
    with ThreadPoolExecutor(max_workers=12) as ex:
        for vid, name, best in ex.map(probe, jobs):
            if best:
                found[vid] = {"name": name, "site": best[1], "score": best[0], "title": best[2]}
                print(f"✓ {vid} {name[:32]:34} {best[1]:38} {best[2][:44]}")
            else:
                miss.append({"id": vid, "name": name})
                print(f"· {vid} {name[:32]:34} —")

    json.dump({"found": found, "miss": miss}, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\nнашли сайт у {len(found)} из {len(jobs)} · не нашли {len(miss)}")


if __name__ == "__main__":
    main()
