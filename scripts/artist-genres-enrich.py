#!/usr/bin/env python3
"""Стили артистов с профессиональных площадок: Discogs и MusicBrainz.

Собственная разметка в базе была ручной и грубой: «клубная электроника»,
«хаус». Настоящий стиль артиста лежит там, где его релизы каталогизируют
профессионально. Из открытых источников без ключей работают два:

  Discogs — поле style у релизов. Это ровно тот словарь, что нужен:
    Deep House, Tech House, Minimal, Progressive Trance. Один запрос
    поиска релизов с фильтром по имени артиста даёт до полусотни
    релизов, и распределение стилей по ним — это и есть портрет.

  Mixcloud — теги сетов. Для клубного диджея это главный источник:
    релизов у резидента может не быть вовсе, а сеты выкладывают все, и
    теги на них ставит сам артист.

  MusicBrainz — теги артиста. Грубее (electronic, techno, dance), но
    независимый источник: совпадение источников поднимает доверие.

Beatport, Last.fm, SoundCloud и Resident Advisor требуют ключей или
закрыты для анонима — отвечают 401/403. Проверено, не выдумано.

Стиль берётся, только если он повторяется: единичное упоминание в
каталоге из полусотни релизов — это гость на чужом сборнике, а не
собственный стиль артиста.
"""

import json
import os
import re
import subprocess
import sys
import time
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTISTS = os.path.join(ROOT, "src", "gtr", "data", "artists.json")
GENRES = os.path.join(ROOT, "src", "gtr", "data", "genres.json")
OUT = os.path.join(ROOT, "src", "gtr", "data", "artist-genres.json")

UA = "GTR-Event/1.0 (+https://gtr-event-hub.gtr-event.workers.dev; pelikilya@gmail.com)"

# Discogs просит не частить: без токена лимит 25 запросов в минуту.
# MusicBrainz — не больше одного в секунду. Обоих уважаем.
DISCOGS_GAP = 2.6
MB_GAP = 1.1
MIX_GAP = 0.4

# Доля релизов, ниже которой стиль считается случайным.
MIN_SHARE = 0.12
MIN_HITS = 2


def get(url: str, timeout: int = 20):
    try:
        r = subprocess.run(
            ["curl", "-s", "-m", str(timeout), "-A", UA, "--compressed", url],
            capture_output=True, timeout=timeout + 6,
        )
        return json.loads(r.stdout.decode("utf-8", "replace"))
    except Exception:
        return None


def load_alias():
    data = json.load(open(GENRES, encoding="utf-8"))
    alias = {}
    for gid, g in data["genres"].items():
        for a in g["alias"]:
            alias.setdefault(a, gid)
    return data["genres"], alias


def norm(s: str) -> str:
    return re.sub(r"[^a-zа-я0-9]+", " ", s.lower().replace("ё", "е")).strip()


def resolve(raw: str, alias: dict) -> str | None:
    n = norm(raw)
    return alias.get(n) or alias.get(n.replace(" ", "")) or alias.get(n.replace(" ", "-"))


def mixcloud_styles(name: str, alias: dict):
    """Теги сетов артиста на Mixcloud.

    Имя сверяем строго: поиск возвращает похожих, и «Alex» легко
    приводит к чужому профилю с другой музыкой.
    """
    d = get(f"https://api.mixcloud.com/search/?q={quote(name)}&type=user")
    if not d or not d.get("data"):
        return {}, 0
    user = None
    for u in d["data"][:5]:
        if norm(u.get("name", "")) == norm(name) or norm(u.get("username", "")) == norm(name):
            user = u
            break
    if not user:
        return {}, 0
    time.sleep(MIX_GAP)
    cc = get(f"https://api.mixcloud.com{user['key']}cloudcasts/?limit=40")
    if not cc or not cc.get("data"):
        return {}, 0
    hits, total = {}, 0
    for item in cc["data"]:
        tags = item.get("tags") or []
        if not tags:
            continue
        total += 1
        for t in tags:
            hits[t["name"]] = hits.get(t["name"], 0) + 1
    out = {}
    for t, n in hits.items():
        if n < MIN_HITS or n / max(1, total) < MIN_SHARE:
            continue
        gid = resolve(t, alias)
        if gid:
            out[gid] = max(out.get(gid, 0), n / max(1, total))
    return out, total


