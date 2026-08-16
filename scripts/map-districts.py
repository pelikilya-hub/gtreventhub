#!/usr/bin/env python3
"""Границы районов для карты — по нашим же площадкам.

Важная оговорка. Наши районы — Патонг, Банг Тао, Камала, Карон/Ката — это
не административные единицы Таиланда, а маркетинговые кластеры острова:
в официальном реестре их нет, и скачать «настоящий» контур неоткуда. Поэтому
граница строится честно и от данных: выпуклая оболочка вокруг точек
кластера, отодвинутая наружу на буфер и сглаженная по углам. Это не
кадастровая линия, а зона влияния района — ровно то, что нужно человеку,
который выбирает, где сегодня гулять.

Точки, оторванные от своего кластера дальше, чем на порог, в оболочку не
попадают: одна вилла на другом конце острова растягивала бы Банг Тао на
половину карты.
"""

import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUES = os.path.join(ROOT, "src", "gtr", "data", "venues.json")
GEO = os.path.join(ROOT, "src", "gtr", "data", "venue-geo.json")
OUT = os.path.join(ROOT, "src", "gtr", "data", "district-shapes.json")

# Буфер вокруг оболочки в километрах.
PAD_KM = 0.9
# Выброс отмеряем не фиксированным километражом, а от самого кластера:
# Патонг умещается в два километра, а «Юг и восток» растянут на полострова,
# и общий порог выбрасывал бы у него три четверти точек.
OUTLIER_MUL = 2.6
OUTLIER_MIN_KM = 4.0
# Сколько точек рисуем на каждом скруглённом угле.
ARC = 7

KM_LAT = 110.574  # километров в градусе широты


def km_lon(lat: float) -> float:
    return 111.320 * math.cos(math.radians(lat))


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

    Прямая оболочка по трём-четырём точкам выглядит осколком стекла.
    Буфер с дугами на углах даёт форму, которую глаз читает как область,
    а не как ошибку отрисовки.
    """
    if len(ring) < 3:
        # один-два адреса: рисуем круг вокруг центра
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
        # нормали к обоим рёбрам, направленные наружу
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


def main():
    rows = json.load(open(VENUES, encoding="utf-8"))
    rows = rows if isinstance(rows, list) else rows["venues"]
    geo = json.load(open(GEO, encoding="utf-8"))

    groups = {}
    for v in rows:
        g = geo.get(v["id"])
        cl = (v.get("cluster") or "").strip()
        if not g or not cl or cl == "Other":
            continue
        groups.setdefault(cl, []).append((g["lon"], g["lat"], v["id"]))

    out = {}
    for cl, pts in groups.items():
        lat0 = sum(p[1] for p in pts) / len(pts)
        lon0 = sum(p[0] for p in pts) / len(pts)
        dists = sorted(
            math.hypot((lon - lon0) * km_lon(lat0), (lat - lat0) * KM_LAT)
            for lon, lat, _ in pts
        )
        med = dists[len(dists) // 2] or 0.5
        limit = max(OUTLIER_MIN_KM, med * OUTLIER_MUL)
        keep, drop = [], []
        for lon, lat, vid in pts:
            d = math.hypot((lon - lon0) * km_lon(lat0), (lat - lat0) * KM_LAT)
            (keep if d <= limit else drop).append((lon, lat, vid))
        if len(keep) < 2:
            keep = pts
            drop = []
        ring = hull([(p[0], p[1]) for p in keep])
        out[cl] = {
            "name": cl,
            "center": [round(lat0, 5), round(lon0, 5)],
            "count": len(pts),
            "outliers": [p[2] for p in drop],
            "ring": [[round(a, 5), round(b, 5)] for a, b in inflate(ring, lat0)],
        }
        print(f"{cl:22} точек {len(pts):>3} · вершин {len(out[cl]['ring']):>3}"
              f"{' · выброшено ' + str(len(drop)) if drop else ''}")

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nрайонов: {len(out)} → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
