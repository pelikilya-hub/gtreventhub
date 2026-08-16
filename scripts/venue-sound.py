#!/usr/bin/env python3
"""Звуковой паспорт площадки: что, во сколько и для кого там играет.

До сих пор подбор артиста под площадку смотрел на одно поле music и
сравнивал строки. Так работать нельзя: у пляжного клуба в шесть вечера и
в час ночи это разные вечера с разной публикой, разным темпом и разными
жанрами, а у отельного бального зала и андеграундного клуба списки
запретов не пересекаются вовсе.

Здесь площадка получает то, чем на самом деле оперирует пиар-директор:

  формат   — что это за место по своей природе;
  слоты    — разбивка вечера по часам с ролью каждого отрезка
             (разогрев, прайм, пик, афтер);
  темп     — коридор BPM для каждого слота;
  энергия  — 1..5, насколько плотно бьёт танцпол;
  палитра  — жанры слота с весами: что просят в первую очередь;
  вето     — жанры, которых здесь быть не должно ни при каких условиях;
  публика  — кто стоит на танцполе, это диктует и музыку, и цену.

Формат выводится из типа площадки и её описания, дальше на формат
натягивается архетип. Архетипы — это и есть накопленное знание о том,
как устроен вечер; они короткие, их видно целиком и их легко спорить.

Вето — самая важная часть. Ошибка «поставили хард-техно на семейный
пляж» стоит площадке вечера, а нам — отношений с площадкой.
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUES = os.path.join(ROOT, "src", "gtr", "data", "venues.json")
GENRES = os.path.join(ROOT, "src", "gtr", "data", "genres.json")
NIGHT = os.path.join(ROOT, "src", "gtr", "data", "venue-night.json")
OUT = os.path.join(ROOT, "src", "gtr", "data", "venue-sound.json")

# Наборы жанров, которыми оперируют форматы. Веса — приоритет спроса:
# 1.0 просят в первую очередь, 0.5 берут охотно, 0.3 допустимо.
PAL = {
    "sunset": {"organic-house": 1.0, "melodic-house": 0.9, "afro-house": 0.8,
               "balearic-beat": 0.7, "downtempo": 0.6, "nu-disco": 0.5,
               "indie-dance": 0.5, "deep-house": 0.5},
    "beach_day": {"organic-house": 1.0, "downtempo": 0.8, "lounge": 0.7,
                  "balearic-beat": 0.7, "chillout": 0.6, "deep-house": 0.5,
                  "afro-house": 0.4},
    "beach_night": {"tech-house": 1.0, "afro-house": 0.9, "melodic-house": 0.8,
                    "melodic-techno": 0.7, "progressive-house": 0.6,
                    "deep-house": 0.6, "latin-house": 0.4},
    "club_warm": {"deep-house": 1.0, "tech-house": 0.9, "disco-house": 0.7,
                  "melodic-house": 0.7, "nu-disco": 0.5, "funky-house": 0.5},
    "club_prime": {"tech-house": 1.0, "bass-house": 0.8, "big-room-house": 0.7,
                   "edm-pop": 0.7, "future-house": 0.6, "melodic-techno": 0.6,
                   "dance-pop": 0.5, "slap-house": 0.5},
    "club_peak": {"melodic-techno": 1.0, "peak-time-techno": 0.9, "tech-house": 0.8,
                  "driving-techno": 0.7, "minimal-techno": 0.6, "hard-techno": 0.4},
    "lounge": {"lounge": 1.0, "downtempo": 0.9, "chillout": 0.8, "organic-house": 0.7,
               "deep-house": 0.6, "nu-jazz": 0.5, "trip-hop": 0.4},
    "rooftop": {"melodic-house": 1.0, "organic-house": 0.9, "deep-house": 0.8,
                "nu-disco": 0.6, "downtempo": 0.6, "indie-dance": 0.5},
    "pool": {"tech-house": 1.0, "latin-house": 0.8, "afro-house": 0.8,
             "brazilian-bass": 0.7, "moombahton": 0.6, "melodic-house": 0.6},
    "mice": {"dance-pop": 1.0, "disco-house": 0.8, "edm-pop": 0.7, "eurodance": 0.6,
             "nu-disco": 0.6, "deep-house": 0.5, "lounge": 0.5},
    "live": {"nu-jazz": 0.8, "electro-swing": 0.6, "lounge": 0.6, "downtempo": 0.5},
}

# Что здесь не играют никогда. Списки короткие намеренно: запрет должен
# быть железным, а не «нам это не очень нравится».
HARD = ["hard-techno", "industrial-techno", "schranz", "hardstyle", "rawstyle",
        "hardcore", "gabber", "frenchcore", "uptempo-hardcore", "speedcore",
        "terrorcore", "psycore", "dark-psy", "forest-psy", "hi-tech-psy",
        "brostep", "riddim", "tearout", "crossbreed", "digital-hardcore",
        "power-electronics", "rhythmic-noise", "drumfunk", "darkstep"]
UNDERGROUND = ["rominimal", "outsider-house", "lo-fi-house", "ghetto-house",
               "ghetto-tech", "deconstructed-club", "musique-concrete",
               "algorithmic-music", "microsound", "isolationism", "drone",
               "power-electronics", "rhythmic-noise", "witch-house"]

# Архетип: слоты вечера. Час указан по местному времени, роль задаёт
# ожидание от сета, а не жанр — жанр берётся из палитры.
ARCH = {
    "beach": {
        "label": "Пляжный клуб",
        "audience": "Туристы 25–45, смешанная европейско-российская публика, пары и компании",
        "slots": [
            {"from": 11, "to": 17, "role": "day", "bpm": [100, 118], "energy": 2, "pal": "beach_day"},
            {"from": 17, "to": 20, "role": "sunset", "bpm": [116, 122], "energy": 3, "pal": "sunset"},
            {"from": 20, "to": 24, "role": "night", "bpm": [120, 126], "energy": 4, "pal": "beach_night"},
        ],
        "veto": HARD + ["psytrance", "goa-trance", "jungle", "grime", "speedcore"],
        "note": "Закат — главный слот: по нему площадку и запоминают. "
                "Ставить на закат жёсткий сет — терять вечер.",
    },
    "nightclub": {
        "label": "Ночной клуб",
        "audience": "Туристы 21–35 и местная сцена, к ночи — плотный танцпол",
        "slots": [
            {"from": 21, "to": 23, "role": "warmup", "bpm": [118, 124], "energy": 3, "pal": "club_warm"},
            {"from": 23, "to": 2, "role": "prime", "bpm": [124, 128], "energy": 5, "pal": "club_prime"},
            {"from": 2, "to": 5, "role": "after", "bpm": [126, 138], "energy": 5, "pal": "club_peak"},
        ],
        "veto": ["hardcore", "gabber", "speedcore", "terrorcore", "uptempo-hardcore",
                 "psycore", "digital-hardcore", "power-electronics"],
        "note": "Разогрев не играет прайм: пик, поставленный в 21:30, "
                "сжигает вечер и оставляет хедлайнеру пустой зал.",
    },
    "rooftop": {
        "label": "Крыша / скай-бар",
        "audience": "Пары и компании 28–50, дороже средней публики, вечер до полуночи",
        "slots": [
            {"from": 17, "to": 20, "role": "sunset", "bpm": [110, 120], "energy": 2, "pal": "rooftop"},
            {"from": 20, "to": 24, "role": "night", "bpm": [118, 124], "energy": 3, "pal": "rooftop"},
        ],
        "veto": HARD + UNDERGROUND + ["psytrance", "jungle", "neurofunk"],
        "note": "Крыша живёт разговором: громкость и плотность ниже клубной, "
                "жёсткий бас гости считывают как агрессию.",
    },
    "lounge": {
        "label": "Лаунж / бар",
        "audience": "Смешанная публика на ужине, музыка — фон, а не событие",
        "slots": [
            {"from": 17, "to": 21, "role": "dinner", "bpm": [95, 115], "energy": 1, "pal": "lounge"},
            {"from": 21, "to": 24, "role": "night", "bpm": [112, 122], "energy": 2, "pal": "lounge"},
        ],
        "veto": HARD + UNDERGROUND + ["psytrance", "big-room-house", "hardwave"],
        "note": "Здесь выигрывает сет, который не мешает разговору. "
                "Танцпола нет — значит, нет и пика.",
    },
    "pool": {
        "label": "Бассейн / поол-пати",
        "audience": "Дневная компанейская публика 21–35, солнце и алкоголь",
        "slots": [
            {"from": 12, "to": 17, "role": "day", "bpm": [118, 124], "energy": 4, "pal": "pool"},
            {"from": 17, "to": 21, "role": "sunset", "bpm": [120, 126], "energy": 4, "pal": "sunset"},
        ],
        "veto": HARD + ["psytrance", "dark-ambient", "drone", "isolationism"],
        "note": "Днём у воды энергия выше, чем кажется: люди пришли танцевать "
                "при солнце, а не медитировать.",
    },
    "mice": {
        "label": "Отель / банкет / MICE",
        "audience": "Корпоративные и свадебные гости всех возрастов, включая семьи",
        "slots": [
            {"from": 18, "to": 22, "role": "reception", "bpm": [95, 118], "energy": 2, "pal": "mice"},
            {"from": 22, "to": 1, "role": "party", "bpm": [118, 126], "energy": 3, "pal": "mice"},
        ],
        "veto": HARD + UNDERGROUND + ["psytrance", "goa-trance", "jungle", "grime",
                                      "dark-ambient", "witch-house", "neurofunk"],
        "note": "Заказчик — отель, а не танцпол. Узнаваемость важнее новизны: "
                "гость должен подпевать, а не разгадывать трек.",
    },
    "live": {
        "label": "Живая музыка",
        "audience": "Публика пришла на сцену, а не на диджея",
        "slots": [
            {"from": 19, "to": 23, "role": "live", "bpm": [80, 120], "energy": 2, "pal": "live"},
        ],
        "veto": HARD + UNDERGROUND,
        "note": "Диджей здесь — оправа для группы: до, между и после, "
                "не перетягивая внимание.",
    },
    "show": {
        "label": "Шоу / парк",
        "audience": "Организованные группы и семьи, программа расписана по минутам",
        "slots": [
            {"from": 18, "to": 22, "role": "show", "bpm": [90, 120], "energy": 2, "pal": "mice"},
        ],
        "veto": HARD + UNDERGROUND + ["psytrance", "jungle", "grime", "phonk"],
        "note": "Музыка подчинена сценарию шоу: свободного сета здесь нет.",
    },
    "marina": {
        "label": "Марина / яхт-клуб",
        "audience": "Владельцы лодок и их гости, взрослая обеспеченная публика",
        "slots": [
            {"from": 16, "to": 20, "role": "sunset", "bpm": [105, 120], "energy": 2, "pal": "rooftop"},
            {"from": 20, "to": 23, "role": "night", "bpm": [115, 122], "energy": 3, "pal": "beach_night"},
        ],
        "veto": HARD + UNDERGROUND + ["psytrance", "jungle"],
        "note": "Причал слышно далеко: после одиннадцати громкость режут "
                "почти всегда, и сет должен это учитывать.",
    },
    "space": {
        "label": "Событийная площадка",
        "audience": "Зависит от арендатора: формат задаёт организатор события",
        "slots": [
            {"from": 18, "to": 23, "role": "event", "bpm": [100, 128], "energy": 3, "pal": "club_warm"},
        ],
        "veto": [],
        "note": "Пустая коробка: ограничения приносит арендатор, "
                "а не сама площадка.",
    },
}

# Метка площадки — управляемый словарь из одиннадцати значений, и он
# точнее любого разбора описания. Сначала спрашиваем её.
BY_TAG = {
    "Beach club": "beach",
    "Nightclub": "nightclub",
    "Rooftop": "rooftop",
    "Resort / MICE": "mice",
    "Marina / Yacht": "marina",
    "Show / Park": "show",
    "Event space": "space",
    "Live music": "live",
    "Villa": "space",
    "Bar / Lounge": "lounge",
}

# Тип уточняет метку там, где она широкая: «Bar / Lounge» бывает и
# джазовым погребом, и кабаре, и пляжным баром.
BY_TYPE = [
    (r"theme park|cabaret|theatre|theater|dinner show|arena", "show"),
    (r"beach club", "beach"),
    (r"night ?club", "nightclub"),
    (r"rooftop|sky ?bar", "rooftop"),
    (r"marina|yacht", "marina"),
    (r"live music|jazz", "live"),
    (r"pool", "pool"),
    (r"beach bar|beach / |beach restaurant|festival venue", "beach"),
    (r"coworking|studio|meeting|event space|event venue", "space"),
    (r"resort|hotel|ballroom", "mice"),
    (r"bar|lounge|restaurant|cafe|speakeasy", "lounge"),
]


def archetype(v: dict) -> str:
    """Архетип по метке, уточнённый типом.

    Свободное описание сюда не пускаем намеренно: слова «show» и «event
    venue» встречаются в тексте почти у каждой второй площадки, и по ним
    джазовый погреб уезжал в театральную программу, а пляж с фестивалем
    — в парк развлечений.
    """
    typ = str(v.get("type") or "").lower()
    tag = str(v.get("tag") or "").strip()

    # Тип сильнее метки, когда говорит о природе места однозначно.
    for pat, arch in BY_TYPE[:7]:
        if re.search(pat, typ):
            return arch
    if tag in BY_TAG:
        return BY_TAG[tag]
    for pat, arch in BY_TYPE:
        if re.search(pat, typ):
            return arch
    return "lounge"


def main():
    rows = json.load(open(VENUES, encoding="utf-8"))
    rows = rows if isinstance(rows, list) else rows["venues"]
    known = set(json.load(open(GENRES, encoding="utf-8"))["genres"])

    for name, pal in PAL.items():
        for gid in pal:
            assert gid in known, f"палитра {name}: нет жанра {gid}"
    for name, a in ARCH.items():
        for gid in a["veto"]:
            assert gid in known, f"вето {name}: нет жанра {gid}"

    out, stat = {}, {}
    for v in rows:
        arch = archetype(v)
        a = ARCH[arch]
        stat[arch] = stat.get(arch, 0) + 1
        out[v["id"]] = {
            "arch": arch,
            "label": a["label"],
            "audience": a["audience"],
            "note": a["note"],
            "veto": sorted(set(a["veto"])),
            "slots": [
                {
                    "from": s["from"],
                    "to": s["to"],
                    "role": s["role"],
                    "bpm": s["bpm"],
                    "energy": s["energy"],
                    "genres": PAL[s["pal"]],
                }
                for s in a["slots"]
            ],
        }

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"звуковых паспортов: {len(out)}")
    for k, n in sorted(stat.items(), key=lambda x: -x[1]):
        print(f"  {ARCH[k]['label']:26} {n}")


if __name__ == "__main__":
    main()
