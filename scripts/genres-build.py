#!/usr/bin/env python3
"""Сборка справочника жанров электронной музыки.

Раньше стиль артиста был просто строкой: «хаус», «клубная электроника»,
«андеграунд-электроника». Сравнивать такие строки можно было только на
точное совпадение, поэтому дип-хаус и соулфул-хаус для подбора были
такими же чужими друг другу, как дип-хаус и хардкор. Здесь жанры
получают дерево: направление → группа → жанр. По дереву считается
родство, и подбор перестаёт быть игрой в угадай-слово.

Русские названия собираются из словаря корней, а не пишутся вручную для
каждого из четырёх сотен жанров: «deep» всегда «дип», «house» всегда
«хаус». Там, где корневой перевод даёт неловкость, работает таблица
исключений — она короткая и её видно целиком.

Псевдонимы нужны, чтобы к жанру приводились живые написания: latin
house, latin-house, латин хаус, латин-хаус — это одно и то же.
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "gtr", "data", "genres.json")

# ---------------------------------------------------------------- дерево
# Направление → группа → жанры. Порядок сохраняется: он же порядок
# показа в интерфейсе, от самого частого к редкому.
TREE: list[tuple[str, list[tuple[str, list[str]]]]] = [
    ("House", [
        ("House", ["Chicago House", "Deep House", "Soulful House", "Funky House",
                   "Disco House", "French House", "Filter House", "Jackin House",
                   "Garage House", "Acid House", "Piano House", "Vocal House"]),
        ("Современный House", ["Tech House", "Minimal House", "Microhouse", "Organic House",
                               "Afro House", "Tribal House", "Latin House", "Melodic House",
                               "Progressive House", "Electro House", "Future House",
                               "Bass House", "Big Room House"]),
        ("Андеграундный House", ["Deep Tech", "Minimal Deep Tech", "Rominimal", "Lo-Fi House",
                                 "Outsider House", "Ghetto House", "Ghetto Tech"]),
    ]),
    ("Techno", [
        ("Techno", ["Detroit Techno", "Minimal Techno", "Dub Techno", "Acid Techno",
                    "Industrial Techno", "Hypnotic Techno", "Raw Techno", "Hard Techno",
                    "Peak Time Techno", "Driving Techno"]),
        ("Современный Techno", ["Melodic Techno", "Organic Techno", "Afro Techno",
                                "Tribal Techno", "Psytechno", "Schranz", "Neo-Rave",
                                "Techno Trance"]),
    ]),
    ("Trance", [
        ("Trance", ["Classic Trance", "Progressive Trance", "Uplifting Trance",
                    "Vocal Trance", "Tech Trance", "Acid Trance", "Hard Trance",
                    "Dream Trance", "Balearic Trance"]),
        ("Psychedelic Trance", ["Psytrance", "Progressive Psytrance", "Full-On", "Goa Trance",
                                "Dark Psy", "Forest Psy", "Hi-Tech Psy", "Twilight Psy",
                                "Psycore", "Suomisaundi"]),
    ]),
    ("Breakbeat", [
        ("Breakbeat", ["Breakbeat", "Big Beat", "Progressive Breaks", "Acid Breaks",
                       "Funky Breaks", "Nu Skool Breaks", "Electro Breaks", "Florida Breaks"]),
        ("UK Breaks", ["UK Garage", "2-Step Garage", "Speed Garage", "Bassline",
                       "Breakstep", "Future Garage", "UK Funky"]),
    ]),
    ("Drum & Bass", [
        ("Drum & Bass", ["Liquid DnB", "Atmospheric DnB", "Jungle", "Jump Up", "Neurofunk",
                         "Techstep", "Darkstep", "Dancefloor DnB", "Drumfunk", "Crossbreed"]),
    ]),
    ("Bass Music", [
        ("Dubstep", ["Dubstep", "Deep Dubstep", "UK Dubstep", "Brostep", "Riddim", "Tearout",
                     "Melodic Dubstep", "Future Bass", "Wave", "Hardwave", "Colour Bass"]),
        ("Grime и UK Bass", ["Grime", "UK Bass", "Wonky", "Purple Sound", "Dubstep Grime",
                             "Drill Electronic", "Deconstructed Club"]),
    ]),
    ("Electro", [
        ("Electro", ["Electro", "Electro-Funk", "Detroit Electro", "Electroclash",
                     "Electro Techno", "Miami Bass", "Freestyle"]),
    ]),
    ("Hard Dance", [
        ("Hard Dance", ["Hardstyle", "Rawstyle", "Euphoric Hardstyle", "Hardcore", "Gabber",
                        "Frenchcore", "Uptempo Hardcore", "Happy Hardcore", "UK Hardcore",
                        "Speedcore", "Terrorcore"]),
        ("Rave", ["Oldschool Rave", "Breakbeat Hardcore", "Belgian Rave", "Acid Rave",
                  "Piano Rave", "Nu-Rave"]),
    ]),
    ("Disco", [
        ("Disco", ["Italo Disco", "Euro Disco", "Space Disco", "Nu-Disco", "Indie Dance",
                   "Dark Disco", "Cosmic Disco", "Hi-NRG"]),
    ]),
    ("Synth", [
        ("Synth", ["Synthpop", "Electropop", "Synthwave", "Retrowave", "Outrun", "Darksynth",
                   "Dreamwave", "Chillwave", "Vaporwave"]),
        ("Ретроэлектроника", ["Chiptune", "8-Bit", "Bitpop", "Spacesynth", "Future Funk"]),
    ]),
    ("Industrial", [
        ("Industrial и Dark Electronic", ["Industrial", "EBM", "Dark Electro", "Aggrotech",
                                          "Futurepop", "Power Electronics", "Rhythmic Noise",
                                          "Witch House", "Darkwave", "Coldwave"]),
    ]),
    ("Ambient", [
        ("Ambient", ["Ambient", "Dark Ambient", "Drone", "Space Ambient", "Organic Ambient",
                     "Tribal Ambient", "Isolationism", "Ambient Dub", "Ambient Techno"]),
    ]),
    ("Downtempo", [
        ("Downtempo", ["Downtempo", "Chillout", "Trip-Hop", "Lounge", "Balearic Beat",
                       "Psybient", "Psychill", "Psydub", "Ethnic Electronica",
                       "Organic Downtempo"]),
        ("Lo-Fi и Beat Music", ["Lo-Fi Beats", "Chillhop", "Instrumental Hip-Hop",
                                "Boom Bap Electronic", "Wonky Beats", "Abstract Hip-Hop"]),
    ]),
    ("IDM", [
        ("IDM и эксперимент", ["IDM", "Glitch", "Glitchcore", "Clicks & Cuts", "Braindance",
                               "Drill'n'Bass", "Microsound", "Musique Concrete",
                               "Electroacoustic", "Algorithmic Music"]),
    ]),
    ("Trap", [
        ("Trap и электронный Hip-Hop", ["EDM Trap", "Festival Trap", "Hybrid Trap",
                                        "Future Trap", "Phonk", "Drift Phonk",
                                        "Memphis Phonk", "Wave Trap"]),
    ]),
    ("Pop", [
        ("Pop и коммерческая электроника", ["Dance Pop", "Eurodance", "Europop", "EDM Pop",
                                            "Tropical House", "Slap House", "Future Pop",
                                            "Hyperpop"]),
    ]),
    ("Global Club", [
        ("Global Club Music", ["Baile Funk", "Brazilian Bass", "Amapiano", "Gqom", "Kuduro",
                               "Afro Electronic", "Tribal Guaracha", "Moombahton",
                               "Moombahcore", "Dancehall Electronic"]),
        ("Latin Electronic", ["Guaracha", "Reggaeton Electronic", "Cumbia Digital"]),
        ("Caribbean и African", ["Afro Tech", "Afrobeat Electronic", "Kwaito"]),
        ("Footwork и клубные ритмы", ["Chicago Footwork", "Juke", "Jersey Club",
                                      "Baltimore Club", "Philly Club", "Ballroom"]),
        ("Японская электроника", ["J-Core", "Kawaii Future Bass", "Denpa",
                                  "Japanese Footwork"]),
    ]),
    ("Dub", [
        ("Dub", ["Dub", "Digital Dub", "Steppers"]),
    ]),
    ("Live", [
        ("Live и органическая электроника", ["Electronica", "Folktronica",
                                             "Organic Electronica", "Ethnotronica",
                                             "Tribal Electronica", "Live Electronic",
                                             "Electro-Acoustic"]),
        ("Концептуальные гибриды", ["Jazztronica", "Nu Jazz", "Electro Swing",
                                    "Classical Crossover Electronic", "Rocktronica",
                                    "Digital Hardcore", "Post-Industrial"]),
    ]),
]

# ------------------------------------------------------- русские названия
# Корни, из которых собирается название. Регистр не важен, порядок —
# важен: сначала длинные сочетания, потом отдельные слова.
ROOTS = [
    ("soulful", "соулфул"), ("skool", "скул"), ("jump", "джамп"), ("up", "ап"),
    ("clicks", "кликс"), ("cuts", "катс"), ("musique", "мюзик"), ("concrete", "конкрет"),
    ("colour", "колор"), ("time", "тайм"), ("peak", "пик"), ("room", "рум"),
    ("big", "биг"), ("piano", "пиано"), ("garage", "гэридж"), ("step", "степ"),
    ("bap", "бэп"), ("boom", "бум"), ("club", "клаб"), ("sound", "саунд"),
    ("hall", "холл"), ("electronic", "электроник"), ("elektro", "электро"),
    ("drum & bass", "драм-н-бейс"), ("drum and bass", "драм-н-бейс"),
    ("clicks & cuts", "кликс-энд-катс"), ("drill'n'bass", "дрилл-н-бейс"),
    ("musique concrete", "конкретная музыка"), ("hi-nrg", "хай-энерджи"),
    ("hi-tech", "хай-тек"), ("nu skool", "ню-скул"), ("peak time", "пик-тайм"),
    ("full-on", "фулл-он"), ("2-step", "ту-степ"), ("8-bit", "8-бит"),
    ("boom bap", "бум-бэп"), ("big room", "биг-рум"), ("big beat", "биг-бит"),
    ("uk", "UK"), ("edm", "EDM"), ("idm", "IDM"), ("ebm", "EBM"), ("dnb", "драм-н-бейс"),
    ("house", "хаус"), ("techno", "техно"), ("trance", "транс"), ("garage", "гэридж"),
    ("breaks", "брейкс"), ("breakbeat", "брейкбит"), ("breakstep", "брейкстеп"),
    ("dubstep", "дабстеп"), ("dub", "даб"), ("bass", "бас"), ("beat", "бит"),
    ("beats", "битс"), ("disco", "диско"), ("funk", "фанк"), ("soul", "соул"),
    ("jazz", "джаз"), ("pop", "поп"), ("rave", "рейв"), ("core", "кор"),
    ("hardcore", "хардкор"), ("hardstyle", "хардстайл"), ("gabber", "габбер"),
    ("ambient", "эмбиент"), ("drone", "дрон"), ("glitch", "глитч"),
    ("downtempo", "даунтемпо"), ("chillout", "чилаут"), ("chill", "чил"),
    ("lounge", "лаунж"), ("trip-hop", "трип-хоп"), ("hip-hop", "хип-хоп"),
    ("trap", "трэп"), ("phonk", "фонк"), ("wave", "вейв"), ("synth", "синт"),
    ("electro", "электро"), ("electronica", "электроника"), ("electronic", "электронный"),
    ("industrial", "индастриал"), ("minimal", "минимал"), ("micro", "микро"),
    ("deep", "дип"), ("tech", "тек"), ("acid", "эйсид"), ("dark", "дарк"),
    ("melodic", "мелодик"), ("organic", "органик"), ("tribal", "трайбал"),
    ("afro", "афро"), ("latin", "латин"), ("progressive", "прогрессив"),
    ("future", "фьючер"), ("liquid", "ликвид"), ("jungle", "джангл"),
    ("jump up", "джамп-ап"), ("neurofunk", "нейрофанк"), ("techstep", "текстеп"),
    ("darkstep", "даркстеп"), ("drumfunk", "драмфанк"), ("crossbreed", "кроссбрид"),
    ("grime", "грайм"), ("wonky", "вонки"), ("riddim", "риддим"), ("brostep", "бростеп"),
    ("tearout", "тиэраут"), ("colour", "колор"), ("psy", "пси"), ("goa", "гоа"),
    ("forest", "форест"), ("twilight", "твайлайт"), ("suomisaundi", "суомисаунди"),
    ("italo", "итало"), ("euro", "евро"), ("space", "спейс"), ("cosmic", "космик"),
    ("indie", "инди"), ("dance", "дэнс"), ("nu", "ню"), ("lo-fi", "лоу-фай"),
    ("vapor", "вейпор"), ("retro", "ретро"), ("outrun", "аутран"), ("dream", "дрим"),
    ("chiptune", "чиптюн"), ("bitpop", "битпоп"), ("witch", "витч"),
    ("coldwave", "колдвейв"), ("darkwave", "даркуэйв"), ("noise", "нойз"),
    ("power", "пауэр"), ("aggrotech", "агротек"), ("balearic", "балеарик"),
    ("ethnic", "этник"), ("ethno", "этно"), ("folk", "фолк"), ("live", "лайв"),
    ("swing", "свинг"), ("classical", "классик"), ("crossover", "кроссовер"),
    ("rock", "рок"), ("post", "пост"), ("digital", "диджитал"), ("steppers", "степперс"),
    ("baile", "байле"), ("brazilian", "бразилиан"), ("amapiano", "амапиано"),
    ("gqom", "гком"), ("kuduro", "кудуро"), ("kwaito", "квайто"),
    ("guaracha", "гуарача"), ("moombahton", "мумбатон"), ("moombahcore", "мумбакор"),
    ("dancehall", "дэнсхолл"), ("reggaeton", "реггетон"), ("cumbia", "кумбия"),
    ("footwork", "футворк"), ("juke", "джук"), ("jersey", "джерси"),
    ("baltimore", "балтимор"), ("philly", "филли"), ("ballroom", "боллрум"),
    ("chicago", "чикаго"), ("detroit", "детройт"), ("french", "френч"),
    ("filter", "фильтр"), ("jackin", "джекин"), ("piano", "пиано"), ("vocal", "вокал"),
    ("ghetto", "гетто"), ("outsider", "аутсайдер"), ("rominimal", "роминимал"),
    ("hypnotic", "гипнотик"), ("raw", "роу"), ("hard", "хард"), ("driving", "драйвинг"),
    ("schranz", "шранц"), ("neo", "нео"), ("classic", "классик"),
    ("uplifting", "аплифтинг"), ("dancefloor", "дэнсфлор"), ("atmospheric", "атмосферик"),
    ("instrumental", "инструментал"), ("abstract", "абстракт"), ("chillhop", "чилхоп"),
    ("braindance", "брейндэнс"), ("microsound", "микросаунд"),
    ("algorithmic", "алгоритмическая"), ("music", "музыка"), ("festival", "фестивальный"),
    ("hybrid", "гибридный"), ("memphis", "мемфис"), ("drift", "дрифт"),
    ("eurodance", "евродэнс"), ("europop", "европоп"), ("tropical", "тропикал"),
    ("slap", "слэп"), ("hyperpop", "гиперпоп"), ("speed", "спид"),
    ("bassline", "басслайн"), ("florida", "флорида"), ("belgian", "бельгийский"),
    ("oldschool", "олдскул"), ("euphoric", "эйфорик"), ("frenchcore", "френчкор"),
    ("uptempo", "аптемпо"), ("happy", "хэппи"), ("terrorcore", "терроркор"),
    ("speedcore", "спидкор"), ("rawstyle", "роустайл"), ("deconstructed", "деконструкт"),
    ("club", "клаб"), ("drill", "дрилл"), ("purple", "пёрпл"), ("sound", "саунд"),
    ("kawaii", "каваи"), ("denpa", "денпа"), ("japanese", "японский"), ("j-core", "джей-кор"),
    ("isolationism", "изоляционизм"), ("psybient", "псайбиент"), ("psychill", "псайчил"),
    ("psydub", "псайдаб"), ("psycore", "псайкор"), ("psytrance", "психотранс"),
    ("psytechno", "психотехно"), ("electroclash", "электроклэш"), ("miami", "майами"),
    ("freestyle", "фристайл"), ("spacesynth", "спейссинт"), ("futurepop", "фьючерпоп"),
    ("rhythmic", "ритмический"), ("hardwave", "хардвейв"), ("folktronica", "фолктроника"),
    ("jazztronica", "джазтроника"), ("rocktronica", "роктроника"),
    ("ethnotronica", "этнотроника"), ("acoustic", "акустик"),
]
ROOTS.sort(key=lambda p: -len(p[0]))

# Там, где сборка по корням даёт неловкость, пишем название целиком.
RU_FIX = {
    "Deep Tech": "дип-тек",
    "Minimal Deep Tech": "минимал-дип-тек",
    "Big Room House": "биг-рум-хаус",
    "Hi-NRG": "хай-энерджи",
    "Nu-Disco": "ню-диско",
    "Nu Jazz": "ню-джаз",
    "Nu-Rave": "ню-рейв",
    "UK Funky": "UK-фанки",
    "Funky House": "фанки-хаус",
    "Funky Breaks": "фанки-брейкс",
    "Wave": "вейв",
    "Dub": "даб",
    "Electro": "электро",
    "Industrial": "индастриал",
    "Ambient": "эмбиент",
    "Downtempo": "даунтемпо",
    "Dubstep": "дабстеп",
    "Breakbeat": "брейкбит",
    "Electronica": "электроника",
    "IDM": "IDM",
    "EBM": "EBM",
    "Grime": "грайм",
    "Jungle": "джангл",
    "Phonk": "фонк",
    "Glitch": "глитч",
    "Drone": "дрон",
    "Clicks & Cuts": "кликс-энд-катс",
    "Musique Concrete": "конкретная музыка",
    "Jump Up": "джамп-ап",
    "Nu Skool Breaks": "ню-скул-брейкс",
    "Soulful House": "соулфул-хаус",
    "Drill'n'Bass": "дрилл-н-бейс",
    "Hi-Tech Psy": "хай-тек-психоделик",
    "8-Bit": "8-бит",
    "J-Core": "джей-кор",
    "2-Step Garage": "ту-степ-гэридж",
}


def ru_name(en: str) -> str:
    """Русское название по корням, но пословно.

    Подстановкой «в лоб» soulful превращался в «соул-ful»: корень soul
    находился внутри целого слова и рвал его пополам. Поэтому сначала
    пробуем перевести слово целиком и только потом, если такого слова в
    словаре нет, разбираем его на корни.
    """
    if en in RU_FIX:
        return RU_FIX[en]
    exact = dict(ROOTS)
    out = []
    for word in re.split(r"[ /]+", en.lower()):
        w = word.strip()
        if not w:
            continue
        if w in exact:
            out.append(exact[w])
            continue
        s = w
        for a, b in ROOTS:
            if a in s and len(a) >= 3:
                s = s.replace(a, " " + b + " ")
        parts = [p for p in re.split(r"[ ]+", s) if p.strip(" -&")]
        out.append("-".join(p.strip(" -&") for p in parts) if parts else w)
    res = "-".join(x for x in out if x)
    return re.sub(r"-+", "-", res).strip("-") or en.lower()


def slug(en: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", en.lower())).strip("-")


# Короткие подписи, которыми жанры называют в нашей базе и в живой речи
# на острове. Без них «биг-рум» или «минимал» не находят своего жанра, и
# сравнение снова падает на грубые семейства.
LOCAL = {
    "big-room-house": ["биг-рум", "big room", "биг рум"],
    "minimal-techno": ["минимал", "minimal"],
    "progressive-trance": ["транс", "trance"],
    "deep-house": ["хаус", "house", "дип хаус"],
    "tech-house": ["тек-хаус", "тек хаус"],
    "melodic-techno": ["техно", "techno", "мелодик техно"],
    "liquid-dnb": ["драм-н-бейс", "днб", "dnb"],
    "nu-disco": ["диско", "disco", "нью-диско"],
    "edm-pop": ["edm"],
    "electronica": ["электроника"],
    "live-electronic": ["лайв-электроника"],
    "downtempo": ["даунтемпо"],
    "chillout": ["чилаут", "чил-аут"],
    "lounge": ["лаунж"],
    "organic-house": ["органик-хаус", "органик хаус"],
    "melodic-house": ["мелодик-хаус", "мелодик хаус"],
    "afro-house": ["афро-хаус", "афро хаус"],
    "latin-house": ["латин-хаус", "латин хаус"],
    "vocal-house": ["вокал-хаус", "вокал хаус"],
    "progressive-house": ["прогрессив-хаус", "прогрессив"],
    "soulful-house": ["соулфул-хаус", "соулфул хаус", "соул-хаус"],
    "funky-house": ["фанки-хаус", "фанк-хаус"],
    "indie-dance": ["инди-дэнс", "инди дэнс"],
    "future-bass": ["фьючер-бас", "фьючер бас"],
    "brazilian-bass": ["бразилиан-бас", "бразилиан бас"],
    "bass-house": ["бас-хаус"],
    "edm-trap": ["трэп", "trap"],
    "dubstep": ["дабстеп"],
    "oldschool-rave": ["рейв", "rave"],
    "psytrance": ["психоделик-транс", "психоделик транс", "пситранс"],
    "synthpop": ["синти-поп", "синтипоп"],
    "electropop": ["электро-поп", "электропоп"],
    "dance-pop": ["танцевальный поп"],
}


def aliases(en: str, ru: str) -> list[str]:
    """Живые написания, по которым жанр должен узнаваться."""
    out = set()
    for base in (en, ru):
        low = base.lower().strip()
        out.add(low)
        out.add(low.replace("-", " "))
        out.add(low.replace(" ", "-"))
        out.add(low.replace("-", ""))
        out.add(low.replace("&", "and"))
        out.add(low.replace(" & ", " "))
        out.add(re.sub(r"[^a-zа-яё0-9]+", "", low))
    return sorted(x for x in out if len(x) > 1)


def main():
    genres, order = {}, []
    for direction, groups in TREE:
        for group, items in groups:
            for en in items:
                gid = slug(en)
                if gid in genres:
                    # один и тот же жанр числится в двух группах — оставляем
                    # первую, но помним обе: по дереву он родня и там, и там
                    genres[gid]["also"].append(group)
                    continue
                ru = ru_name(en)
                genres[gid] = {
                    "id": gid,
                    "en": en,
                    "ru": ru,
                    "dir": direction,
                    "group": group,
                    "also": [],
                    "alias": sorted(set(aliases(en, ru)) | set(LOCAL.get(gid, []))),
                }
                order.append(gid)

    json.dump(
        {"order": order, "genres": genres},
        open(OUT, "w", encoding="utf-8"),
        ensure_ascii=False,
        indent=1,
    )
    dirs = {}
    for g in genres.values():
        dirs.setdefault(g["dir"], 0)
        dirs[g["dir"]] += 1
    print(f"жанров: {len(genres)} · направлений: {len(dirs)}")
    for d, n in dirs.items():
        print(f"  {d:16} {n}")
    print("\nпримеры русских названий:")
    for gid in ("deep-house", "minimal-deep-tech", "liquid-dnb", "psytrance",
                "melodic-techno", "future-bass", "nu-disco", "amapiano", "idm"):
        if gid in genres:
            print(f"  {genres[gid]['en']:24} → {genres[gid]['ru']}")


if __name__ == "__main__":
    main()
