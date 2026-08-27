#!/usr/bin/env python3
"""Контуры районов на карте — по всем регионам GTR, а не только по Пхукету.

До этого нарезан был один Пхукет: там OpenStreetMap знает все шестнадцать
тамбонов, и район собирался объединением тех, в которых реально стоят наши
площадки. В остальных провинциях карта просто улетала к центру региона.

Разведка по зеркалу Overpass 27.08.2026 показала, почему так и осталось:
административная сетка Таиланда в OSM нарезана неровно.

    Бангкок    173 кхвэнга уровня 8 в центральной рамке — полная сетка
    Пхукет      16 тамбонов — полная сетка (кэш scripts/osm-tambons.json)
    Паттайя      2 тамбона из шести — Банг Ламунг и На Клыа
    Самуи        0 — есть только ампхе целиком, уровень 6
    Панган       2 тамбона
    Пханг-Нга    0 (в рамку попадают только тамбоны соседнего Пхукета)

Поэтому контур строится двумя способами, и способ записан в данных.

    src="osm"      объединение административных границ: линия идёт по
                   дороге, хребту или берегу, потому что так её нарезали
                   на местности;
    src="venues"   оболочка вокруг наших же точек с буфером и скруглением.
                   Это не кадастровая линия, а зона района — там, где
                   настоящей границы взять негде, честнее показать зону и
                   сказать об этом, чем нарисовать чужой контур.

Карта эти два вида рисует по-разному: административный — сплошной линией,
зону — пунктиром.
"""

import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "gtr", "data")
GEO = os.path.join(DATA, "venue-geo.json")
OUT = os.path.join(DATA, "district-shapes.json")

# Зеркало Overpass: основное и большинство прочих из песочницы недоступны,
# это отвечает — но под нагрузкой отдаёт 504, поэтому запрос повторяется.
OVERPASS = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
TRIES = 4

# Рамка для запроса границ и файл кэша. Регион без рамки за границами не
# ходит вовсе — там их нет, и лишний запрос только ждёт таймаут.
REGIONS = {
    "phuket": {"box": "7.65,98.20,8.30,98.50", "cache": "osm-tambons.json"},
    "bkk": {"box": "13.60,100.44,13.82,100.70", "cache": "osm-bkk.json"},
    "pty": {"box": "12.80,100.83,13.00,101.02", "cache": "osm-pty.json"},
    "pgn": {"box": "9.66,99.94,9.85,100.14", "cache": "osm-pgn.json"},
    "smu": {},
    "pna": {},
}

# Упрощение контура: точка выбрасывается, если отклоняется от прямой меньше
# чем на этот допуск в градусах (~25 метров).
TOLERANCE = 0.00022
# Кольца короче этого в километрах — острова и осколки, их не рисуем.
MIN_RING_KM = 1.2

# Оболочка вокруг точек: буфер в километрах и точек на скруглённом угле.
PAD_KM = 0.9
ARC = 7
# Выброс отмеряем от размаха самого кластера, а не общим километражом:
# Уокинг-стрит умещается в квартал, а «Восточная Паттайя» растянута на
# десяток километров, и общий порог выбросил бы у неё половину точек.
OUTLIER_MUL = 2.6
OUTLIER_MIN_KM = 4.0

KM_LAT = 110.574


def km_lon(lat):
    return 111.320 * math.cos(math.radians(lat))


# ── границы из OSM ────────────────────────────────────────────────────────


def fetch(box, cache_name):
    path = os.path.join(ROOT, "scripts", cache_name)
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    query = (
        "[out:json][timeout:220];"
        f'rel["boundary"="administrative"]["admin_level"="8"]({box});'
        "out geom;"
    )
    for attempt in range(TRIES):
        r = subprocess.run(
            ["curl", "-s", "-m", "230", "-X", "POST", OVERPASS, "--data-urlencode", "data=" + query],
            capture_output=True,
            timeout=250,
        )
        try:
            data = json.loads(r.stdout.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            print(f"    зеркало не ответило (попытка {attempt + 1}/{TRIES})")
            continue
        json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False)
        return data
    return {"elements": []}


