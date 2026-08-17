# Прямые ссылки на музыку вместо страниц поиска.
#
# В базе у большинства артистов yt/sp/sc — это поисковые выдачи: человек
# жмёт «сеты» и попадает в список чужих видео. Здесь мы один раз офлайн
# разрешаем YouTube-поиск в конкретный ролик, но только когда имя артиста
# реально видно в заголовке или на канале: неверная ссылка хуже поиска.
import json, re, subprocess, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor

SRC = "src/gtr/data/artists.json"
REPORT = "/tmp/claude-0/-home-user/13a63ce4-42e7-5fd5-beab-3488888af37f/scratchpad/music-resolve.json"


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9а-яё]+", "", s)


def fetch(url: str) -> str:
    r = subprocess.run(
        ["curl", "-sS", "--max-time", "35", "-A", "Mozilla/5.0", "-H", "accept-language: en", url],
        capture_output=True, text=True,
    )
    return r.stdout or ""


def videos(html: str):
    """Ролики из ytInitialData: id, заголовок, канал."""
    out = []
    for m in re.finditer(r'"videoRenderer":\{(.{0,4000}?)"trackingParams"', html, re.S):
        blob = m.group(1)
        vid = re.search(r'"videoId":"([\w-]{11})"', blob)
        if not vid:
            continue
        title = " ".join(re.findall(r'"title":\{"runs":\[\{"text":"(.*?)"', blob)[:1])
        owner = " ".join(re.findall(r'"ownerText":\{"runs":\[\{"text":"(.*?)"', blob)[:1])
        out.append((vid.group(1), title, owner))
    return out


def resolve(a):
    name = a["name"]
    key = fold(name)
    if len(key) < 4:
        return a["id"], None, "имя слишком короткое для проверки"
    q = re.sub(r"\s+", "+", f"{name} dj set")
    html = fetch(f"https://www.youtube.com/results?search_query={q}")
    vs = videos(html)
    if not vs:
        return a["id"], None, "выдача пустая"
    for vid, title, owner in vs[:12]:
        if key in fold(title) or key in fold(owner):
            return a["id"], f"https://www.youtube.com/watch?v={vid}", f"{title} — {owner}"
    return a["id"], None, "имя не подтвердилось ни в одном ролике"


data = json.load(open(SRC, encoding="utf-8"))
arts = data["artists"]
todo = [a for a in arts if "youtube.com/results" in str(a.get("yt", ""))]
print(f"к разрешению: {len(todo)} из {len(arts)}", flush=True)

res = {}
with ThreadPoolExecutor(max_workers=5) as ex:
    for i, (aid, url, why) in enumerate(ex.map(resolve, todo), 1):
        res[aid] = {"url": url, "why": why}
        if i % 25 == 0:
            print(f"  {i}/{len(todo)}", flush=True)

hit = 0
for a in arts:
    r = res.get(a["id"])
    if r and r["url"]:
        a["ytSearch"] = a["yt"]
        a["yt"] = r["url"]
        hit += 1

json.dump(data, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
json.dump(res, open(REPORT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"прямых ссылок на клипы: {hit} из {len(todo)}")
