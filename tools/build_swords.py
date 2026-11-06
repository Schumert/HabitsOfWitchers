"""swords.js'i witcherdb.com kılıç listesinden üretir.

Kullanım: önce witcherdb.com/swords sayfalarını (1–8) bir klasöre indir, sonra:
    py -3 tools/build_swords.py <sayfaların klasörü>
Var olan kılıçların kimlikleri (id), görselleri ve avcı sınıfları korunur; kayıtlar bozulmaz.

Kılıçlarda seviye şartı ve sabit güç yok: güç, kılıcın seviyesine ve kademesine göre motor tarafından hesaplanır (engine.js),
kademe olasılıkları da seviyene göre değişir (RARITY_ODDS). Bu betik sadece adı, türü, kademesi, okulu, avcı sınıfını ve görseli yazar.
Kademe: witcherdb Common → 1 Sıradan, Master → 2 Usta işi, Magic → 3 Büyülü, okulsuz Legendary → 4 Efsanevi,
okul kılıçları (Relic/Legendary) → 5 Okul seti (v: aşama 0–5; satılmaz, boss şemasıyla yapılır), Aerondight → 6 Kadim.

Builds swords.js from witcherdb.com list pages (names, types, rarities, schools, banes, images).
"""
import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "swords.js")
BASE = "https://witcherdb.com"
ITEM = re.compile(r'<img src="(?P<icon>[^"]+)"[^>]*/></span><div class="min-w-0 flex-1"><a href="/items/(?P<slug>[^"]+)"[^>]*>(?P<name>[^<]+)</a>'
                  r'<div[^>]*><span[^>]*><span[^>]*></span>(?P<rar>[^<]+)</span><span>(?P<type>[^<]+)</span>')
SCHOOL_OF = {"Wolf": "wolf", "Feline": "cat", "Ursine": "bear", "Griffin": "griffin", "Viper": "viper", "Manticore": "manticore"}
BANES = {"silver": ["Necrophage", "Relict", "Vampire", "Specter"], "steel": ["Beast", "Ogroid", "Insectoid"]}
TIER = {"Common": 1, "Master": 2, "Magic": 3, "Legendary": 4}
RANK = {"Common": 0, "Master": 1, "Magic": 2, "Relic": 3, "Legendary": 4}
# okulların başlangıç donanımındaki kılıçlar: her zaman Sıradan ve en alt seviyede kalır (engine.js START_KIT)
STARTERS = {("silver", n) for n in ("mastercrafted silver sword", "eirlithrad", "disglair", "gven'nel")} |     {("steel", n) for n in ("witch hunter's sword", "elven steel sword", "scoia'tael sword", "nilfgaardian longsword", "skellige longsword",
                            "novigrad longsword", "vrihedd brigade sword", "red meteorite steel sword")}


def unescape(t):
    return t.replace("&#x27;", "'").replace("&amp;", "&").replace("&quot;", '"').strip()


def page_rows(folder):
    files = sorted(glob.glob(os.path.join(folder, "*.html")), key=lambda f: int(re.sub(r"\D", "", os.path.basename(f)) or 1))
    rows, seen = [], {}
    for f in files:
        for m in ITEM.finditer(open(f, encoding="utf-8", errors="ignore").read()):
            t = m.group("type")
            kind = "silver" if t.startswith("Silver") else "steel" if t.startswith("Steel") else None
            if not kind:
                continue
            name = unescape(m.group("name"))
            row = {"name": name, "type": kind, "rar": m.group("rar"), "school": next((v for k, v in SCHOOL_OF.items() if k in t), None),
                   "icon": BASE + m.group("icon")}
            key = (kind, name.lower())
            if key in seen:                           # aynı kılıç farklı kademelerde (temel / geliştirilmiş / NG+) listelenir
                seen[key]["opts"].add(row["rar"])
                continue
            row["opts"] = {row["rar"]}
            seen[key] = row
            rows.append(row)
    # birden çok kademesi olan kılıç, seçenekleri arasında en az kılıcı olan kademeye gider (kademeler dengeli dolsun)
    for kind in ("silver", "steel"):
        count = Counter(r["rar"] for r in rows if r["type"] == kind and len(r["opts"]) == 1)
        for r in rows:
            if (kind, r["name"].lower()) in STARTERS and r["type"] == kind:
                r["rar"] = "Common"
                count["Common"] += 1
            elif r["type"] == kind and len(r["opts"]) > 1:
                r["rar"] = min(sorted(r["opts"], key=lambda x: RANK.get(x, 9)), key=lambda x: count[x])
                count[r["rar"]] += 1
    return rows                                        # witcherdb sırası: değer büyükten küçüğe


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def bane(kind, name):
    return BANES[kind][int(hashlib.md5(name.encode()).hexdigest(), 16) % len(BANES[kind])]


