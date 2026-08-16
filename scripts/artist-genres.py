#!/usr/bin/env python3
"""Разметка артистов по дереву жанров.

В базе у артистов лежат живые русские подписи: «хаус», «клубная
электроника», «бич-клаб-хаус». Часть из них ложится на дерево прямо,
часть — только через таблицу соответствий ниже, а часть жанром не
является вовсе: «открытый формат», «свадебный сет», «эстрада» — это
формат выступления или неэлектронная сцена.

Скрипт дописывает каждому артисту поле styleIds — список жанров дерева.
Исходное поле styles не трогаем: подпись, которую видит менеджер,
остаётся его подписью, а машина работает с идентификаторами.
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTISTS = os.path.join(ROOT, "src", "gtr", "data", "artists.json")
GENRES = os.path.join(ROOT, "src", "gtr", "data", "genres.json")
REPORT = os.path.join(ROOT, "scripts", "artist-genres-report.json")

# Живые подписи из базы → жанры дерева. Одна подпись может раскрываться
# в несколько жанров: «клубная электроника» — это не отдельный жанр, а
# указание на танцпольную середину, поэтому разворачиваем её в тройку
# тек-хаус / хаус / техно, которая эту середину и описывает.
MAP = {
    "хаус": ["deep-house"],
    "дип-хаус": ["deep-house"],
    "тек-хаус": ["tech-house"],
    "мелодик-хаус": ["melodic-house"],
    "органик-хаус": ["organic-house"],
    "прогрессив-хаус": ["progressive-house"],
    "афро-хаус": ["afro-house"],
    "латин-хаус": ["latin-house"],
    "вокал-хаус": ["vocal-house"],
    "бич-клаб-хаус": ["organic-house", "melodic-house"],
    "биг-рум": ["big-room-house"],
    "техно": ["melodic-techno"],
    "мелодик-техно": ["melodic-techno"],
    "минимал": ["minimal-techno"],
    "транс": ["progressive-trance"],
    "прогрессив": ["progressive-house"],
    "драм-н-бейс": ["liquid-dnb"],
    "дабстеп": ["dubstep"],
    "бас": ["bass-house"],
    "бразилиан-бас": ["brazilian-bass"],
    "фьючер-бас": ["future-bass"],
    "трэп": ["edm-trap"],
    "инди-дэнс": ["indie-dance"],
    "диско": ["nu-disco"],
    "рейв": ["oldschool-rave"],
    "даунтемпо": ["downtempo"],
    "лаунж / чилаут": ["lounge", "chillout"],
    "электро-поп": ["electropop"],
    "синти-поп": ["synthpop"],
    "танцевальный поп": ["dance-pop"],
    "edm": ["edm-pop", "big-room-house"],
    "электроника": ["electronica"],
    "лайв-электроника": ["live-electronic"],
    # Три обобщающие подписи, за которыми в базе стоит именно танцпол.
    # Разворачиваем каждую в свою тройку, иначе половина каталога
    # остаётся без единого жанра и в подборе не участвует.
    "клубная электроника": ["tech-house", "deep-house", "melodic-techno"],
    "андеграунд-электроника": ["deep-tech", "minimal-techno", "dub-techno"],
    "фанк": ["funky-house"],
    "соул": ["soulful-house"],
    "джаз": ["nu-jazz"],
}

# Подписи, которые описывают формат вечера или неэлектронную сцену.
# Они остаются в styles как есть и в дерево не идут — врать про них
# «это хаус» было бы хуже, чем честно оставить их вне подбора.
SKIP = {
    "поп", "тайский инди", "рэп", "рок", "поп-рок", "эстрада", "хип-хоп", "r&b",
    "тайский поп", "тайский рок", "инди-поп", "инди-рок", "альт-рок", "фолк-рок",
    "фолк", "ска", "ска-панк", "панк", "болливуд / панджаби", "кавер-программа",
    "открытый формат", "свадебный сет", "радио-сет", "винил-сет", "live-программа",
    "live-вокал", "стендап / комедия", "инструментал",
}


def main():
    data = json.load(open(GENRES, encoding="utf-8"))
    known = set(data["genres"])
    alias = {}
    for gid, g in data["genres"].items():
        for a in g["alias"]:
            alias.setdefault(a, gid)

    for v in MAP.values():
        for gid in v:
            assert gid in known, f"нет такого жанра в дереве: {gid}"

    rows = json.load(open(ARTISTS, encoding="utf-8"))
    lst = rows if isinstance(rows, list) else rows["artists"]

    unmapped, stats = {}, {"с жанрами": 0, "без жанров": 0, "жанров всего": 0}
    for a in lst:
        raw = a.get("styles") or []
        if isinstance(raw, str):
            raw = [raw]
        ids = []
        for s in raw:
            key = str(s).strip().lower()
            if key in SKIP:
                continue
            got = MAP.get(key)
            if got is None:
                # прямое попадание в дерево (напр. «psytrance» латиницей)
                flat = re.sub(r"[^a-zа-я0-9]+", "", key)
                hit = alias.get(key) or alias.get(flat)
                got = [hit] if hit else None
            if got is None:
                unmapped[key] = unmapped.get(key, 0) + 1
                continue
            for gid in got:
                if gid not in ids:
                    ids.append(gid)
        if ids:
            a["styleIds"] = ids
            stats["с жанрами"] += 1
            stats["жанров всего"] += len(ids)
        else:
            a.pop("styleIds", None)
            stats["без жанров"] += 1

    json.dump(rows, open(ARTISTS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(
        {"stats": stats, "unmapped": dict(sorted(unmapped.items(), key=lambda x: -x[1]))},
        open(REPORT, "w", encoding="utf-8"),
        ensure_ascii=False,
        indent=1,
    )
    print(f"артистов: {len(lst)}")
    for k, v in stats.items():
        print(f"  {k:14} {v}")
    if unmapped:
        print("\nне легло в дерево (осталось подписью):")
        for k, v in sorted(unmapped.items(), key=lambda x: -x[1])[:20]:
            print(f"  {v:>3}  {k}")


if __name__ == "__main__":
    main()
