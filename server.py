"""Habits of Witchers - yerel sunucu.

Sadece Python standart kütüphanesi kullanır (kurulum gerekmez).
  py server.py                 -> http://localhost:8642 açılır
  py server.py --no-browser    -> tarayıcı açmadan başlat
  py server.py --port 9000
  py server.py --open "?slot=test"   -> test kaydıyla aç (Test.bat bunu yapar)

Veriler bu klasördeki kaermorhen.db (SQLite) dosyasında durur.
Her gün ilk açılışta backups/ klasörüne bir yedek alınır (son 14 gün saklanır).

Telefondan erişim: uygulamada Ayarlar > Telefondan erişim > "Aç" ile ev ağındaki cihazlara açılır.
PIN isteğe bağlıdır. Kapalıyken diğer cihazlardan gelen istekler reddedilir (sunucu yine ağı dinler,
böylece aç/kapat için yeniden başlatmak gerekmez).
Ayar dosyası: kaermorhen-ayar.json (PIN varsa özeti saklanır, kendisi değil).
"""
import datetime
import hmac
import secrets
import time
from http.cookies import SimpleCookie
from contextlib import closing, contextmanager
import hashlib
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(ROOT, "backups")
DB_LOCK = threading.RLock()
CONFIG_PATH = os.path.join(ROOT, "kaermorhen-ayar.json")
DEV = "--dev" in sys.argv          # test için: X-KM-Remote başlığı uzak cihaz gibi davranır
LISTENING = {"lan": False, "port": 8642}
LOGIN_FAILS = {}                   # ip -> (deneme sayısı, kilit bitişi)


class Conflict(Exception):
    def __init__(self, rev):
        super().__init__("conflict")
        self.rev = rev


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)


def pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 120_000).hex()


def auth_token(cfg):
    return hmac.new(bytes.fromhex(cfg["secret"]), cfg["pin_hash"].encode(), "sha256").hexdigest()