def discogs_styles(name: str, alias: dict):
    """Распределение стилей по релизам артиста."""
    q = quote(name)
    d = get(f"https://api.discogs.com/database/search?artist={q}&type=release&per_page=50")
    if not d or not d.get("results"):
        return {}, 0
    hits, total = {}, 0
    want = norm(name)
    for r in d["results"]:
        # Заголовок релиза на Discogs — «Артист - Название». Фильтр по
        # артисту в поиске мягкий, поэтому имя сверяем сами: иначе
        # «DJ Meet» приводил хард-транс от однофамильца.
        title = norm(r.get("title", ""))
        if want not in title:
            continue
        styles = r.get("style") or []
        if not styles:
            continue
        total += 1
        for s in styles:
            hits[s] = hits.get(s, 0) + 1
    out = {}
    for s, n in hits.items():
        if n < MIN_HITS or n / max(1, total) < MIN_SHARE:
            continue
        gid = resolve(s, alias)
        if gid:
            out[gid] = max(out.get(gid, 0), n / max(1, total))
    return out, total


def mb_tags(name: str, alias: dict):
    q = quote(f'artist:"{name}"')
    d = get(f"https://musicbrainz.org/ws/2/artist/?query={q}&fmt=json&limit=1")
    if not d or not d.get("artists"):
        return {}
    a = d["artists"][0]
    # Имя должно совпасть: поиск возвращает ближайшее, а не точное.
    if norm(a.get("name", "")) != norm(name):
        return {}
    out = {}
    for t in a.get("tags") or []:
        gid = resolve(t["name"], alias)
        if gid:
            out[gid] = max(out.get(gid, 0), min(1.0, 0.4 + 0.1 * int(t.get("count") or 1)))
    return out


def main():
    genres, alias = load_alias()
    rows = json.load(open(ARTISTS, encoding="utf-8"))
    lst = rows if isinstance(rows, list) else rows["artists"]

    # Люди и заведения, а не музыкальные акты, в каталоге тоже есть.
    acts = [a for a in lst if a.get("kind") != "venue" and a.get("name")]
    if len(sys.argv) > 1:
        acts = acts[: int(sys.argv[1])]

    book = {}
    if os.path.exists(OUT):
        book = json.load(open(OUT, encoding="utf-8"))

    done = 0
    for a in acts:
        aid, name = a["id"], a["name"]
        if aid in book:
            continue
        mix, mixn = mixcloud_styles(name, alias)
        time.sleep(MIX_GAP)
        dis, total = discogs_styles(name, alias)
        time.sleep(DISCOGS_GAP)
        mb = mb_tags(name, alias)
        time.sleep(MB_GAP)

        merged = dict(dis)
        for gid, w in mix.items():
            merged[gid] = min(1.0, merged.get(gid, 0) + w)
        for gid, w in mb.items():
            # Совпадение двух источников — сильный сигнал, поэтому не
            # заменяем, а складываем с ограничением сверху.
            merged[gid] = min(1.0, merged.get(gid, 0) + w * 0.5)
        if merged:
            book[aid] = {
                "name": name,
                "ids": sorted(merged, key=lambda g: -merged[g]),
                "weights": {g: round(w, 3) for g, w in merged.items()},
                "src": {
                    "mixcloud": sorted(mix),
                    "discogs": sorted(dis),
                    "musicbrainz": sorted(mb),
                    "releases": total,
                    "sets": mixn,
                },
            }
            print(f"✓ {aid} {name[:28]:30} {', '.join(genres[g]['en'] for g in book[aid]['ids'][:5])}")
        else:
            book[aid] = {"name": name, "ids": [], "weights": {}, "src": {"releases": total, "sets": mixn}}
            print(f"· {aid} {name[:28]:30} —")
        done += 1
        if done % 10 == 0:
            json.dump(book, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    json.dump(book, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    got = sum(1 for v in book.values() if v["ids"])
    print(f"\nпрофилей: {len(book)} · со стилями: {got}")


if __name__ == "__main__":
    main()
