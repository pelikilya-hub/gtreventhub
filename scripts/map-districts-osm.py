#!/usr/bin/env python3
"""Границы районов по настоящим рубежам: дороги, хребты, береговая линия.

Прошлая версия рисовала оболочку вокруг наших точек — честно, но грубо:
многоугольник не знал ни о дорогах, ни о том, где кончается пляж и
начинается гора. Здесь берём административные границы тамбонов Пхукета из
OpenStreetMap. Они не выдуманы: тамбон отделяется от соседа ровно по
дороге, хребту или берегу, потому что так его и нарезали на местности.

Тамбонов шестнадцать, наших кластеров девять. Соответствие не один к
одному: «Юг и восток» — это Раваи, Чалонг, Вичит и Па Клок вместе, а
«Старый город» и «Пхукет-таун» делят Талат Нуеа. Поэтому кластер
собирается как объединение тамбонов, в которых реально стоят наши
площадки: не по справочнику, а по факту.

Кольца сшиваются из отрезков вручную. Overpass отдаёт границу набором
путей в произвольном порядке и направлении — у Патонга их тринадцать, и
первый из них длиной в три точки. Собранное кольцо замыкается только
после того, как каждый отрезок нашёл соседа по общему концу.
"""

import json
import math
import os
import subprocess
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUES = os.path.join(ROOT, "src", "gtr", "data", "venues.json")
GEO = os.path.join(ROOT, "src", "gtr", "data", "venue-geo.json")
OUT = os.path.join(ROOT, "src", "gtr", "data", "district-shapes.json")
CACHE = os.path.join(ROOT, "scripts", "osm-tambons.json")

# Зеркало Overpass: основное и большинство прочих из песочницы
# недоступны, это отвечает.
OVERPASS = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
QUERY = (
    "[out:json][timeout:170];"
    'rel["boundary"="administrative"]["admin_level"="8"](7.65,98.20,8.30,98.50);'
    "out geom;"
)

# Упрощение: точка выбрасывается, если отклоняется от прямой меньше чем
# на этот допуск в градусах (~25 метров). Граница тамбона приходит с
# точностью до метра — на карте острова это лишние сотни килобайт.
TOLERANCE = 0.00022
# Кольца короче этого в километрах — острова и осколки, их не рисуем.
MIN_RING_KM = 1.2


def fetch():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding="utf-8"))
    r = subprocess.run(
        ["curl", "-s", "-m", "200", "-X", "POST", OVERPASS, "--data-urlencode", "data=" + QUERY],
        capture_output=True,
        timeout=220,
    )
    data = json.loads(r.stdout.decode("utf-8", "replace"))
    json.dump(data, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return data


def rings_of(rel):
    """Сшить внешние пути релейшена в замкнутые кольца."""
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

    Дуглас — Пекер строит отрезок от первой точки к последней, а у кольца
    это одна и та же точка: базовая линия вырождается в ноль, расстояние
    от неё до всех остальных выходит нулевым, и алгоритм честно отвечает
    «здесь всё лишнее» — от контура Патонга оставалось две точки. Поэтому
    кольцо сначала разрезаем в самой удалённой от начала точке на две
    незамкнутые цепи и упрощаем каждую отдельно.
    """
    if len(ring) < 5:
        return ring
    open_ring = ring[:-1] if ring[0] == ring[-1] else ring[:]
    a = open_ring[0]
    far = max(range(len(open_ring)), key=lambda i: (open_ring[i][0] - a[0]) ** 2 + (open_ring[i][1] - a[1]) ** 2)
    first = simplify(open_ring[: far + 1], tol)
    second = simplify(open_ring[far:] + [a], tol)
    out = first[:-1] + second
    return out


def ring_km(ring):
    per = 0.0
    for i in range(len(ring) - 1):
        dx = (ring[i + 1][0] - ring[i][0]) * 110.3
        dy = (ring[i + 1][1] - ring[i][1]) * 110.6
        per += math.hypot(dx, dy)
    return per


def inside(pt, ring):
    """Луч вправо: чётное число пересечений — точка снаружи."""
    x, y = pt
    hit = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            hit = not hit
    return hit


def main():
    # Дуглас — Пекер рекурсивен, а в кольце тамбона тысячи точек.
    sys.setrecursionlimit(20000)

    data = fetch()
    tambons = {}
    for rel in data["elements"]:
        name = rel["tags"].get("name:en") or rel["tags"].get("name") or str(rel["id"])
        rings = []
        for r in rings_of(rel):
            if ring_km(r) < MIN_RING_KM:
                continue
            s = simplify_ring(r, TOLERANCE)
            if len(s) > 3:
                rings.append(s)
        if rings:
            tambons[name] = rings
    print(f"тамбонов с контуром: {len(tambons)}")

    rows = json.load(open(VENUES, encoding="utf-8"))
    rows = rows if isinstance(rows, list) else rows["venues"]
    geo = json.load(open(GEO, encoding="utf-8"))

    # Кластер → тамбоны, в которых стоят его площадки.
    hits, stray = {}, 0
    for v in rows:
        g = geo.get(v["id"])
        cl = (v.get("cluster") or "").strip()
        if not g or not cl or cl == "Other":
            continue
        pt = (g["lon"], g["lat"])
        found = None
        for name, rings in tambons.items():
            if any(inside(pt, r) for r in rings):
                found = name
                break
        if not found:
            # Точка не попала ни в один контур: у острова есть тамбон,
            # который зеркало не отдало, а координата бывает снята по
            # центру района и падает в воду. Отдаём ближайшему — иначе
            # площадка молча исчезает из своего же района.
            stray += 1
            best = None
            for name, rings in tambons.items():
                d = min(
                    math.hypot((p[0] - pt[0]) * 110.3, (p[1] - pt[1]) * 110.6)
                    for r in rings
                    for p in r
                )
                if not best or d < best[0]:
                    best = (d, name)
            found = best[1]
        hits.setdefault(cl, {}).setdefault(found, 0)
        hits[cl][found] += 1
    if stray:
        print(f"вне контуров: {stray} площадок отданы ближайшему тамбону")

    out = {}
    for cl, tam in hits.items():
        total = sum(tam.values())
        # Тамбон с одной случайной точкой из двадцати кластер не
        # представляет: одна вилла на отшибе не должна тащить в район
        # половину острова.
        keep = [n for n, k in tam.items() if k >= 2 or k / total >= 0.2]
        if not keep:
            keep = [max(tam, key=tam.get)]
        rings = [r for n in keep for r in tambons[n]]
        pts = [p for r in rings for p in r]
        out[cl] = {
            "name": cl,
            "center": [
                round(sum(p[1] for p in pts) / len(pts), 5),
                round(sum(p[0] for p in pts) / len(pts), 5),
            ],
            "count": total,
            "tambons": sorted(keep),
            # Leaflet ждёт [широта, долгота]; несколько колец — несколько
            # контуров одного района, полигон это умеет.
            "rings": [[[round(p[1], 5), round(p[0], 5)] for p in r] for r in rings],
        }
        print(f"{cl:22} точек {total:>3} · тамбоны: {', '.join(sorted(keep))}"
              f" · вершин {sum(len(r) for r in rings)}")

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    size = os.path.getsize(OUT) / 1024
    print(f"\nрайонов: {len(out)} · {size:.0f} КБ → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
