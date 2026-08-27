#!/usr/bin/env python3
"""Сбор настоящих логотипов музыкальных лейблов с их официальных сайтов.

Та же логика, что и venue-logos.py: берём только то, что сайт сам
объявляет логотипом (JSON-LD, custom-logo, alt/class с logo, иконки),
и проверяем кандидата на прозрачность и короткую палитру — это отличает
знак от фотографии обложки релиза.

Bandcamp, Beatport и Resident Advisor отдают только JPEG-фото профиля
без альфа-канала — они не годятся, когда просят логотип «без фона»,
поэтому в реестре ниже — только лейблы с собственным сайтом.
"""

import json
import os
import re
import subprocess
import sys
from html import unescape
from io import BytesIO
from urllib.parse import urljoin, urlparse

from PIL import Image

try:
    import cairosvg
except Exception:
    cairosvg = None

ALIEN = re.compile(
    r"travelife|tripadvisor|certified|certificate|award|badge|partner|sponsor|"
    r"payment|visa|mastercard|booking|agoda|trustpilot|"
    r"facebook|instagram|tiktok|whatsapp|line-|youtube|google|"
    r"gdpr|cookie|consent|privacy",
    re.I,
)
WP_SIZE = re.compile(r"-(\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+$)", re.I)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "labels", "logos")
DATA_OUT = os.path.join(ROOT, "src", "gtr", "data", "label-logos.json")
REPORT = os.path.join(ROOT, "scripts", "label-logos-report.json")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

# Только лейблы с достижимым официальным сайтом (проверено curl).
LABELS = [
    {"id": "piston-recordings", "name": "Piston Recordings", "site": "https://www.pistonrecordings.com/"},
    {"id": "robsoul-recordings", "name": "Robsoul Recordings", "site": "https://robsoulrecordings.com/"},
    {"id": "big-bells-digital", "name": "Big Bells Digital", "site": "https://www.bigbellsdigital.com/"},
    {"id": "rs-records", "name": "R&S Records", "site": "https://www.rsrecords.com/"},
    {"id": "suara", "name": "Suara", "site": "https://www.suara-music.com/"},
    {"id": "knights-of-frequency", "name": "Knights of Frequency", "site": "https://knightsoffrequency.com/"},
]


def fetch(url: str, binary: bool = False, timeout: int = 25):
    try:
        r = subprocess.run(
            ["curl", "-sL", "-m", str(timeout), "-A", UA, "--compressed", url],
            capture_output=True,
            timeout=timeout + 8,
        )
        if r.returncode != 0 or not r.stdout:
            return None
        return r.stdout if binary else r.stdout.decode("utf-8", "replace")
    except Exception:
        return None


def domain(url: str) -> str:
    host = (urlparse(url).netloc or "").lower().split(":")[0]
    parts = [p for p in host.split(".") if p]
    if len(parts) < 2:
        return host
    if len(parts) >= 3 and parts[-2] in ("co", "com", "or", "net", "ac", "go"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def from_jsonld(html: str, base: str):
    out = []
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S | re.I
    ):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        stack = [data]
        while stack:
            n = stack.pop()
            if isinstance(n, list):
                stack.extend(n)
            elif isinstance(n, dict):
                v = n.get("logo")
                if isinstance(v, str):
                    out.append((urljoin(base, v), 100))
                elif isinstance(v, dict) and v.get("url"):
                    out.append((urljoin(base, v["url"]), 100))
                stack.extend(n.values())
    return out


def from_html(html: str, base: str):
    out = []
    for m in re.finditer(r'<img[^>]+class=["\'][^"\']*custom-logo[^"\']*["\'][^>]*>', html, re.I):
        src = re.search(r'src=["\']([^"\']+)', m.group(0))
        if src:
            out.append((urljoin(base, unescape(src.group(1))), 90))

    for m in re.finditer(r"<img[^>]+>", html, re.I):
        tag = m.group(0)
        if not re.search(r"logo", tag, re.I):
            continue
        src = re.search(r'(?:data-src|srcset|src)=["\']([^"\'\s]+)', tag)
        if src:
            out.append((urljoin(base, unescape(src.group(1))), 70))

    for rel, w in (("apple-touch-icon", 60), ("icon", 30), ("shortcut icon", 30), ("mask-icon", 25)):
        for m in re.finditer(r'<link[^>]+rel=["\'][^"\']*%s[^"\']*["\'][^>]*>' % re.escape(rel), html, re.I):
            href = re.search(r'href=["\']([^"\']+)', m.group(0))
            if href:
                out.append((urljoin(base, unescape(href.group(1))), w))

    man = re.search(r'<link[^>]+rel=["\']manifest["\'][^>]*href=["\']([^"\']+)', html, re.I)
    if man:
        murl = urljoin(base, unescape(man.group(1)))
        raw = fetch(murl)
        if raw:
            try:
                icons = json.loads(raw).get("icons") or []
                for ic in icons:
                    if ic.get("src"):
                        out.append((urljoin(murl, ic["src"]), 55))
            except Exception:
                pass
    return out


