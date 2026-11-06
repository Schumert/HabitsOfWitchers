# Habits of Witchers

Witcher temalı, oyunlaştırılmış bir alışkanlık takipçisi. Uyku düzeni ya da istediğin günlük bir alışkanlık için ana görev seçersin; her gün aralığında yaparsan zincirin uzar, Gwent kartları, oren ve tecrübe kazanır, kontrat aldığın canavara hasar verirsin. Kaçırırsan canavar sana vurur.

*A Witcher-themed, gamified habit tracker. English summary below.*

> **Resmi olmayan hayran projesi.** CD PROJEKT RED ile bağlantısı yoktur, ticari değildir ve hiçbir şekilde para kazanılmaz. The Witcher, Gwent ve ilgili isimler, kart görselleri ve metinler CD PROJEKT S.A.'ya aittir. Bu depoda kart verisi ya da görsel bulunmaz; kart verisi kurulumda gwent.one'dan indirilir.

## Özellikler

- **Ana görev:** uyku (yatış + kalkış aralığı) ya da günlük bir alışkanlık, 14–60 gün. Aralık içinde ceza yok; geç kalmak paslı halka, kaçırmak zincir kırılması.
- **Zincir:** kademeler (Demir → Göktaşı), haftada bir önceden ilan edilen dinlenme günü, kırılan zinciri geri getiren kefaret.
- **Av:** Kıta haritasında 15 bölge, 8 seviye kademesinde (White Orchard ve Kaer Morhen'den Toussaint'e), ~200 canavar. Her bölgenin haftada 5 ilanlık bir ilan panosu ve bir boss'u var. Kademe ancak boss'lardan biri ölünce geçilir. Son boss'tan sonra canavarlar elit olarak geri döner, TP Ün (★) kazandırır.
- **Gwent kartları:** günlük ödüller, fıçılar, ganimetler; odak fraksiyon ya da tüm fraksiyonlar; aynı fraksiyon ve türden 5 kartla kart bağı.
- **Demirci:** her gün değişen kılıç stoğu, +1..+5 güçlendirme, bane, okul seti şemaları.
- **Okul:** yeniden doğuşla karakterler kalıcı olarak Okul salonuna eklenir, miras bonusu verir.
- Başarımlar, haftalık özet, uyku grafikleri, sesler, kaçırılan günü 24 saat içinde sonradan işleme.
- **Telefondan erişim:** aynı Wi‑Fi'deki telefondan açılabilir (isteğe bağlı PIN).
- Tamamen yerel: veriler senin bilgisayarında, tek bir SQLite dosyasında.
- **Dil:** Türkçe ve İngilizce (Ayarlar → Dil; cihaz başına saklanır).

## Kurulum

Gereken tek şey **Python 3.9+** (ek paket yok).

1. Depoyu indir.
2. **Windows:** `Baslat.bat` dosyasına çift tıkla.
   **macOS / Linux:** `python3 server.py`
3. İlk açılışta kart verisi gwent.one'dan otomatik indirilir (`cards.js`). İndirme başarısız olursa elle çalıştır:
   ```
   py -3 tools/fetch_cards.py        (macOS/Linux: python3 tools/fetch_cards.py)
   ```
4. Tarayıcı `http://localhost:8642` adresinde açılır. Sunucu penceresi açık kaldığı sürece uygulama çalışır.

- **Test modu:** `Test.bat` (ya da `python3 server.py --open "?slot=test"`) ayrı bir test kaydı açar; zamanı ileri sarıp her şeyi gerçek kaydına dokunmadan deneyebilirsin.
- **Otomatik testler:** `http://localhost:8642/tests.html`
- **Veriler:** `kaermorhen.db`; günlük yedekler `backups/` klasöründe. Bu dosyalar `.gitignore` ile depodan hariç tutulur.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `server.py` | Python stdlib sunucusu: statik dosyalar + JSON API, SQLite, yedekler, telefondan erişim |
| `engine.js` | Oyun kuralları (DOM yok, saf) |
| `app.js`, `index.html`, `style.css` | Arayüz |
| `monsters.js`, `swords.js` | Bölgeler, canavarlar, kılıçlar (denge değerleri) |
| `tools/fetch_cards.py` | Kart verisini indirip `cards.js` üretir |
| `tests.js`, `tests.html` | Tarayıcıda çalışan testler ve denge simülasyonu |

---

## English

**Habits of Witchers** is a local, browser-based habit tracker themed around The Witcher, mixing Habitica-style RPG progression with a bit of game theory (commitment devices, streaks with atonement, variable rewards, a pity timer).

Pick a main quest: a sleep schedule (bedtime and wake-up windows) or any daily habit. Doing it inside its window grows your chain, grants Gwent cards, gold and XP, and damages the monster you took a contract on. Missing it lets the monster strike back. Travel through 15 regions on a map of the Continent (8 level tiers, ~200 monsters), pick contracts from each region's notice board, beat a tier's boss to level up, forge and upgrade swords, link cards, and retire characters into your School hall.

> **Unofficial fan project.** Not affiliated with or endorsed by CD PROJEKT RED. Non-commercial. The Witcher, Gwent and all related names, card art and texts are the property of CD PROJEKT S.A. No card data or images are included in this repository; card data is downloaded from gwent.one during setup.

**Languages:** English and Turkish. The app picks English unless your browser is set to Turkish; switch anytime in Settings → Language (saved per device).

### Running it

Requires **Python 3.9+** only (no packages).

```
python3 server.py            # Windows: double-click Baslat.bat
```

On first start the server downloads card data from gwent.one into `cards.js`. If that fails, run `python3 tools/fetch_cards.py`. Then open `http://localhost:8642`. Your data stays in `kaermorhen.db` on your machine.

### Credits

- Card data and art: [gwent.one](https://gwent.one) (loaded at runtime, not redistributed).
- Sword images: [The Witcher Wiki](https://witcher.fandom.com) (loaded at runtime).
- The Witcher and Gwent © CD PROJEKT S.A.

### License

The source code is MIT licensed (see `LICENSE`). The license does not apply to any CD PROJEKT RED material.
