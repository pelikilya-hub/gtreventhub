# Фото площадок регионов: официальный сайт -> hero в rich.json.
#
# Паспорт без фотографии выглядит пустым: в списке базы карточка — это
# прежде всего кадр места, а текст под ним. У пхукетской базы фото
# собирались руками и агентами, для регионов это надо делать пачками,
# поэтому берём то, что площадка сама о себе публикует: og:image со
# своего сайта — это витринный кадр, выбранный самим заведением.
#
# Ничего не выдумываем и здесь: если сайта нет или картинка не прошла
# проверку (мелкая, кривых пропорций, битая) — площадка остаётся без
# фото до ручного захода. Источник пишем в credit.
#
# Запуск: python3 scripts/region-photos.py [коды регионов через пробел]
import glob, io, json, os, re, subprocess, sys
from urllib.parse import urljoin, urlparse
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RICH_PATH = f"{REPO}/src/gtr/data/rich.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

# Логотипы, иконки и заглушки под hero не годятся — карточка с логотипом
# читается как пустая ровно так же, как карточка без фото.
BAD = re.compile(r"logo|icon|favicon|sprite|placeholder|avatar|badge|whatsapp|footer", re.I)


def fetch(url, binary=False):
    r = subprocess.run(
        ["curl", "-sL", "--max-time", "25", "-A", UA, url],
        capture_output=True,
    )
    return r.stdout if binary else r.stdout.decode("utf-8", "ignore")


def candidates(page, base):
    """Кадры со страницы по убыванию доверия: og -> twitter -> разметка -> img.

    Половина сайтов грузит картинки лениво: в `src` стоит заглушка, а
    настоящий файл лежит в data-src или srcset. Раньше мы их не видели и
    уходили ни с чем с сайтов, где фото были на виду."""
    out = []
    for pat in (
        r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)',
        r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)',
        r'"image"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
        r'"contentUrl"\s*:\s*"([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
    ):
        out += re.findall(pat, page, re.I)
    # тело страницы: обычные, ленивые и адаптивные картинки
    body = re.findall(
        r'(?:src|data-src|data-lazy-src|data-original|data-bg)=["\']([^"\']+\.(?:jpg|jpeg|png|webp)[^"\']*)',
        page, re.I)[:20]
    for s in re.findall(r'srcset=["\']([^"\']+)["\']', page, re.I)[:10]:
        # из набора берём последний — он самый крупный
        parts = [p.strip().split(" ")[0] for p in s.split(",") if p.strip()]
        if parts:
            body.append(parts[-1])
    out += body
    seen, clean = set(), []
    for u in out:
        u = urljoin(base, u.strip())
        if not u.startswith("http") or u in seen or BAD.search(u):
            continue
        seen.add(u)
        clean.append(u)
    return clean[:10]


def save_hero(vid, url):
    """Качаем и проверяем кадр. Возвращаем True, если фото легло на диск."""
    data = fetch(url, binary=True)
    if len(data) < 15000:
        return False
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        im = im.convert("RGB")
    except Exception:
        return False
    w, h = im.size
    # узкие баннеры и вертикальные сторис под hero не годятся
    if w < 500 or h < 280 or w / h > 3.2 or h / w > 2.2:
        return False
    im.thumbnail((900, 900))
    im.save(f"{REPO}/public/venues/{vid}-hero.jpg", "JPEG", quality=82)
    return True


def main():
    codes = sys.argv[1:]
    rich = json.load(open(RICH_PATH))
    files = sorted(glob.glob(f"{REPO}/src/gtr/data/regions/[a-z][a-z][a-z].json"))
    got = nosite = failed = 0
    for f in files:
        code = os.path.basename(f)[:3]
        if codes and code not in codes:
            continue
        doc = json.load(open(f))
        for v in doc["venues"]:
            vid = v["id"]
            if (rich.get(vid) or {}).get("hero"):
                continue
            site = (v.get("website") or "").strip()
            if not site.startswith("http"):
                nosite += 1
                continue
            page = fetch(site)
            pool = candidates(page, site)
            # Если на главной кадра не нашлось — заглядываем в галерею.
            # Дальше не идём: обходить сайт целиком ради одной картинки
            # дорого и невежливо к чужому серверу.
            if not pool:
                for href in re.findall(
                        r'href="([^"]{0,120}(?:gallery|photos|about|venue)[^"]{0,40})"', page, re.I)[:2]:
                    pool = candidates(fetch(urljoin(site, href)), site)
                    if pool:
                        break
            ok = False
            for u in pool:
                if save_hero(vid, u):
                    dom = urlparse(site).netloc.replace("www.", "")
                    rich.setdefault(vid, {}).update(
                        {"hero": f"/venues/{vid}-hero.jpg", "src": dom.upper(),
                         "credit": f"{v['name']} · официальный сайт"}
                    )
                    ok = True
                    got += 1
                    break
            if not ok:
                failed += 1
            print(f"  {vid} {'OK ' if ok else '—  '}{v['name'][:40]}", flush=True)
    json.dump(rich, open(RICH_PATH, "w"), ensure_ascii=False, indent=2)
    print(f"фото: получено {got}, без сайта {nosite}, сайт есть но кадр не взят {failed}")


if __name__ == "__main__":
    main()