def judge(raw: bytes, require_alpha: bool):
    """Вернуть (изображение, оценка) или None. Логотип «без фона» обязан
    нести реальную прозрачность — иначе это фото или закрашенная иконка."""
    if not raw or len(raw) < 300:
        return None
    try:
        im = Image.open(BytesIO(raw))
        im.load()
    except Exception:
        return None
    if im.width < 32 or im.height < 20 or im.width * im.height < 1200:
        return None
    ar = im.width / im.height
    if ar > 8 or ar < 0.125:
        return None

    im = im.convert("RGBA")
    small = im.resize((min(im.width, 160), min(im.height, 160)))
    px = list(small.getdata())
    n = len(px)
    alpha = sum(1 for p in px if p[3] < 24) / n
    colors = len({(p[0] // 24, p[1] // 24, p[2] // 24) for p in px if p[3] > 24})

    if require_alpha and alpha < 0.05:
        return None

    score = 0.0
    if alpha > 0.25:
        score += 40
    elif alpha > 0.05:
        score += 15
    if colors <= 24:
        score += 30
    elif colors <= 60:
        score += 15
    elif colors > 180:
        score -= 30
    score += min(20, im.width / 40)
    return im, score, alpha


def trim(im: Image.Image) -> Image.Image:
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    if im.width > 512 or im.height > 512:
        im.thumbnail((512, 512), Image.LANCZOS)
    return im


def main():
    only = set(sys.argv[1:]) or None
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {"found": [], "nologo": []}
    data_out = {}

    for lb in LABELS:
        if only and lb["id"] not in only:
            continue
        lid, name, site = lb["id"], lb["name"], lb["site"]
        html = fetch(site)
        if not html:
            report["nologo"].append({"id": lid, "name": name, "site": site, "why": "сайт не ответил"})
            continue

        cands = from_jsonld(html, site) + from_html(html, site)
        seen, ordered, svgs = set(), [], []
        for url, w in sorted(cands, key=lambda x: -x[1]):
            if url in seen:
                continue
            seen.add(url)
            (svgs if url.lower().split("?")[0].endswith(".svg") else ordered).append((url, w))

        home = domain(site)
        tokens = [t for t in re.split(r"[^a-z0-9]+", name.lower()) if len(t) > 3]

        best = None
        for url, w in ordered[:10]:
            if domain(url) != home:
                w -= 55
            if ALIEN.search(url):
                continue
            if any(t in url.lower() for t in tokens):
                w += 25
            raw = None
            if WP_SIZE.search(url):
                raw = fetch(WP_SIZE.sub("", url), binary=True)
                if raw and judge(raw, True):
                    url = WP_SIZE.sub("", url)
            if not raw:
                raw = fetch(url, binary=True)
            j = judge(raw, True)
            if not j:
                continue
            im, s, alpha = j
            total = s + w
            if not best or total > best[0]:
                best = (total, im, url, alpha)

        if not best and cairosvg:
            for url, w in svgs[:6]:
                if domain(url) != home or ALIEN.search(url):
                    continue
                raw = fetch(url, binary=True)
                if not raw:
                    continue
                try:
                    png_bytes = cairosvg.svg2png(bytestring=raw, output_width=512)
                except Exception:
                    continue
                j = judge(png_bytes, True)
                if not j:
                    continue
                im, s, alpha = j
                total = s + w + 10  # SVG — векторный знак, источник надёжнее растра
                if not best or total > best[0]:
                    best = (total, im, url, alpha)

        if not best:
            report["nologo"].append(
                {
                    "id": lid,
                    "name": name,
                    "site": site,
                    "why": "нет прозрачного логотипа (PNG или SVG)",
                    "tried": len(ordered) + len(svgs),
                }
            )
            print(f"— {lid:22s} {name:26} нет прозрачного логотипа ({len(ordered)} png + {len(svgs)} svg)")
            continue

        total, im, url, alpha = best
        out = trim(im)
        path = os.path.join(OUT_DIR, f"{lid}-logo.png")
        out.save(path, "PNG", optimize=True)
        small = out.resize((min(out.width, 80), min(out.height, 80)))
        px = list(small.convert("RGBA").getdata())
        avg_light = sum((p[0] + p[1] + p[2]) / 3 for p in px if p[3] > 24) / max(
            1, sum(1 for p in px if p[3] > 24)
        )
        tone = "light" if avg_light > 150 else "dark"
        rec = {
            "name": name,
            "file": f"/labels/logos/{lid}-logo.png",
            "w": out.width,
            "h": out.height,
            "tone": tone,
            "onDark": tone == "light",
            "site": site,
            "src": url,
            "bytes": os.path.getsize(path),
        }
        data_out[lid] = rec
        report["found"].append({"id": lid, "name": name, "src": url, "score": round(total, 1), "size": f"{out.width}x{out.height}"})
        print(f"{lid:22s} {name:26} {out.width}x{out.height:<5} score={round(total)} alpha={alpha:.2f} {urlparse(url).netloc}")

    # мёржим поверх уже сохранённых записей, а не затираем
    existing = {}
    if os.path.exists(DATA_OUT):
        existing = json.load(open(DATA_OUT, encoding="utf-8"))
    existing.update(data_out)
    json.dump(existing, open(DATA_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(report, open(REPORT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nнашли {len(report['found'])} · без логотипа {len(report['nologo'])}")


if __name__ == "__main__":
    main()
