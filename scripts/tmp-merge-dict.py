# Вливает tr-out-*.json в i18n-dict.ts: новые ключи в конец EN и TH.
import json, glob, re

S = "/tmp/claude-0/-home-user/13a63ce4-42e7-5fd5-beab-3488888af37f/scratchpad"
merged = {}
for f in sorted(glob.glob(f"{S}/tr-out-*.json")):
    part = json.load(open(f))
    for k, v in part.items():
        assert isinstance(v, dict) and v.get("en") and v.get("th"), (f, k)
        merged[k] = v
need = set(json.load(open(f"{S}/missing.json"))["missEN"])
got = set(merged)
print("need", len(need), "got", len(got), "missing", sorted(need - got)[:5], "extra", sorted(got - need)[:5])
assert need == got, "покрытие батчей неполное"

def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")

p = "src/gtr/i18n-dict.ts"
src = open(p).read()
en_block = "\n  // --- кабинеты, карта, ночная жизнь (добивка) ---\n" + "".join(
    f'  "{esc(k)}": "{esc(v["en"])}",\n' for k, v in merged.items())
th_block = "\n  // --- кабинеты, карта, ночная жизнь (добивка) ---\n" + "".join(
    f'  "{esc(k)}": "{esc(v["th"])}",\n' for k, v in merged.items())

ends = [m.start() for m in re.finditer(r"^};", src, re.M)]
assert len(ends) == 2, ends
# вставляем с конца, чтобы смещения не поплыли
src = src[:ends[1]] + th_block + src[ends[1]:]
src = src[:ends[0]] + en_block + src[ends[0]:]
open(p, "w").write(src)
print("merged", len(merged), "keys into EN/TH")
