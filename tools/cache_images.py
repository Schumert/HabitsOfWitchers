"""Bütün kart, canavar ve kılıç görsellerini bir kez indirip hofw-gorsel.db'ye kaydeder.
Sonra uygulama görselleri internete gitmeden kendi veritabanından gösterir. Önbellekte olanlar atlanır,
yani yarıda kesilirse tekrar çalıştırmak kaldığı yerden devam eder.

Çalıştır:  py -3 tools/cache_images.py            (kartların 'low' görselleri + canavarlar + kılıçlar)
           py -3 tools/cache_images.py --all      (kartların 'medium' görselleri de)

Downloads every card, monster and sword image once into hofw-gorsel.db.
"""
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import imgcache  # noqa: E402

ART = "https://gwent.one/image/gwent/assets/card/art/{q}/{a}.jpg"


def js_array(name, path):
    src = open(os.path.join(ROOT, path), encoding="utf-8").read()
    m = re.search(r"window\." + name + r"\s*=\s*(\[.*?\]);\s*\n", src, re.S)
    return json.loads(m.group(1)) if m else []


def urls(all_quality):
    out = []
    for c in js_array("GWENT_CARDS", "cards.js"):
        out.append(ART.format(q="low", a=c["a"]))
        if all_quality:
            out.append(ART.format(q="medium", a=c["a"]))
    for m in js_array("KM_MONSTERS", "monsters.js"):
        if m.get("art"):
            out += [ART.format(q="medium", a=m["art"]), ART.format(q="low", a=m["art"])]
        elif m.get("img"):
            out.append(m["img"])
    for w in js_array("KM_SWORDS", "swords.js"):
        if w.get("img"):
            out.append(w["img"])
    return [u for u in dict.fromkeys(out) if imgcache.allowed(u)]


def one(u):
    if imgcache.lookup(u):
        return "skip"
    try:
        imgcache.get(u)
        return "ok"
    except Exception as e:  # noqa: BLE001
        return f"fail {e}"


def main():
    todo = urls("--all" in sys.argv)
    print(f"{len(todo)} görsel / images")
    stats = {"ok": 0, "skip": 0, "fail": 0}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for i, r in enumerate(ex.map(one, todo), 1):
            stats[r.split()[0]] += 1
            if i % 100 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)}  yeni {stats['ok']} · vardı {stats['skip']} · hata {stats['fail']}")
    n, size = imgcache.count()
    print(f"Önbellekte {n} görsel, {size / 1024 / 1024:.1f} MB ({imgcache.DB_PATH})")


if __name__ == "__main__":
    main()
