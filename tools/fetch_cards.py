"""Gwent kart verisini gwent.one API'sinden indirip cards.js dosyasını üretir.

Kart verisi (isimler, metinler, görseller) CD PROJEKT RED'e aittir ve bu depoda dağıtılmaz.
Kurulumda bir kez çalıştır:  py -3 tools/fetch_cards.py
(İstersen daha önce indirdiğin bir JSON dosyasını da verebilirsin:  py -3 tools/fetch_cards.py gwent.json)

Downloads Gwent card data from the gwent.one API and writes cards.js.
Card data belongs to CD PROJEKT RED and is not distributed with this repository.
"""
import json
import os
import sys
import urllib.request

API = "https://api.gwent.one/?key=data&response=json&html=info&language=en"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "cards.js")


def load(src=None):
    if src:
        with open(src, encoding="utf-8") as f:
            return json.load(f)
    req = urllib.request.Request(API, headers={"User-Agent": "HabitsOfWitchers-card-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def build(raw):
    rows = raw["response"]
    rows = rows.values() if isinstance(rows, dict) else rows
    out, seen, extra = [], set(), {}
    for r in rows:
        a = r["attributes"]
        art = r["id"]["art"]
        if a.get("set") == "NonOwnable":   # jeton/çağrılan kartlar koleksiyona girmez; sadece canavar açıklaması için metni saklanır
            if a.get("type") == "Unit" and (r.get("flavor") or "").strip():
                extra.setdefault(str(art), r["flavor"].strip())
            continue
        if art in seen:                     # aynı görselli kopyalar alınmaz
            continue
        seen.add(art)
        out.append({"a": art, "n": r["name"], "c": r.get("category") or "", "r": a["rarity"],
                    "f": a["faction"], "t": a["type"], "fl": (r.get("flavor") or "").strip()})
    return out, extra


def main_from(src):
    cards, extra = build(load(src))
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("// gwent.one API verisinden üretildi (tools/fetch_cards.py). a=art id, n=isim, c=kategori, r=nadirlik, f=fraksiyon, t=tür, fl=flavor\n")
        f.write("window.GWENT_CARDS = " + json.dumps(cards, ensure_ascii=False) + ";\n")
        f.write("// toplanamayan kartların açıklamaları (sadece canavar metni için)\n")
        f.write("window.GWENT_EXTRA = " + json.dumps(extra, ensure_ascii=False) + ";\n")
    print(f"{len(cards)} kart yazıldı: {OUT}")


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    main_from(sys.argv[1] if len(sys.argv) > 1 else None)


if __name__ == "__main__":
    main()
