"""Gwent kart verisini gwent.one API'sinden indirip cards.js dosyasını üretir.

Kart verisi (isimler, metinler, görseller) CD PROJEKT RED'e aittir. Metinler (cards.js, cards-info.json) depoda bulunur;
görseller bulunmaz. Metinleri güncellemek için çalıştır:  py -3 tools/fetch_cards.py
(İstersen daha önce indirdiğin bir JSON dosyasını da verebilirsin:  py -3 tools/fetch_cards.py gwent.json)

Downloads Gwent card data from the gwent.one API and writes cards.js.
Card data belongs to CD PROJEKT RED. The texts (cards.js, cards-info.json) are kept in the repository; images are not.
"""
import json
import os
import re
import sys
import urllib.request

API = "https://api.gwent.one/?key=data&response=json&html=info&language=en"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "cards.js")
INFO = os.path.join(ROOT, "cards-info.json")   # yetenek/güç/provizyon (kart detayında gösterim)


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


TAG = re.compile(r"<[^>]+>")


def keywords(html):
    """keyword_html -> [[ad, açıklama], ...] (etiketler atılır, düz metin saklanır)"""
    out = []
    for line in (html or "").split("\n"):
        t = TAG.sub("", line).strip()
        if ":" in t:
            k, d = t.split(":", 1)
            out.append([k.strip(), d.strip()])
    return out


def build_info(raw):
    """Oyun özellikleri (yetenek, güç, zırh, provizyon...). Mekanik değil, kart detayında gösterim için.
    by_art: koleksiyon kartları (art id ile), by_card: ilgili jetonlar dahil bütün kartlar (kart id ile)."""
    rows = raw["response"]
    rows = rows.values() if isinstance(rows, dict) else rows
    by_card, by_art = {}, {}
    for r in rows:
        a, i = r["attributes"], r["id"]
        cid = str(i["card"])
        by_card[cid] = {"a": i["art"], "n": r["name"], "c": r.get("category") or "", "t": a.get("type"),
                        "p": a.get("power") or 0, "ar": a.get("armor") or 0, "pr": a.get("provision") or 0,
                        "col": a.get("color"), "set": a.get("set"), "by": a.get("artist") or "",
                        "ab": (r.get("ability") or "").strip(), "kw": keywords(r.get("keyword_html")),
                        "rel": [x for x in str(a.get("related") or "").split(",") if x.strip()], "au": i.get("audio")}
        if a.get("set") != "NonOwnable":
            by_art.setdefault(str(i["art"]), cid)
    return {"byArt": by_art, "byCard": by_card}


def main_from(src):
    raw = load(src)
    with open(INFO, "w", encoding="utf-8", newline="\n") as f:
        json.dump(build_info(raw), f, ensure_ascii=False, separators=(",", ":"))
    print(f"Kart özellikleri yazıldı: {INFO}")
    cards, extra = build(raw)
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
