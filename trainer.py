"""Local spaced repetition trainer: SQLite API and static web server."""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sqlite3
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
MAX_BODY = 10 * 1024 * 1024
RATINGS = {"Again": 1, "Hard": 3, "Good": 4, "Easy": 5}


def clock(value: str | None = None) -> datetime:
    return datetime.fromisoformat(value) if value else datetime.now().replace(microsecond=0)


def connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY, deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      front TEXT NOT NULL, back TEXT NOT NULL, interval_days INTEGER NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 2.5, repetitions INTEGER NOT NULL DEFAULT 0,
      due_at TEXT NOT NULL, last_review_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_tags (
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(card_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      reviewed_at TEXT NOT NULL, rating TEXT NOT NULL, seconds INTEGER
    );
    CREATE INDEX IF NOT EXISTS cards_due ON cards(due_at);
    CREATE INDEX IF NOT EXISTS reviews_time ON reviews(reviewed_at);
    """)
    return db


def rows(db, sql, args=()):
    return [dict(row) for row in db.execute(sql, args)]


def one(db, sql, args=()):
    row = db.execute(sql, args).fetchone()
    return dict(row) if row else None


def need_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " is required.")
    return value.strip()


def require(db, table, item_id):
    item = one(db, "SELECT * FROM " + table + " WHERE id=?", (item_id,))
    if item is None:
        raise LookupError(table[:-1].capitalize() + " not found.")
    return item


def ids(value):
    if not isinstance(value, list) or any(type(x) is not int for x in value):
        raise ValueError("tag_ids must be a list of tag IDs.")
    return sorted(set(value))


def set_tags(db, card_id, tag_ids):
    selected = ids(tag_ids)
    for tag_id in selected:
        require(db, "tags", tag_id)
    db.execute("DELETE FROM card_tags WHERE card_id=?", (card_id,))
    db.executemany("INSERT INTO card_tags(card_id, tag_id) VALUES (?,?)",
                   [(card_id, tag_id) for tag_id in selected])


def cards(db, where="", args=()):
    data = rows(db, """SELECT c.*, d.name AS deck_name,
      COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.card_id=c.id),0) AS review_count
      FROM cards c JOIN decks d ON d.id=c.deck_id """ + where + " ORDER BY c.id", args)
    for card in data:
        card["tags"] = rows(db, """SELECT t.id,t.name FROM tags t
          JOIN card_tags ct ON ct.tag_id=t.id WHERE ct.card_id=? ORDER BY t.name""", (card["id"],))
    return data


def schedule(card, rating, now):
    """SM-2 core with explicit Easy graduation and short Again relearning."""
    if rating not in RATINGS:
        raise ValueError("Rating must be Again, Hard, Good, or Easy.")
    if rating == "Again":
        return 0, card["ease"], 0, (now + timedelta(minutes=10)).isoformat(timespec="seconds")
    q = RATINGS[rating]
    ease = max(1.3, round(card["ease"] + 0.1 - (5-q) * (0.08 + (5-q) * 0.02), 4))
    reps = card["repetitions"] + 1
    if reps == 1:
        interval = 4 if rating == "Easy" else 1
    elif reps == 2:
        interval = 10 if rating == "Easy" else (3 if rating == "Hard" else 6)
    else:
        multiplier = ease * (1.3 if rating == "Easy" else 0.8 if rating == "Hard" else 1)
        interval = max(card["interval_days"] + 1, math.ceil(card["interval_days"] * multiplier))
    return interval, ease, reps, (now + timedelta(days=interval)).date().isoformat() + "T00:00:00"


def session(db, now, deck_id=None, tag_id=None, new_limit=10):
    filters, args = ["c.due_at<=?"], [now.isoformat(timespec="seconds")]
    if deck_id is not None:
        require(db, "decks", deck_id)
        filters.append("c.deck_id=?")
        args.append(deck_id)
    if tag_id is not None:
        require(db, "tags", tag_id)
        filters.append("EXISTS (SELECT 1 FROM card_tags ct WHERE ct.card_id=c.id AND ct.tag_id=?)")
        args.append(tag_id)
    all_due = cards(db, "WHERE " + " AND ".join(filters), args)
    returning = [c for c in all_due if c["review_count"]]
    introduced_today = one(db, """SELECT COUNT(*) AS n FROM
      (SELECT card_id, MIN(reviewed_at) AS first_at FROM reviews GROUP BY card_id)
      WHERE substr(first_at,1,10)=?""", (now.date().isoformat(),))["n"]
    fresh = [c for c in all_due if not c["review_count"]][:max(0, new_limit-introduced_today)]
    queue = returning + fresh
    for card in queue:
        card["review_options"] = {rating: schedule(card, rating, now)[3] for rating in RATINGS}
    return {"cards": queue, "review_due": len(returning), "new": len(fresh),
            "new_limit": new_limit, "introduced_today": introduced_today}


def stats(db, now):
    today = now.date().isoformat()
    total = one(db, "SELECT COUNT(*) AS n FROM cards")["n"]
    reviewed = one(db, "SELECT COUNT(DISTINCT card_id) AS n FROM reviews WHERE substr(reviewed_at,1,10)=?", (today,))["n"]
    due = rows(db, """SELECT substr(due_at,1,10) AS day,COUNT(*) AS count FROM cards
       WHERE due_at>=? AND due_at<? GROUP BY substr(due_at,1,10) ORDER BY day""",
       (today + "T00:00:00", (now.date()+timedelta(days=8)).isoformat() + "T00:00:00"))
    days = {r["day"] for r in rows(db, "SELECT DISTINCT substr(reviewed_at,1,10) AS day FROM reviews")}
    cursor = now.date() if today in days else now.date()-timedelta(days=1)
    streak = 0
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    learned = one(db, "SELECT COUNT(*) AS n FROM cards WHERE interval_days>=21")["n"]
    per_deck = rows(db, """SELECT d.id,d.name,
      COALESCE(c.cards,0) AS cards,COALESCE(c.learned,0) AS learned,
      COALESCE(r.reviews,0) AS reviews,COALESCE(r.remembered,0) AS remembered
      FROM decks d
      LEFT JOIN (SELECT deck_id,COUNT(*) AS cards,
        SUM(CASE WHEN interval_days>=21 THEN 1 ELSE 0 END) AS learned
        FROM cards GROUP BY deck_id) c ON c.deck_id=d.id
      LEFT JOIN (SELECT deck_id,COUNT(*) AS reviews,
        SUM(CASE WHEN rating IN ('Hard','Good','Easy') THEN 1 ELSE 0 END) AS remembered
        FROM reviews GROUP BY deck_id) r ON r.deck_id=d.id
      ORDER BY d.name""")
    for deck in per_deck:
        deck["retention"] = round(100 * (deck["remembered"] or 0) / deck["reviews"], 1) if deck["reviews"] else None
        deck.pop("remembered")
    return {"total_cards": total, "reviewed_today": reviewed, "due_next_7_days": due,
            "streak": streak, "learned": learned, "decks": per_deck}


def snapshot(db, deck_id=None):
    if deck_id is not None:
        require(db, "decks", deck_id)
    selected = cards(db, "WHERE c.deck_id=?" if deck_id is not None else "", (deck_id,) if deck_id is not None else ())
    card_ids = {c["id"] for c in selected}
    decks = rows(db, "SELECT * FROM decks WHERE id=?" if deck_id is not None else "SELECT * FROM decks ORDER BY id",
                 (deck_id,) if deck_id is not None else ())
    tag_ids = {t["id"] for c in selected for t in c["tags"]}
    tags = [t for t in rows(db, "SELECT * FROM tags ORDER BY id") if deck_id is None or t["id"] in tag_ids]
    reviews = [r for r in rows(db, "SELECT * FROM reviews ORDER BY id") if r["card_id"] in card_ids]
    return {"format": "spaced-trainer-v1", "decks": decks, "tags": tags,
            "cards": selected, "reviews": reviews}


def import_snapshot(db, data):
    if not isinstance(data, dict) or data.get("format") != "spaced-trainer-v1":
        raise ValueError("This is not a Spaced Trainer backup.")
    for key in ("decks", "tags", "cards", "reviews"):
        if not isinstance(data.get(key), list):
            raise ValueError("Backup is missing " + key + ".")
    with db:
        db.execute("DELETE FROM decks")
        db.execute("DELETE FROM tags")
        for deck in data["decks"]:
            db.execute("INSERT INTO decks(id,name,description) VALUES (?,?,?)",
                       (deck["id"], need_text(deck["name"], "Deck name"), deck.get("description", "")))
        for tag in data["tags"]:
            db.execute("INSERT INTO tags(id,name) VALUES (?,?)", (tag["id"], need_text(tag["name"], "Tag name")))
        for card in data["cards"]:
            db.execute("""INSERT INTO cards(id,deck_id,front,back,interval_days,ease,repetitions,due_at,last_review_at,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)""",
              (card["id"], card["deck_id"], need_text(card["front"], "Front"), need_text(card["back"], "Back"),
               card["interval_days"], card["ease"], card["repetitions"], card["due_at"],
               card["last_review_at"], card["created_at"]))
            set_tags(db, card["id"], [t["id"] for t in card["tags"]])
        for review in data["reviews"]:
            db.execute("INSERT INTO reviews(id,card_id,deck_id,reviewed_at,rating,seconds) VALUES (?,?,?,?,?,?)",
                       (review["id"], review["card_id"], review["deck_id"], review["reviewed_at"],
                        review["rating"], review["seconds"]))
    return {"decks": len(data["decks"]), "cards": len(data["cards"]), "reviews": len(data["reviews"])}


def import_csv(db, content, now):
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames or not {"front", "back"}.issubset({x.strip().lower() for x in reader.fieldnames}):
        raise ValueError("CSV needs front and back columns.")
    count = 0
    with db:
        for raw in reader:
            row = {k.strip().lower(): (v or "").strip() for k, v in raw.items() if k}
            front, back = need_text(row.get("front"), "Front"), need_text(row.get("back"), "Back")
            deck_name = row.get("deck") or row.get("deck name") or "Imported"
            db.execute("INSERT OR IGNORE INTO decks(name) VALUES (?)", (deck_name,))
            deck_id = one(db, "SELECT id FROM decks WHERE name=? COLLATE NOCASE", (deck_name,))["id"]
            cur = db.execute("INSERT INTO cards(deck_id,front,back,due_at,created_at) VALUES (?,?,?,?,?)",
                             (deck_id, front, back, now.isoformat(timespec="seconds"), now.isoformat(timespec="seconds")))
            tag_ids = []
            for name in [s.strip() for s in row.get("tags", "").split(",") if s.strip()]:
                db.execute("INSERT OR IGNORE INTO tags(name) VALUES (?)", (name,))
                tag_ids.append(one(db, "SELECT id FROM tags WHERE name=? COLLATE NOCASE", (name,))["id"])
            set_tags(db, cur.lastrowid, tag_ids)
            count += 1
    return {"cards": count}


class App(BaseHTTPRequestHandler):
    db_path: Path = ROOT / "trainer.sqlite3"
    fixed_now: str | None = None

    def log_message(self, fmt, *args):
        pass

    def respond(self, status, data, content_type="application/json", filename=None):
        body = data if isinstance(data, bytes) else data.encode() if isinstance(data, str) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith(("text/", "application/json")) else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="' + filename + '"')
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length < 1 or length > MAX_BODY:
            raise ValueError("Request body must be between 1 byte and 10 MB.")
        return self.rfile.read(length)

    def execute(self, method):
        now = clock(self.fixed_now)
        url = urlparse(self.path)
        parts = [p for p in url.path.split("/") if p]
        query = parse_qs(url.query)
        if not parts or parts[0] != "api":
            if method != "GET":
                self.respond(405, {"error": "Method not allowed."})
                return
            file = (ROOT / ("index.html" if url.path == "/" else url.path.lstrip("/"))).resolve()
            allowed = {ROOT / "index.html", ROOT / "app.js", ROOT / "style.css",
                       ROOT / "assets" / "plus-jakarta-sans-latin.woff2"}
            if file not in allowed or not file.is_file():
                self.respond(404, {"error": "Not found."})
                return
            mime = {"html": "text/html", "js": "text/javascript", "css": "text/css",
                    "woff2": "font/woff2"}[file.suffix[1:]]
            self.respond(200, file.read_bytes(), mime)
            return
        try:
            with connect(self.db_path) as db:
                result = self.route(db, method, parts[1:], query, now)
            if isinstance(result, tuple):
                self.respond(*result)
            else:
                self.respond(200, result)
        except (ValueError, KeyError, TypeError, sqlite3.IntegrityError) as exc:
            self.respond(400, {"error": str(exc)})
        except LookupError as exc:
            self.respond(404, {"error": str(exc)})

    def route(self, db, method, parts, query, now):
        endpoint = parts[0] if parts else ""
        item_id = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        payload = {}
        if method in {"POST", "PATCH", "DELETE"} and endpoint not in {"import-csv", "import-json"}:
            payload = json.loads(self.read_body()) if method != "DELETE" or self.headers.get("Content-Length") else {}
        if method == "GET" and endpoint == "state":
            return {"today": now.date().isoformat(), "now": now.isoformat(timespec="seconds"),
                    "decks": rows(db, "SELECT * FROM decks ORDER BY name"),
                    "tags": rows(db, "SELECT * FROM tags ORDER BY name"),
                    "cards": cards(db)}
        if method == "GET" and endpoint == "session":
            return session(db, now, int(query["deck"][0]) if "deck" in query else None,
                           int(query["tag"][0]) if "tag" in query else None)
        if method == "GET" and endpoint == "stats":
            return stats(db, now)
        if method == "POST" and endpoint == "decks" and item_id is None:
            cur = db.execute("INSERT INTO decks(name,description) VALUES (?,?)",
                             (need_text(payload.get("name"), "Deck name"), payload.get("description", "")))
            return {"id": cur.lastrowid}
        if endpoint == "decks" and item_id is not None:
            require(db, "decks", item_id)
            if method == "PATCH":
                db.execute("UPDATE decks SET name=?,description=? WHERE id=?",
                           (need_text(payload.get("name"), "Deck name"), payload.get("description", ""), item_id))
                return {"ok": True}
            if method == "DELETE":
                count = one(db, "SELECT COUNT(*) AS n FROM cards WHERE deck_id=?", (item_id,))["n"]
                db.execute("DELETE FROM decks WHERE id=?", (item_id,))
                return {"deleted_cards": count}
        if method == "POST" and endpoint == "tags" and item_id is None:
            cur = db.execute("INSERT INTO tags(name) VALUES (?)", (need_text(payload.get("name"), "Tag name"),))
            return {"id": cur.lastrowid}
        if endpoint == "tags" and item_id is not None:
            require(db, "tags", item_id)
            if method == "PATCH":
                db.execute("UPDATE tags SET name=? WHERE id=?", (need_text(payload.get("name"), "Tag name"), item_id))
                return {"ok": True}
            if method == "DELETE":
                db.execute("DELETE FROM tags WHERE id=?", (item_id,))
                return {"ok": True}
        if method == "POST" and endpoint == "cards" and item_id is None:
            require(db, "decks", payload.get("deck_id"))
            cur = db.execute("INSERT INTO cards(deck_id,front,back,due_at,created_at) VALUES (?,?,?,?,?)",
                             (payload["deck_id"], need_text(payload.get("front"), "Front"),
                              need_text(payload.get("back"), "Back"), now.isoformat(timespec="seconds"),
                              now.isoformat(timespec="seconds")))
            set_tags(db, cur.lastrowid, payload.get("tag_ids", []))
            return {"id": cur.lastrowid}
        if endpoint == "cards" and item_id is not None:
            require(db, "cards", item_id)
            if method == "PATCH":
                require(db, "decks", payload.get("deck_id"))
                db.execute("UPDATE cards SET deck_id=?,front=?,back=? WHERE id=?",
                           (payload["deck_id"], need_text(payload.get("front"), "Front"),
                            need_text(payload.get("back"), "Back"), item_id))
                set_tags(db, item_id, payload.get("tag_ids", []))
                return {"ok": True}
            if method == "DELETE":
                db.execute("DELETE FROM cards WHERE id=?", (item_id,))
                return {"ok": True}
        if method == "POST" and endpoint == "review":
            card = require(db, "cards", payload.get("card_id"))
            rating = payload.get("rating")
            interval, ease, reps, due = schedule(card, rating, now)
            seconds = payload.get("seconds")
            if seconds is not None and (type(seconds) is not int or seconds < 0):
                raise ValueError("seconds must be a nonnegative integer.")
            db.execute("UPDATE cards SET interval_days=?,ease=?,repetitions=?,due_at=?,last_review_at=? WHERE id=?",
                       (interval, ease, reps, due, now.isoformat(timespec="seconds"), card["id"]))
            db.execute("INSERT INTO reviews(card_id,deck_id,reviewed_at,rating,seconds) VALUES (?,?,?,?,?)",
                       (card["id"], card["deck_id"], now.isoformat(timespec="seconds"), rating, seconds))
            return {"due_at": due, "interval_days": interval, "ease": ease, "repetitions": reps}
        if method == "GET" and endpoint == "export-json":
            data = snapshot(db, int(query["deck"][0]) if "deck" in query else None)
            return (200, json.dumps(data, indent=2), "application/json", "spaced-trainer-backup.json")
        if method == "GET" and endpoint == "export-csv":
            data = snapshot(db, int(query["deck"][0]) if "deck" in query else None)
            stream = io.StringIO()
            writer = csv.writer(stream)
            writer.writerow(["front", "back", "deck", "tags"])
            for card in data["cards"]:
                writer.writerow([card["front"], card["back"], card["deck_name"], ", ".join(t["name"] for t in card["tags"])])
            return (200, stream.getvalue(), "text/csv", "spaced-trainer-cards.csv")
        if method == "POST" and endpoint == "import-csv":
            return import_csv(db, self.read_body().decode("utf-8-sig"), now)
        if method == "POST" and endpoint == "import-json":
            return import_snapshot(db, json.loads(self.read_body()))
        raise LookupError("Endpoint not found.")

    def do_GET(self):
        self.execute("GET")

    def do_POST(self):
        self.execute("POST")

    def do_PATCH(self):
        self.execute("PATCH")

    def do_DELETE(self):
        self.execute("DELETE")


def main():
    parser = argparse.ArgumentParser(description="Local spaced repetition trainer")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", type=Path, default=ROOT / "trainer.sqlite3")
    parser.add_argument("--now", help="Override local clock: YYYY-MM-DD or ISO datetime")
    args = parser.parse_args()
    if args.now:
        clock(args.now)
    App.db_path = args.db
    App.fixed_now = args.now
    with connect(args.db):
        pass
    server = ThreadingHTTPServer(("127.0.0.1", args.port), App)
    print("Spaced Trainer at http://127.0.0.1:" + str(args.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
