#!/usr/bin/env python3
"""Сбор настоящих логотипов площадок с их собственных сайтов.

Берём только то, что сайт сам объявляет логотипом, — иначе в базу
попадут случайные картинки из шапки. Порядок доверия такой:

  1. JSON-LD (schema.org): organization.logo, publisher.logo — это
     прямое заявление владельца сайта «вот наш знак».
  2. WordPress custom-logo — тема ставит его в шапку осознанно.
  3. <img> в шапке, у которого logo в class/id/alt/src.
  4. apple-touch-icon и иконки веб-манифеста — почти всегда знак,
     обрезанный под квадрат, но уже без слова в подписи.
  5. favicon — последний рубеж, годится только если крупный.

og:image намеренно не берём: там фотография заведения, а не знак.

Каждый кандидат скачивается и проверяется: размер, доля прозрачности,
разнообразие цветов. Фотографию от знака отличает именно последнее —
у логотипа палитра короткая, у снимка длинная.
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

# Слова, по которым узнаётся чужой знак: сертификат, партнёр, награда,
# кнопка соцсети. Такой файл может лежать в шапке рядом с настоящим
# логотипом и выигрывать по всем формальным признакам — палитра
# короткая, фон прозрачный, — поэтому отсекаем по имени.
ALIEN = re.compile(
    r"travelife|tripadvisor|certified|certificate|award|badge|partner|sponsor|"
    r"payment|visa|mastercard|promptpay|booking|agoda|expedia|trustpilot|"
    r"facebook|instagram|tiktok|whatsapp|line-|youtube|google|"
    r"gdpr|cookie|consent|privacy",
    re.I,
)

# Хвост размера, который WordPress приписывает уменьшенным копиям.
WP_SIZE = re.compile(r"-(\d{2,4})x(\d{2,4})(?=\.[a-z0-9]+$)", re.I)


def domain(url: str) -> str:
    """Регистрируемый домен: site.co.th → site.co.th, cdn.site.com → site.com."""
    host = (urlparse(url).netloc or "").lower().split(":")[0]
    parts = [p for p in host.split(".") if p]
    if len(parts) < 2:
        return host
    if len(parts) >= 3 and parts[-2] in ("co", "com", "or", "net", "ac", "go"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENUES = os.path.join(ROOT, "src", "gtr", "data", "venues.json")
OUT_DIR = os.path.join(ROOT, "public", "venues", "logos")
REPORT = os.path.join(ROOT, "scripts", "venue-logos-report.json")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


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


# ---------- поиск кандидатов ----------

def from_jsonld(html: str, base: str):
    out = []
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.S | re.I,
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
                for key in ("logo", "image"):
                    v = n.get(key)
                    if isinstance(v, str) and key == "logo":
                        out.append((urljoin(base, v), 100))
                    elif isinstance(v, dict) and v.get("url") and key == "logo":
                        out.append((urljoin(base, v["url"]), 100))
                stack.extend(n.values())
    return out


def from_html(html: str, base: str):
    out = []

    # WordPress выносит логотип отдельным классом — это осознанный выбор темы
    for m in re.finditer(r'<img[^>]+class=["\'][^"\']*custom-logo[^"\']*["\'][^>]*>', html, re.I):
        src = re.search(r'src=["\']([^"\']+)', m.group(0))
        if src:
            out.append((urljoin(base, unescape(src.group(1))), 90))

    # любое изображение, которое само называет себя логотипом
    for m in re.finditer(r"<img[^>]+>", html, re.I):
        tag = m.group(0)
        if not re.search(r"logo", tag, re.I):
            continue
        src = re.search(r'(?:data-src|srcset|src)=["\']([^"\'\s]+)', tag)
        if src:
            out.append((urljoin(base, unescape(src.group(1))), 70))

    for rel, w in (("apple-touch-icon", 60), ("icon", 30), ("shortcut icon", 30), ("mask-icon", 25)):
        for m in re.finditer(
            r'<link[^>]+rel=["\'][^"\']*%s[^"\']*["\'][^>]*>' % re.escape(rel), html, re.I
        ):
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


# ---------- проверка кандидата ----------

def judge(raw: bytes):
    """Вернуть (изображение, оценка) или None, если это не знак."""
    if not raw or len(raw) < 300:
        return None
    try:
        im = Image.open(BytesIO(raw))
        im.load()
    except Exception:
        return None
    if im.width < 64 or im.height < 64:
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

    score = 0.0
    # прозрачный фон — почти верный признак знака, а не снимка
    if alpha > 0.25:
        score += 40
    elif alpha > 0.05:
        score += 15
    # короткая палитра — тоже
    if colors <= 24:
        score += 30
    elif colors <= 60:
        score += 15
    elif colors > 180:
        score -= 30
    score += min(20, im.width / 40)
    return im, score


def trim(im: Image.Image) -> Image.Image:
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    if im.width > 512 or im.height > 512:
        im.thumbnail((512, 512), Image.LANCZOS)
    return im


def main():
    rows = json.load(open(VENUES, encoding="utf-8"))
    rows = rows if isinstance(rows, list) else rows.get("venues", rows)
    only = set(sys.argv[1:]) or None

    os.makedirs(OUT_DIR, exist_ok=True)
    report = {"found": [], "nosite": [], "nologo": []}

    for v in rows:
        vid, name = v["id"], v["name"]
        if only and vid not in only:
            continue
        site = (v.get("website") or "").strip()
        if not site.startswith("http"):
            report["nosite"].append({"id": vid, "name": name, "social": v.get("social")})
            continue

        html = fetch(site)
        if not html:
            report["nologo"].append({"id": vid, "name": name, "site": site, "why": "сайт не ответил"})
            continue

        cands = from_jsonld(html, site) + from_html(html, site)
        seen, ordered, svgs = set(), [], []
        for url, w in sorted(cands, key=lambda x: -x[1]):
            if url in seen:
                continue
            seen.add(url)
            # Векторный знак — лучший источник, но растрировать его нечем:
            # в окружении нет ни cairosvg, ни rsvg. Складываем в отчёт,
            # вторым заходом их отрисует Chromium (scripts/svg-shot.mjs).
            (svgs if url.lower().split("?")[0].endswith(".svg") else ordered).append((url, w))

        # Знак ищем на домене самой площадки. Логотип с чужого хоста —
        # это либо родовой знак сети-владельца, либо вовсе партнёр:
        # так у пляжного клуба вместо его знака оказывалось дерево
        # гостиничной группы, взятое с сайта группы.
        home = domain(site)
        tokens = [t for t in re.split(r"[^a-z0-9]+", name.lower()) if len(t) > 3]

        best = None
        for url, w in ordered[:8]:
            if domain(url) != home:
                w -= 55
            if ALIEN.search(url):
                continue
            if any(t in url.lower() for t in tokens):
                w += 25
            # WordPress отдаёт в шапке уменьшенную копию; оригинал лежит
            # рядом без хвоста размера и почти всегда крупнее и чище.
            raw = None
            if WP_SIZE.search(url):
                raw = fetch(WP_SIZE.sub("", url), binary=True)
                if raw and judge(raw):
                    url = WP_SIZE.sub("", url)
            if not raw:
                raw = fetch(url, binary=True)
            j = judge(raw)
            if not j:
                continue
            im, s = j
            total = s + w
            if not best or total > best[0]:
                best = (total, im, url)

        if not best:
            keep = [u for u, _ in svgs if not ALIEN.search(u) and domain(u) == home][:3]
            report["nologo"].append(
                {
                    "id": vid,
                    "name": name,
                    "site": site,
                    "why": "вектор, нужен Chromium" if keep else "кандидатов нет",
                    "svg": keep,
                    "tried": len(ordered),
                }
            )
            continue

        total, im, url = best
        out = trim(im)
        path = os.path.join(OUT_DIR, f"{vid}-logo.png")
        out.save(path, "PNG", optimize=True)
        report["found"].append(
            {
                "id": vid,
                "name": name,
                "src": url,
                "score": round(total, 1),
                "size": f"{out.width}x{out.height}",
                "bytes": os.path.getsize(path),
            }
        )
        print(f"{vid} {name[:36]:38} {out.width}x{out.height:<5} {round(total)} {urlparse(url).netloc}")

    json.dump(report, open(REPORT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(
        f"\nнашли {len(report['found'])} · сайт есть, знака нет {len(report['nologo'])}"
        f" · сайта нет вовсе {len(report['nosite'])}"
    )


if __name__ == "__main__":
    main()