def lan_ips():
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as u:
            u.connect(("8.8.8.8", 80))     # paket gönderilmez, sadece hangi arayüzün kullanılacağını öğrenir
            ips.add(u.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mornings(
  date TEXT PRIMARY KEY,         -- uyanılan sabahın tarihi (YYYY-MM-DD)
  result TEXT,                   -- success | late | fail | rest
  stake INTEGER,                 -- yatırılan oren
  med_at TEXT,                   -- meditasyon zamanı (ISO)
  med_on_time INTEGER,
  wake_at TEXT,                  -- kalkış zamanı (ISO)
  rest INTEGER,                  -- önceden ilan edilmiş dinlenme günü
  quest TEXT,                    -- o günün ana görevi (id)
  data TEXT NOT NULL             -- kaydın tamamı (JSON)
);
CREATE TABLE IF NOT EXISTS log(id TEXT PRIMARY KEY, t TEXT NOT NULL, text TEXT NOT NULL, type TEXT);
CREATE INDEX IF NOT EXISTS log_t ON log(t);
CREATE TABLE IF NOT EXISTS collection(art INTEGER PRIMARY KEY, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trophies(n INTEGER PRIMARY KEY, monster TEXT NOT NULL, week TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS quest_log(date TEXT NOT NULL, quest_id TEXT NOT NULL, PRIMARY KEY(date, quest_id));
CREATE TABLE IF NOT EXISTS habit_days(
  habit TEXT NOT NULL,           -- alışkanlık kimliği
  date TEXT NOT NULL,            -- görevin günü (YYYY-MM-DD)
  result TEXT,                   -- success | late | fail | rest
  data TEXT NOT NULL,            -- günün kaydı (JSON)
  PRIMARY KEY(habit, date)
);
"""


def db_path(slot):
    slot = re.sub(r"[^a-z0-9_-]", "", (slot or "main").lower())[:20] or "main"
    return os.path.join(ROOT, "kaermorhen.db" if slot == "main" else f"kaermorhen-{slot}.db")


def connect(slot):
    conn = sqlite3.connect(db_path(slot))
    conn.executescript(SCHEMA)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(mornings)")}
    if "quest" not in cols:  # eski veritabanı
        conn.execute("ALTER TABLE mornings ADD COLUMN quest TEXT")
    if "data" not in {r[1] for r in conn.execute("PRAGMA table_info(trophies)")}:
        conn.execute("ALTER TABLE trophies ADD COLUMN data TEXT")
    return conn


@contextmanager
def db(slot):
    """Bağlantıyı açar, işlem bitince commit eder ve kapatır (Windows'ta dosya kilitli kalmasın)."""
    conn = connect(slot)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def get_rev(slot):
    if not os.path.exists(db_path(slot)):
        return 0
    with DB_LOCK, db(slot) as conn:
        row = conn.execute("SELECT value FROM meta WHERE key='rev'").fetchone()
        return int(row[0]) if row else 0


def load_state(slot):
    if not os.path.exists(db_path(slot)):
        return None
    with DB_LOCK, db(slot) as conn:
        row = conn.execute("SELECT value FROM meta WHERE key='state'").fetchone()
        if not row:
            return None
        st = json.loads(row[0])
        if isinstance(st.get("habits"), list):
            # v11+: günler alışkanlık başına ayrı tabloda
            by = {}
            for h, d, data in conn.execute("SELECT habit, date, data FROM habit_days"):
                by.setdefault(h, {})[d] = json.loads(data)
            for h in st["habits"]:
                h["entries"] = by.get(h.get("id"), {})
        else:
            st["days"] = {d: json.loads(data) for d, data in conn.execute("SELECT date, data FROM mornings")}
        st["log"] = [
            {"id": i, "t": t, "text": text, "type": typ or ""}
            for i, t, text, typ in conn.execute("SELECT id, t, text, type FROM log ORDER BY t DESC, rowid ASC LIMIT 300")
        ]
        st["collection"] = {str(a): c for a, c in conn.execute("SELECT art, count FROM collection")}
        st["trophies"] = [json.loads(d) if d else {"id": m, "at": w} for m, w, d in conn.execute("SELECT monster, week, data FROM trophies ORDER BY n")]
        ql = {}
        for d, q in conn.execute("SELECT date, quest_id FROM quest_log ORDER BY rowid"):
            ql.setdefault(d, []).append(q)
        st["questLog"] = ql
        return st


def save_state(slot, st, expected_rev=None):
    """Kaydı yazar ve yeni sürüm numarasını döndürür. expected_rev verilmişse ve sunucudaki sürüm farklıysa
    (başka bir cihaz arada kaydetmişse) Conflict fırlatır: eski veri yenisinin üzerine yazılmaz."""
    with DB_LOCK:
        cur = get_rev(slot)
        if expected_rev is not None and expected_rev != cur:
            raise Conflict(cur)
        _write_state(slot, st)
        with db(slot) as conn:
            conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('rev', ?)", (str(cur + 1),))
        return cur + 1


def _write_state(slot, st):
    st = dict(st)
    days = st.pop("days", {}) or {}
    hdays = []
    if isinstance(st.get("habits"), list):
        st["habits"] = [dict(h) for h in st["habits"]]
        for h in st["habits"]:
            for d, v in (h.pop("entries", None) or {}).items():
                hdays.append((h.get("id"), d, v.get("result"), json.dumps(v, ensure_ascii=False)))
    log = st.pop("log", []) or []
    collection = st.pop("collection", {}) or {}
    trophies = st.pop("trophies", []) or []
    quest_log = st.pop("questLog", {}) or {}
    with DB_LOCK, db(slot) as conn:
        conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('state', ?)", (json.dumps(st, ensure_ascii=False),))
        conn.execute("DELETE FROM habit_days")
        conn.executemany("INSERT INTO habit_days(habit, date, result, data) VALUES(?,?,?,?)", hdays)
        conn.execute("DELETE FROM mornings")
        conn.executemany(
            "INSERT INTO mornings(date, result, stake, med_at, med_on_time, wake_at, rest, quest, data) VALUES(?,?,?,?,?,?,?,?,?)",
            [
                (d, v.get("result"), v.get("stake"), v.get("med"), int(bool(v.get("medOnTime"))),
                 v.get("check") or v.get("wake"), int(bool(v.get("rest"))), v.get("q"), json.dumps(v, ensure_ascii=False))
                for d, v in days.items()
            ],
        )
        # Günlük silinmez, sadece eklenir: tüm geçmiş veritabanında kalır.
        conn.executemany(
            "INSERT OR IGNORE INTO log(id, t, text, type) VALUES(?,?,?,?)",
            [
                (l.get("id") or hashlib.sha1((l["t"] + l["text"]).encode()).hexdigest()[:12], l["t"], l["text"], l.get("type", ""))
                for l in log
            ],
        )
        conn.execute("DELETE FROM collection")
        conn.executemany("INSERT INTO collection(art, count) VALUES(?,?)", [(int(a), int(c)) for a, c in collection.items()])
        conn.execute("DELETE FROM trophies")
        # "week" sütunu tarihtir (v5'ten itibaren öldürüldüğü gün)
        conn.executemany("INSERT INTO trophies(monster, week, data) VALUES(?,?,?)",
                         [(t["id"], t.get("at") or t.get("week") or "", json.dumps(t, ensure_ascii=False)) for t in trophies])
        conn.execute("DELETE FROM quest_log")
        conn.executemany(
            "INSERT OR IGNORE INTO quest_log(date, quest_id) VALUES(?,?)",
            [(d, q) for d, qs in quest_log.items() for q in qs],
        )


def daily_backup():
    src = db_path("main")
    if not os.path.exists(src):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    target = os.path.join(BACKUP_DIR, f"kaermorhen-{datetime.date.today().isoformat()}.db")
    if not os.path.exists(target):
        with closing(sqlite3.connect(src)) as s, closing(sqlite3.connect(target)) as t:
            s.backup(t)
    backups = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".db"))
    for old in backups[:-14]:
        os.remove(os.path.join(BACKUP_DIR, old))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if args and "/api/" in str(args[0]):
            return  # API isteklerini konsola basma
        super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _slot(self):
        return parse_qs(urlparse(self.path).query).get("slot", ["main"])[0]

    def _query(self, key):
        v = parse_qs(urlparse(self.path).query).get(key, [None])[0]
        return v if v not in ("", None) else None

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8") or "{}")

    def _is_local(self):
        if DEV and self.headers.get("X-KM-Remote") == "1":
            return False
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def _authed(self):
        if self._is_local():
            return True
        cfg = load_config()
        if not cfg.get("lan"):
            return False
        if not cfg.get("pin_hash"):
            return True          # PIN'siz mod: ev ağındaki cihazlar doğrudan girer
        c = SimpleCookie(self.headers.get("Cookie") or "")
        tok = c.get("km_auth")
        return bool(tok) and hmac.compare_digest(tok.value, auth_token(cfg))

    def _guard(self):
        """API'yi korur: bu bilgisayar serbest, diğer cihazlar PIN ile girmiş olmalı."""
        if self._authed():
            return True
        if not load_config().get("lan"):
            self._json(403, {"error": "Telefondan erişim kapalı. Bilgisayarda Ayarlar > Telefondan erişim'den aç."})
        else:
            self._json(401, {"error": "PIN gerekli"})
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/access":
            cfg = load_config()
            return self._json(200, {"local": self._is_local(), "lan": bool(cfg.get("lan")), "pin": bool(cfg.get("pin_hash")), "listening": LISTENING["lan"],
                                    "urls": [f"http://{ip}:{LISTENING['port']}/" for ip in lan_ips()] if self._is_local() else []})
        if path.startswith("/api/") and not self._guard():
            return
        if path == "/api/state":
            slot = self._slot()
            return self._json(200, {"state": load_state(slot), "rev": get_rev(slot)})
        if path == "/api/rev":
            return self._json(200, {"rev": get_rev(self._slot())})
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if path.endswith((".db", ".py", ".bat")) or "/backups" in path:
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != "/api/state":
            return self._json(404, {"error": "not found"})
        if not self._guard():
            return
        slot = self._slot()
        try:
            st = self._body()
            if not isinstance(st, dict) or "settings" not in st:
                raise ValueError("geçersiz kayıt")
            exp = self._query("rev")
            rev = save_state(slot, st, int(exp) if exp is not None else None)
            return self._json(200, {"ok": True, "rev": rev})
        except Conflict as c:
            return self._json(409, {"error": "conflict", "rev": c.rev, "state": load_state(slot)})
        except Exception as e:  # noqa: BLE001
            return self._json(400, {"error": str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            ip, nowt = self.client_address[0], time.time()
            fails, until = LOGIN_FAILS.get(ip, (0, 0))
            if until > nowt:
                return self._json(429, {"error": f"Çok fazla yanlış deneme. {int(until - nowt)} sn sonra tekrar dene."})
            cfg = load_config()
            pin = str(self._body().get("pin", ""))
            if cfg.get("pin_hash") and hmac.compare_digest(pin_hash(pin, cfg["salt"]), cfg["pin_hash"]):
                LOGIN_FAILS.pop(ip, None)
                self.send_response(200)
                self.send_header("Set-Cookie", f"km_auth={auth_token(cfg)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok": true}')
                return
            fails += 1
            LOGIN_FAILS[ip] = (fails, nowt + 60 if fails >= 5 else 0)
            return self._json(401, {"error": "PIN yanlış." + (" 1 dakika beklemen gerekiyor." if fails >= 5 else "")})
        if path == "/api/lan":
            if not self._is_local():
                return self._json(403, {"error": "Bu ayar sadece bu bilgisayardan değiştirilebilir."})
            cfg = load_config()
            cfg["lan"] = bool(self._body().get("on"))
            cfg.setdefault("secret", secrets.token_hex(32))
            save_config(cfg)
            return self._json(200, {"ok": True, "lan": cfg["lan"], "restart": not LISTENING["lan"]})
        if path == "/api/pin":
            if not self._is_local():
                return self._json(403, {"error": "PIN sadece bu bilgisayardan değiştirilebilir."})
            pin = str(self._body().get("pin", ""))
            cfg = load_config()
            if not pin:
                cfg.pop("pin_hash", None); cfg.pop("salt", None)
                save_config(cfg)
                return self._json(200, {"ok": True, "restart": LISTENING["lan"]})
            if not (pin.isdigit() and 4 <= len(pin) <= 8):
                return self._json(400, {"error": "PIN 4–8 rakam olmalı."})
            cfg["salt"] = secrets.token_hex(16)
            cfg["pin_hash"] = pin_hash(pin, cfg["salt"])
            cfg["secret"] = secrets.token_hex(32)       # PIN değişince eski oturumlar düşer
            cfg["lan"] = True
            save_config(cfg)
            return self._json(200, {"ok": True, "restart": not LISTENING["lan"]})
        return self.do_PUT()   # sendBeacon ve taşıma: /api/state

    def do_DELETE(self):
        # Sadece test kayıtları silinebilir; gerçek kayıt (main) asla.
        if not self._guard():
            return
        slot = self._slot()
        if urlparse(self.path).path != "/api/state" or db_path(slot) == db_path("main"):
            return self._json(403, {"error": "gerçek kayıt silinemez"})
        with DB_LOCK:
            if os.path.exists(db_path(slot)):
                os.remove(db_path(slot))
        return self._json(200, {"ok": True})


def port_in_use(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def ensure_cards():
    """Kart verisi (cards.js) depoda dağıtılmaz; yoksa ilk açılışta gwent.one'dan indirilir."""
    if os.path.exists(os.path.join(ROOT, "cards.js")):
        return
    print("Kart verisi bulunamadı, gwent.one'dan indiriliyor (bir kez)...")
    try:
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import fetch_cards
        fetch_cards.main_from(None)
    except Exception as e:  # noqa: BLE001
        print("Kart verisi indirilemedi:", e)
        print("İnternet bağlantını kontrol edip şunu çalıştır: py -3 tools/fetch_cards.py")


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    port = 8642
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    path = sys.argv[sys.argv.index("--open") + 1] if "--open" in sys.argv else ""
    url = f"http://localhost:{port}/{path}"
    open_browser = "--no-browser" not in sys.argv
    if port_in_use(port):
        print(f"Sunucu zaten çalışıyor: {url}")
        if open_browser:
            webbrowser.open(url)
        return
    ensure_cards()
    daily_backup()
    # her zaman ağı dinler; diğer cihazlar ancak Ayarlar'dan "Telefondan erişim" açıksa girebilir
    LISTENING.update(lan=True, port=port)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    cfg = load_config()
    print("Habits of Witchers çalışıyor:", url)
    if cfg.get("lan"):
        print("Telefondan erişim AÇIK" + (" (PIN ile)" if cfg.get("pin_hash") else "") + ". Aynı Wi-Fi'deki telefondan:")
        for ip in lan_ips():
            print(f"   http://{ip}:{port}/")
    else:
        print("Telefondan erişim kapalı (Ayarlar > Telefondan erişim).")
    print("Bu pencereyi kapatırsan uygulama durur. Veriler: kaermorhen.db")
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