def rings_of(rel):
    """Сшить внешние пути релейшена в замкнутые кольца.

    Overpass отдаёт границу набором путей в произвольном порядке и
    направлении: кольцо замыкается только после того, как каждый отрезок
    нашёл соседа по общему концу.
    """
    segs = [
        [(p["lon"], p["lat"]) for p in m["geometry"]]
        for m in rel.get("members", [])
        if m.get("role") in ("outer", "") and m.get("geometry")
    ]
    rings, pool = [], [s for s in segs if len(s) > 1]
    while pool:
        cur = pool.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(pool):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += list(reversed(s))[1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = list(reversed(s))[:-1] + cur
                else:
                    continue
                pool.pop(i)
                changed = True
                break
        if len(cur) > 3:
            rings.append(cur)
    return rings


def simplify(pts, tol):
    """Дуглас — Пекер: убрать точки, которые не меняют форму."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = math.hypot(dx, dy) or 1e-12
    worst, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / den
        if d > worst:
            worst, idx = d, i
    if worst <= tol:
        return [a, b]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def simplify_ring(ring, tol):
    """Упрощение замкнутого кольца.

    У кольца первая и последняя точки совпадают, базовая линия Дугласа —
    Пекера вырождается в ноль, и алгоритм честно отвечает «здесь всё
    лишнее». Поэтому кольцо режется в самой удалённой от начала точке на
    две незамкнутые цепи, и каждая упрощается отдельно.
    """
    if len(ring) < 5:
        return ring
    open_ring = ring[:-1] if ring[0] == ring[-1] else ring[:]
    a = open_ring[0]
    far = max(
        range(len(open_ring)),
        key=lambda i: (open_ring[i][0] - a[0]) ** 2 + (open_ring[i][1] - a[1]) ** 2,
    )
    return simplify(open_ring[: far + 1], tol)[:-1] + simplify(open_ring[far:] + [a], tol)


def ring_km(ring):
    per = 0.0
    for i in range(len(ring) - 1):
        per += math.hypot(
            (ring[i + 1][0] - ring[i][0]) * 110.3, (ring[i + 1][1] - ring[i][1]) * 110.6
        )
    return per


def inside(pt, ring):
    """Луч вправо: чётное число пересечений — точка снаружи."""
    x, y = pt
    hit = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            hit = not hit
    return hit


def boundaries(box, cache_name):
    """Административные контуры рамки: имя → кольца."""
    out = {}
    for rel in fetch(box, cache_name).get("elements", []):
        tags = rel.get("tags", {})
        name = tags.get("name:en") or tags.get("name") or str(rel["id"])
        rings = []
        for r in rings_of(rel):
            if ring_km(r) < MIN_RING_KM:
                continue
            s = simplify_ring(r, TOLERANCE)
            if len(s) > 3:
                rings.append(s)
        if rings:
            out[name] = rings
    return out


# ── оболочка вокруг точек ─────────────────────────────────────────────────


# Зона строится не оболочкой вокруг точек, а разбиением по близости.
#
# Оболочки налезали друг на друга: в Паттайе Уокинг-стрит, центр и Наклыа
# стояли одной кучей, и три полигона перекрывались так, что нажать можно
# было только на верхний. Разбиение отдаёт каждой клетке сетки тот район,
# чья площадка к ней ближе, — районы получаются соседями с общей границей,
# как на настоящей карте, и ни одна точка карты не принадлежит двоим.
GRID = 260
# Дальше этого от ближайшей площадки — уже не район, а поле и море.
# Два километра дробили район на россыпь пятен вокруг каждого адреса:
# Кхао Лак читался цепочкой точек, а не областью. Три — склеивают соседние
# адреса в одну область и всё ещё не выпускают зону в море.
REACH_KM = 3.0
# Зону упрощаем грубее административной границы: у неё нет рубежа, который
# надо повторить с точностью до метра, зато есть вес в браузерном бандле.
ZONE_TOLERANCE = 0.00055
# Осколок меньше этого периметра выбрасываем, если у района есть кусок
# крупнее: одинокая точка на отшибе не должна мигать пятном на карте.
ZONE_MIN_RING_KM = 3.0


def nearest_regions(by_cluster):
    """Клетки сетки → район, чья площадка ближе всех."""
    pts = [(p, cl) for cl, ps in by_cluster.items() for p in ps]
    lons = [p[0][0] for p in pts]
    lats = [p[0][1] for p in pts]
    lat0 = sum(lats) / len(lats)
    mx = REACH_KM * 1.15
    pad_lon, pad_lat = mx / km_lon(lat0), mx / KM_LAT
    x0, x1 = min(lons) - pad_lon, max(lons) + pad_lon
    y0, y1 = min(lats) - pad_lat, max(lats) + pad_lat
    nx = GRID
    ny = max(8, int(GRID * ((y1 - y0) * KM_LAT) / max((x1 - x0) * km_lon(lat0), 1e-9)))
    ny = min(ny, GRID * 3)
    owner = [[None] * nx for _ in range(ny)]
    for i in range(ny):
        cy = y0 + (i + 0.5) * (y1 - y0) / ny
        for j in range(nx):
            cx = x0 + (j + 0.5) * (x1 - x0) / nx
            best = None
            for (px, py), cl in pts:
                d = math.hypot((px - cx) * km_lon(cy), (py - cy) * KM_LAT)
                if best is None or d < best[0]:
                    best = (d, cl)
            if best[0] <= REACH_KM:
                owner[i][j] = best[1]
    return owner, (x0, x1, y0, y1, nx, ny)


def mask_rings(owner, box, cluster):
    """Контур области клеток одного района.

    Границу собираем из рёбер между «своей» клеткой и чужой или пустой, а
    потом сшиваем в кольца по общим концам — узлы сетки целочисленные,
    поэтому концы совпадают точно и кольцо всегда замыкается.
    """
    x0, x1, y0, y1, nx, ny = box
    edges = []
    for i in range(ny):
        for j in range(nx):
            if owner[i][j] != cluster:
                continue
            # обход против часовой в координатах сетки
            if i == 0 or owner[i - 1][j] != cluster:
                edges.append(((j, i), (j + 1, i)))
            if j == nx - 1 or owner[i][j + 1] != cluster:
                edges.append(((j + 1, i), (j + 1, i + 1)))
            if i == ny - 1 or owner[i + 1][j] != cluster:
                edges.append(((j + 1, i + 1), (j, i + 1)))
            if j == 0 or owner[i][j - 1] != cluster:
                edges.append(((j, i + 1), (j, i)))
    nxt = {}
    for a, b in edges:
        nxt.setdefault(a, []).append(b)
    rings = []
    while nxt:
        start = next(iter(nxt))
        ring, cur = [start], start
        while True:
            outs = nxt.get(cur)
            if not outs:
                break
            nb = outs.pop()
            if not outs:
                nxt.pop(cur, None)
            if nb == start:
                break
            ring.append(nb)
            cur = nb
        if len(ring) > 3:
            rings.append(ring)
    out = []
    for ring in rings:
        pts = [
            (x0 + gx * (x1 - x0) / nx, y0 + gy * (y1 - y0) / ny) for gx, gy in ring
        ]
        # Ступеньки сетки сглаживаем Чайкиным: без него зона выглядит
        # пиксельной лесенкой, а не областью на карте.
        for _ in range(2):
            pts = chaikin(pts)
        s = simplify_ring(pts, ZONE_TOLERANCE)
        if len(s) > 3 and ring_km(s) >= MIN_RING_KM:
            out.append(s)
    out.sort(key=ring_km, reverse=True)
    return [r for i, r in enumerate(out) if i == 0 or ring_km(r) >= ZONE_MIN_RING_KM]


def chaikin(ring):
    out = []
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        out.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
        out.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
    return out


def hull(points):
    """Выпуклая оболочка, обход Эндрю. Точек мало, скорость не важна."""
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def inflate(ring, lat0):
    """Отодвинуть контур наружу и скруглить углы.

    Прямая оболочка по трём-четырём точкам выглядит осколком стекла. Буфер
    с дугами на углах даёт форму, которую глаз читает как область.
    """
    if len(ring) < 3:
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        r = PAD_KM * 1.4
        return [
            [cy + (r / KM_LAT) * math.sin(a), cx + (r / km_lon(lat0)) * math.cos(a)]
            for a in [i * 2 * math.pi / 36 for i in range(36)]
        ]
    out = []
    n = len(ring)
    for i in range(n):
        prev, cur, nxt = ring[i - 1], ring[i], ring[(i + 1) % n]
        angs = []
        for a, b in ((prev, cur), (cur, nxt)):
            dx = (b[0] - a[0]) * km_lon(lat0)
            dy = (b[1] - a[1]) * KM_LAT
            L = math.hypot(dx, dy) or 1e-9
            angs.append(math.atan2(-dx / L, dy / L))
        a0, a1 = angs
        while a1 - a0 > math.pi:
            a1 -= 2 * math.pi
        while a0 - a1 > math.pi:
            a1 += 2 * math.pi
        for k in range(ARC):
            a = a0 + (a1 - a0) * k / (ARC - 1)
            out.append(
                [
                    cur[1] + (PAD_KM / KM_LAT) * math.sin(a),
                    cur[0] + (PAD_KM / km_lon(lat0)) * math.cos(a),
                ]
            )
    return out


def drop_outliers(pts):
    """Точки, оторванные от своего кластера, в оболочку не берём: одна
    вилла на отшибе растягивала бы район на половину карты."""
    if len(pts) < 4:
        return pts
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    d = [
        math.hypot((p[0] - cx) * km_lon(cy), (p[1] - cy) * KM_LAT) for p in pts
    ]
    med = sorted(d)[len(d) // 2]
    lim = max(med * OUTLIER_MUL, OUTLIER_MIN_KM)
    keep = [p for p, dd in zip(pts, d) if dd <= lim]
    return keep if len(keep) >= 3 else pts


# ── сборка ────────────────────────────────────────────────────────────────


def span_km(pts):
    """Диагональ рамки, охватывающей точки."""
    if len(pts) < 2:
        return 0.0
    lat0 = sum(p[1] for p in pts) / len(pts)
    dx = (max(p[0] for p in pts) - min(p[0] for p in pts)) * km_lon(lat0)
    dy = (max(p[1] for p in pts) - min(p[1] for p in pts)) * KM_LAT
    return math.hypot(dx, dy)


# Во сколько раз контур может быть шире самого кластера. На Пангане оба
# наших южных района попадали в тамбон, который занимает весь остров:
# формально точки внутри, а на карте вместо района подсвечивался Панган
# целиком. Такой контур не объясняет район, а прячет его.
FIT_MUL = 3.5
FIT_MIN_KM = 4.0


def fits(keep, tambons, pts):
    """Не шире ли граница самого кластера настолько, что перестаёт быть
    его границей."""
    ring_pts = [p for n in keep for r in tambons[n] for p in r]
    return span_km(ring_pts) <= max(span_km(pts) * FIT_MUL, FIT_MIN_KM)


def venues_of(code):
    """Площадки региона с их кластером. Пхукет живёт в исторической базе."""
    path = os.path.join(DATA, "venues.json") if code == "phuket" else os.path.join(DATA, "regions", f"{code}.json")
    raw = json.load(open(path, encoding="utf-8"))
    rows = raw if isinstance(raw, list) else raw["venues"]
    return [v for v in rows if (v.get("cluster") or "").strip() not in ("", "Other")]


def shape(name, rings, count, parts, src):
    pts = [p for r in rings for p in r]
    return {
        "name": name,
        "center": [
            round(sum(p[1] for p in pts) / len(pts), 5),
            round(sum(p[0] for p in pts) / len(pts), 5),
        ],
        "count": count,
        "tambons": sorted(parts),
        "src": src,
        # Leaflet ждёт [широта, долгота]; несколько колец — несколько
        # контуров одного района, полигон это умеет.
        "rings": [[[round(p[1], 5), round(p[0], 5)] for p in r] for r in rings],
    }


def build(code, geo):
    cfg = REGIONS[code]
    tambons = {}
    if cfg.get("box"):
        tambons = boundaries(cfg["box"], cfg["cache"])
        print(f"  административных контуров в рамке: {len(tambons)}")

    # Точки кластеров и то, в какой контур каждая попала.
    by_cluster, direct = {}, {}
    for v in venues_of(code):
        g = geo.get(v["id"])
        if not g:
            continue
        cl = v["cluster"].strip()
        pt = (g["lon"], g["lat"])
        by_cluster.setdefault(cl, []).append(pt)
        if not tambons:
            continue
        found = next((n for n, rs in tambons.items() if any(inside(pt, r) for r in rs)), None)
        if found:
            direct.setdefault(cl, {}).setdefault(found, 0)
            direct[cl][found] += 1

    total_pts = sum(len(p) for p in by_cluster.values())
    inside_pts = sum(sum(t.values()) for t in direct.values())
    used = {n for t in direct.values() for n in t}
    # Годится ли сетка, чтобы по ней раскладывать. Двух условий мало по
    # отдельности, нужны оба.
    #
    # Покрытие: у Пхукета и Бангкока границы нарезаны целиком, и редкую
    # точку, снятую по центру района и упавшую в воду, можно отдать
    # ближайшему контуру. У Паттайи зеркало знает два тамбона из шести —
    # там «ближайший» отправил бы Уокинг-стрит, Джомтьен и восток в На Клыа
    # разом.
    #
    # Дробность: контуров, в которые реально попали наши точки, должно быть
    # не меньше, чем самих районов. На Пангане два тамбона на пять районов
    # покрывают почти все точки — но различить районы не могут: Чалоклум на
    # северном берегу оказывался в южном Бан Тай, а Шритану и Тонг Сала
    # делили тамбон размером с остров.
    enough = bool(tambons) and total_pts and inside_pts / total_pts >= 0.6 and len(used) >= len(by_cluster)
    if tambons:
        print(
            f"  внутри контуров: {inside_pts} из {total_pts} точек в {len(used)} границах"
            f" на {len(by_cluster)} районов — {'раскладываем по границам' if enough else 'сетка не различает районы, рисуем зоны'}"
        )
    hits = {}
    if enough:
        for cl, pts in by_cluster.items():
            for pt in pts:
                found = next(
                    (n for n, rs in tambons.items() if any(inside(pt, r) for r in rs)), None
                ) or min(
                    tambons,
                    key=lambda n: min(
                        math.hypot((p[0] - pt[0]) * 110.3, (p[1] - pt[1]) * 110.6)
                        for r in tambons[n]
                        for p in r
                    ),
                )
                hits.setdefault(cl, {}).setdefault(found, 0)
                hits[cl][found] += 1

    # Разбиение по близости считаем один раз на регион: районы делят сетку
    # между собой, поэтому знать надо сразу все точки.
    zone_pts = {cl: drop_outliers(p) for cl, p in by_cluster.items()}
    owner, box = nearest_regions(zone_pts)

    out = {}
    for cl, pts in sorted(by_cluster.items()):
        tam = hits.get(cl, {})
        total = len(pts)
        # Контур берём, только если он объясняет большинство точек кластера:
        # два адреса из пятнадцати внутри тамбона — это не район, а совпадение.
        keep = [n for n, k in tam.items() if k >= 2 or k / total >= 0.2]
        covered = sum(tam[n] for n in keep)
        if keep and covered / total >= 0.6 and fits(keep, tambons, pts):
            rings = [r for n in keep for r in tambons[n]]
            out[cl] = shape(cl, rings, total, keep, "osm")
            print(f"  {cl:34} {total:>3} точек · граница: {', '.join(sorted(keep))}")
        else:
            rings = mask_rings(owner, box, cl)
            if not rings:
                # Один адрес на весь район: сетке нечего делить, рисуем
                # круг вокруг точки — иначе района на карте не будет вовсе.
                lat0 = sum(p[1] for p in pts) / len(pts)
                rings = [[(p[1], p[0]) for p in inflate(hull(pts), lat0)]]
            out[cl] = shape(cl, rings, total, [], "venues")
            print(f"  {cl:34} {total:>3} точек · зона по площадкам")
    return out


def main():
    sys.setrecursionlimit(20000)
    geo = json.load(open(GEO, encoding="utf-8"))
    out = {}
    for code in REGIONS:
        print(f"\n== {code}")
        out[code] = build(code, geo)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(len(v) for v in out.values())
    osm = sum(1 for v in out.values() for s in v.values() if s["src"] == "osm")
    size = os.path.getsize(OUT) / 1024
    print(
        f"\nрайонов: {total} в {len(out)} регионах · по границам {osm}, "
        f"зон {total - osm} · {size:.0f} КБ → {os.path.relpath(OUT, ROOT)}"
    )


if __name__ == "__main__":
    main()
