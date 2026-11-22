import json
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from trainer import App, cards, connect, import_csv, import_snapshot, schedule, session, snapshot, stats

NOW = datetime.fromisoformat("2026-11-22T12:00:00")


class TrainerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "study.sqlite3"
        self.db = connect(self.path)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def seed(self):
        d = self.db.execute("INSERT INTO decks(name) VALUES ('Spanish')").lastrowid
        t = self.db.execute("INSERT INTO tags(name) VALUES ('verbs')").lastrowid
        c = self.db.execute("INSERT INTO cards(deck_id,front,back,due_at,created_at) VALUES (?,?,?,?,?)",
                            (d, "hablar", "to speak", NOW.isoformat(), NOW.isoformat())).lastrowid
        self.db.execute("INSERT INTO card_tags VALUES (?,?)", (c, t))
        self.db.commit()
        return d, t, c

    def test_schedule_and_growth(self):
        card = {"ease": 2.5, "repetitions": 0, "interval_days": 0}
        again = schedule(card, "Again", NOW)
        hard = schedule(card, "Hard", NOW)
        good = schedule(card, "Good", NOW)
        easy = schedule(card, "Easy", NOW)
        self.assertEqual(again[0], 0)
        self.assertEqual(again[3], (NOW + timedelta(minutes=10)).isoformat())
        self.assertEqual((hard[0], good[0], easy[0]), (1, 1, 4))
        self.assertLess(hard[1], good[1])
        self.assertGreater(easy[1], good[1])
        card.update(interval_days=good[0], ease=good[1], repetitions=good[2])
        second = schedule(card, "Good", NOW + timedelta(days=1))
        self.assertEqual(second[0], 6)
        card.update(interval_days=second[0], ease=second[1], repetitions=second[2])
        self.assertEqual(schedule(card, "Good", NOW + timedelta(days=7))[0], 15)
        self.assertEqual(schedule(card, "Again", NOW)[2], 0)

    def test_persistence_filters_and_deck_cascade(self):
        d, t, c = self.seed()
        other = self.db.execute("INSERT INTO decks(name) VALUES ('Other')").lastrowid
        self.db.execute("INSERT INTO cards(deck_id,front,back,due_at,created_at) VALUES (?,?,?,?,?)",
                        (other, "future", "answer", (NOW+timedelta(days=7)).isoformat(), NOW.isoformat()))
        self.db.commit()
        self.db.close()
        self.db = connect(self.path)
        self.assertEqual([x["id"] for x in session(self.db, NOW, tag_id=t)["cards"]], [c])
        preview = session(self.db, NOW, tag_id=t)["cards"][0]["review_options"]
        self.assertEqual(preview["Again"], (NOW+timedelta(minutes=10)).isoformat())
        self.assertEqual(preview["Easy"], (NOW+timedelta(days=4)).date().isoformat()+"T00:00:00")
        self.assertEqual(len(session(self.db, NOW)["cards"]), 1)
        self.db.execute("DELETE FROM decks WHERE id=?", (d,))
        self.db.commit()
        self.assertEqual(len(cards(self.db)), 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM card_tags").fetchone()[0], 0)

    def test_csv_and_snapshot_round_trip(self):
        import_csv(self.db, 'front,back,deck,tags\nbonjour,hello,French,"language, greeting"\n', NOW)
        original = snapshot(self.db)
        self.assertEqual(len(original["cards"]), 1)
        self.assertEqual(len(original["tags"]), 2)
        self.db.execute("INSERT INTO reviews(card_id,deck_id,reviewed_at,rating,seconds) VALUES (?,?,?,?,?)",
                        (original["cards"][0]["id"], original["decks"][0]["id"], NOW.isoformat(), "Good", 8))
        self.db.commit()
        original = snapshot(self.db)
        self.db.execute("DELETE FROM decks")
        self.db.commit()
        import_snapshot(self.db, original)
        self.assertEqual(snapshot(self.db), original)
        damaged = dict(original)
        damaged["cards"] = [dict(original["cards"][0], deck_id=999)]
        with self.assertRaises(sqlite3.IntegrityError):
            import_snapshot(self.db, damaged)
        self.assertEqual(snapshot(self.db), original)

    def test_new_card_limit_is_daily_not_per_session(self):
        d = self.db.execute("INSERT INTO decks(name) VALUES ('Daily')").lastrowid
        for i in range(12):
            self.db.execute("INSERT INTO cards(deck_id,front,back,due_at,created_at) VALUES (?,?,?,?,?)",
                            (d, "Q" + str(i), "A", NOW.isoformat(), NOW.isoformat()))
        self.db.commit()
        first = session(self.db, NOW)
        self.assertEqual(first["new"], 10)
        for card in first["cards"]:
            self.db.execute("INSERT INTO reviews(card_id,deck_id,reviewed_at,rating) VALUES (?,?,?,?)",
                            (card["id"], d, NOW.isoformat(), "Good"))
            self.db.execute("UPDATE cards SET due_at=? WHERE id=?",
                            ((NOW+timedelta(days=1)).isoformat(), card["id"]))
        self.db.commit()
        self.assertEqual(session(self.db, NOW)["new"], 0)
        self.assertEqual(session(self.db, NOW+timedelta(days=1))["new"], 2)

    def test_statistics_streak_retention_and_learned(self):
        d, t, c = self.seed()
        self.db.execute("UPDATE cards SET interval_days=21 WHERE id=?", (c,))
        for when, rating in [(NOW-timedelta(days=2), "Good"), (NOW-timedelta(days=1), "Again"),
                             (NOW, "Good"), (NOW, "Easy")]:
            self.db.execute("INSERT INTO reviews(card_id,deck_id,reviewed_at,rating) VALUES (?,?,?,?)",
                            (c, d, when.isoformat(), rating))
        self.db.commit()
        result = stats(self.db, NOW)
        self.assertEqual(result["streak"], 3)
        self.assertEqual(result["reviewed_today"], 1)
        self.assertEqual(result["learned"], 1)
        self.assertEqual(result["decks"][0]["retention"], 75.0)
        self.assertEqual(stats(self.db, NOW+timedelta(days=2))["streak"], 0)

    def test_http_create_review_export_restore(self):
        self.db.close()
        App.db_path = self.path
        App.fixed_now = NOW.isoformat()
        server = ThreadingHTTPServer(("127.0.0.1", 0), App)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = "http://127.0.0.1:" + str(server.server_port)
        def call(path, method="GET", value=None):
            body = json.dumps(value).encode() if value is not None else None
            req = Request(base + path, data=body, method=method,
                          headers={"Content-Type":"application/json"} if body else {})
            with urlopen(req) as response:
                return response.status, response.read(), response.headers
        try:
            status, html, _ = call("/")
            self.assertEqual(status, 200)
            self.assertIn(b"Spaced repetition trainer", html)
            _, raw, _ = call("/api/decks", "POST", {"name":"Math"})
            deck = json.loads(raw)["id"]
            _, raw, _ = call("/api/cards", "POST", {"deck_id":deck,"front":"2 + 2","back":"4","tag_ids":[]})
            card = json.loads(raw)["id"]
            _, raw, _ = call("/api/review", "POST", {"card_id":card,"rating":"Easy","seconds":4})
            self.assertEqual(json.loads(raw)["interval_days"], 4)
            _, backup, headers = call("/api/export-json")
            self.assertIn("attachment", headers["Content-Disposition"])
            data = json.loads(backup)
            self.assertEqual(len(data["reviews"]), 1)
            call("/api/decks/"+str(deck), "DELETE")
            _, raw, _ = call("/api/import-json", "POST", data)
            self.assertEqual(json.loads(raw)["cards"], 1)
            _, raw, _ = call("/api/state")
            self.assertEqual(len(json.loads(raw)["cards"]), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.db = connect(self.path)


if __name__ == "__main__":
    unittest.main()
