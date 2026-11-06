"""Görsel önbelleği: kart, canavar ve kılıç görselleri bir kez indirilip hofw-gorsel.db içinde saklanır.

Sunucu /img?u=<adres> isteğini önce bu veritabanından karşılar; yoksa görseli bir kez indirir, kaydeder ve verir.
Sadece izin verilen sitelerden (gwent.one, Witcher wiki) görsel alınır. Kayıt dosyası (hofw.db) şişmesin ve
yedeklere girmesin diye görseller ayrı bir dosyada durur. Hepsini önceden indirmek için: py -3 tools/cache_images.py

Image cache: card, monster and sword images are downloaded once and kept in hofw-gorsel.db.
"""
import os
import sqlite3
import threading
import time
import urllib.request
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "hofw-gorsel.db")
_OLD = os.path.join(ROOT, "kaermorhen-gorsel.db")       # eski ad: ilk kullanımda yeni ada taşınır
if not os.path.exists(DB_PATH) and os.path.exists(_OLD):
    try:
        os.replace(_OLD, DB_PATH)
    except OSError:
        DB_PATH = _OLD
ALLOWED_HOSTS = {"gwent.one", "static.wikia.nocookie.net", "witcherdb.com"}
MAX_BYTES = 3 * 1024 * 1024
_lock = threading.Lock()


def allowed(url):
    try:
        u = urlparse(url)
    except ValueError:
        return False
    return u.scheme == "https" and u.hostname in ALLOWED_HOSTS


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute("CREATE TABLE IF NOT EXISTS img(url TEXT PRIMARY KEY, ctype TEXT NOT NULL, data BLOB NOT NULL, fetched REAL NOT NULL)")
    return conn


def lookup(url):
    with _lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT ctype, data FROM img WHERE url = ?", (url,)).fetchone()
        finally:
            conn.close()
    return row


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "HabitsOfWitchers-image-cache/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
        if not ctype.startswith("image/"):
            raise ValueError("not an image: " + ctype)
        data = r.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("too large")
    return ctype, data


def store(url, ctype, data):
    with _lock:
        conn = _connect()
        try:
            conn.execute("INSERT OR REPLACE INTO img(url, ctype, data, fetched) VALUES (?, ?, ?, ?)", (url, ctype, data, time.time()))
            conn.commit()
        finally:
            conn.close()


def get(url):
    """(ctype, data) döndürür; önbellekte yoksa indirip kaydeder. İzin verilmeyen adreste ValueError."""
    if not allowed(url):
        raise ValueError("host not allowed")
    row = lookup(url)
    if row:
        return row[0], row[1]
    ctype, data = fetch(url)
    store(url, ctype, data)
    return ctype, data


def count():
    with _lock:
        conn = _connect()
        try:
            return conn.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(data)), 0) FROM img").fetchone()
        finally:
            conn.close()
