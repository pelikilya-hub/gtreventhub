#!/usr/bin/env python3
"""Паспорт каждого собранного знака: где взят, на чём лежит, куда годится.

Логотип нельзя просто положить на тёмный фон продукта: половина знаков
нарисована светлым по тёмной подложке, половина — тёмным по светлой, и
если это не знать, часть из них станет невидимой. Поэтому для каждого
файла считаем:

  plate  — цвет сплошной подложки, если она есть (по рамке в 3 пикселя);
  ink    — средняя светлота самого знака поверх подложки;
  tone   — «light» (светлый знак, просится на тёмное) или «dark»;
  onDark — можно ли класть прямо на тёмный фон продукта без плашки.

Этими четырьмя полями пользуются и карточки площадок, и генератор афиш:
там знак ставится на постер, и подложку надо либо сохранить, либо
подобрать под неё контрастный прямоугольник.
"""

import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "public", "venues", "logos")
VENUES = os.path.join(ROOT, "src", "gtr", "data", "venues.json")
REPORT = os.path.join(ROOT, "scripts", "venue-logos-report.json")
OUT = os.path.join(ROOT, "src", "gtr", "data", "venue-logos.json")

# Знаки, которые принадлежат сети-владельцу, а не самой площадке.
# Ставить их можно, но подписывать «логотип площадки» — нельзя.
CHAIN = {"VEN-0069"}


def lum(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def describe(path: str):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()

    # рамка: если она однотонная и непрозрачная — это подложка
    edge = []
    for x in range(w):
        for y in (0, 1, 2, h - 3, h - 2, h - 1):
            edge.append(px[x, y])
    for y in range(h):
        for x in (0, 1, 2, w - 3, w - 2, w - 1):
            edge.append(px[x, y])

    opaque = [p for p in edge if p[3] > 200]
    plate = None
    if len(opaque) > len(edge) * 0.9:
        r = sum(p[0] for p in opaque) // len(opaque)
        g = sum(p[1] for p in opaque) // len(opaque)
        b = sum(p[2] for p in opaque) // len(opaque)
        spread = max(abs(p[0] - r) + abs(p[1] - g) + abs(p[2] - b) for p in opaque)
        if spread < 90:
            plate = "#%02x%02x%02x" % (r, g, b)

    # чернила: пиксели, заметно отличающиеся от подложки (или все непрозрачные)
    body = []
    small = im.resize((min(w, 200), min(h, 200)))
    for p in small.convert("RGBA").getdata():
        if p[3] < 40:
            continue
        if plate:
            pr, pg, pb = (int(plate[i : i + 2], 16) for i in (1, 3, 5))
            if abs(p[0] - pr) + abs(p[1] - pg) + abs(p[2] - pb) < 90:
                continue
        body.append(p)
    # Не среднее, а верхняя четверть яркости. У золотых и белых знаков
    # контур тёмный, и среднее утягивает их в «тёмные»: BOA на чёрном
    # читается прекрасно, а по среднему выходил тёмным и получал плашку.
    lums = sorted(lum(p) for p in body) or [128.0]
    ink = lums[int(len(lums) * 0.75) - 1]

    # Светлый знак — не тот, что ярче середины шкалы, а тот, что светлее
    # своей подложки. Без этой оговорки тёмная надпись на белой плашке
    # попадала в «светлые» и на белом фоне становилась невидимой.
    base = 128.0
    if plate:
        base = lum(tuple(int(plate[i : i + 2], 16) for i in (1, 3, 5)))
    tone = "light" if ink > base else "dark"
    # на тёмный фон продукта знак ложится сам, если подложки нет и он светлый
    on_dark = plate is None and tone == "light"
    return {
        "w": w,
        "h": h,
        "plate": plate,
        "tone": tone,
        "onDark": on_dark,
        "bytes": os.path.getsize(path),
    }


def main():
    rows = json.load(open(VENUES, encoding="utf-8"))
    rows = rows if isinstance(rows, list) else rows.get("venues", rows)
    by_id = {r["id"]: r for r in rows}
    src = {f["id"]: f for f in json.load(open(REPORT, encoding="utf-8"))["found"]}

    out = {}
    for fn in sorted(os.listdir(DIR)):
        if not fn.endswith("-logo.png"):
            continue
        vid = fn.replace("-logo.png", "")
        d = describe(os.path.join(DIR, fn))
        d["file"] = f"/venues/logos/{fn}"
        d["name"] = by_id.get(vid, {}).get("name", vid)
        d["src"] = src.get(vid, {}).get("src")
        d["own"] = vid not in CHAIN  # знак самой площадки, а не сети
        out[vid] = d

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for vid, d in out.items():
        mark = "" if d["own"] else "  (знак сети)"
        print(
            f"{vid} {d['name'][:32]:34} {d['w']:>4}x{d['h']:<4} "
            f"{'подложка ' + d['plate'] if d['plate'] else 'прозрачный':22} "
            f"{d['tone']:6}{mark}"
        )
    print(f"\nв индексе {len(out)} знаков → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