def variant(name):
    n = name.lower()
    if n.startswith("legendary"):
        return 5
    if "grandmaster" in n:
        return 4
    if "mastercrafted" in n:
        return 3
    if "superior" in n or n == "teigr":
        return 2
    if "enhanced" in n or n.startswith("forgotten"):
        return 1
    return 0


def make(r, kind, tier, prev, extra=None):
    w = {"name": r["name"], "type": kind, "tier": tier, "school": r.get("school"), "id": prev["id"] if prev else f"{kind}-{slug(r['name'])}",
         "bane": prev["bane"] if prev else bane(kind, r["name"]), "img": (prev or {}).get("img") or r["icon"]}
    w.update(extra or {})
    return w


def main(folder):
    src = open(OUT, encoding="utf-8").read()
    head, rest = src.split("window.KM_SWORDS = ", 1)
    old = json.loads(rest.strip().rstrip(";"))
    by_name = {(w["type"], w["name"].lower()): w for w in old}
    rows = page_rows(folder)
    out = []
    for kind in ("silver", "steel"):
        for rar, tier in TIER.items():
            group = [r for r in rows if r["type"] == kind and r["rar"] == rar and not r["school"] and r["name"].lower() != "aerondight"]
            group.reverse()                                                   # değeri düşükten yükseğe
            group.sort(key=lambda r: 0 if (kind, r["name"].lower()) in STARTERS else 1)
            for r in group:
                out.append(make(r, kind, tier, by_name.get((kind, r["name"].lower()))))
        for r in [r for r in rows if r["type"] == kind and r["school"]]:     # okul kılıçları: aşamaya göre okul seti
            v = variant(r["name"])
            out.append(make(r, kind, 5, by_name.get((kind, r["name"].lower())), {"set": True, "v": v}))
    aero = by_name.get(("silver", "aerondight")) or {}
    out.append({"name": "Aerondight", "type": "silver", "tier": 6, "school": None, "id": aero.get("id", "silver-aerondight"),
                "bane": aero.get("bane", "Specter"), "img": aero.get("img") or BASE + "/icons/inventory/weapons/silver_unique_aerondight_64x128.webp"})
    ids = [w["id"] for w in out]
    assert len(ids) == len(set(ids)), [i for i, n in Counter(ids).items() if n > 1]
    missing = [w["name"] for w in old if (w["type"], w["name"].lower()) not in {(x["type"], x["name"].lower()) for x in out}]
    assert not missing, f"eski kılıç kayboldu: {missing}"
    head = re.sub(r"^// Kılıç listesi:.*?(?=window\.KM_SWORD_TIERS)", "// Kılıç listesi: witcherdb.com/swords (tools/build_swords.py ile üretilir). Görseller: Witcher wiki ve witcherdb.\n"
                  "// tier: 1 Sıradan, 2 Usta işi, 3 Büyülü, 4 Efsanevi, 5 Okul seti, 6 Kadim. Güç ve fiyat kılıcın seviyesine göre engine.js'te hesaplanır.\n"
                  "// bane: bu sınıftaki canavarlara ek hasar.\n"
                  "// set: okul seti, satılmaz, boss şemasıyla yapılır (v: aşama 0–5).\n", head, flags=re.S)
    open(OUT, "w", encoding="utf-8").write(head + "window.KM_SWORDS = [\n" + ",\n".join(json.dumps(w, ensure_ascii=False) for w in out) + "\n];\n")
    print(len(out), "kılıç", Counter((w["type"], w["tier"]) for w in out))


if __name__ == "__main__":
    main(sys.argv[1])
