"""Build a reproducible sample collection for screenshots and a walkthrough."""
from datetime import datetime, timedelta
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import trainer

HERE = Path(__file__).resolve().parent
DB = HERE / "recall-demo.sqlite3"
BACKUP = HERE / "recall-demo.json"
NOW = datetime.now().replace(hour=12, minute=0, second=0, microsecond=0)

DECKS = [
    ("Spanish essentials", "Useful words and short phrases for everyday conversation."),
    ("Everyday science", "Small explanations for things you see around you."),
    ("Better writing", "Clear language, stronger sentences, and good editing habits."),
]
TAGS = ["conversation", "foundations", "quick recall", "writing"]
CARDS = [
    (0, "How do you say ‘Good morning’ in Spanish?", "Buenos días.", [0, 2]),
    (0, "What does ‘gracias’ mean?", "Thank you.", [0, 2]),
    (0, "How do you ask ‘Where is the station?’", "¿Dónde está la estación?", [0]),
    (0, "What is the difference between ‘ser’ and ‘estar’?", "Ser describes identity or lasting traits; estar describes states or location.", [0, 1]),
    (0, "How do you say ‘I would like a coffee’?", "Quisiera un café.", [0]),
    (0, "What does ‘hasta luego’ mean?", "See you later.", [0, 2]),
    (1, "Why does ice float on water?", "Water expands as it freezes, so ice is less dense than liquid water.", [1]),
    (1, "What is the unit of electrical resistance?", "The ohm (Ω).", [1, 2]),
    (1, "What does a catalyst change in a reaction?", "It lowers activation energy without being used up.", [1]),
    (1, "Why is the sky blue?", "Air scatters shorter blue wavelengths of sunlight more strongly.", [1]),
    (1, "What is photosynthesis?", "Plants use sunlight to turn water and carbon dioxide into sugar and oxygen.", [1]),
    (1, "What does pH measure?", "How acidic or basic a solution is.", [1, 2]),
    (2, "What is an active-voice sentence?", "A sentence where the subject performs the action: ‘The team shipped the app.’", [3]),
    (2, "What should the first sentence of a paragraph do?", "State the paragraph’s main idea clearly.", [3, 2]),
    (2, "When is a shorter word usually better?", "When it carries the same meaning more clearly.", [3]),
    (2, "What is a concrete verb?", "A verb that names the action precisely, such as ‘build’ instead of ‘do’.", [3]),
    (2, "What makes a useful heading?", "It tells the reader what the next section contains.", [3]),
    (2, "What should you check in a final edit?", "Clarity, accuracy, and anything the reader must do next.", [3]),
]

if DB.exists():
    DB.unlink()
db = trainer.connect(DB)
with db:
    deck_ids = [db.execute("INSERT INTO decks(name,description) VALUES (?,?)", deck).lastrowid for deck in DECKS]
    tag_ids = [db.execute("INSERT INTO tags(name) VALUES (?)", (tag,)).lastrowid for tag in TAGS]
    card_ids = []
    for deck, front, back, tags in CARDS:
        created = (NOW - timedelta(days=75)).isoformat(timespec="seconds")
        card_id = db.execute(
            "INSERT INTO cards(deck_id,front,back,due_at,created_at) VALUES (?,?,?,?,?)",
            (deck_ids[deck], front, back, NOW.isoformat(timespec="seconds"), created),
        ).lastrowid
        for tag in tags:
            db.execute("INSERT INTO card_tags(card_id,tag_id) VALUES (?,?)", (card_id, tag_ids[tag]))
        card_ids.append(card_id)

    # Four mature cards, a four-day practice streak, and a few upcoming reviews.
    reviews = {
        0: [(-70, "Good"), (-69, "Good"), (-63, "Good"), (-48, "Good")],
        1: [(-70, "Good"), (-69, "Good"), (-63, "Good"), (-30, "Easy")],
        6: [(-70, "Good"), (-69, "Good"), (-63, "Good"), (-26, "Good")],
        12: [(-70, "Good"), (-69, "Good"), (-63, "Good"), (-21, "Good")],
        2: [(-3, "Good")],
        7: [(-2, "Good")],
        13: [(-1, "Hard")],
        3: [(0, "Good")],
        8: [(0, "Easy")],
        14: [(0, "Good")],
        15: [(-5, "Again"), (-4, "Good"), (-3, "Good")],
    }
    for index, entries in reviews.items():
        card_id = card_ids[index]
        card = dict(db.execute("SELECT * FROM cards WHERE id=?", (card_id,)).fetchone())
        for offset, rating in entries:
            reviewed = NOW + timedelta(days=offset)
            interval, ease, repetitions, due = trainer.schedule(card, rating, reviewed)
            db.execute(
                "UPDATE cards SET interval_days=?,ease=?,repetitions=?,due_at=?,last_review_at=? WHERE id=?",
                (interval, ease, repetitions, due, reviewed.isoformat(timespec="seconds"), card_id),
            )
            db.execute(
                "INSERT INTO reviews(card_id,deck_id,reviewed_at,rating,seconds) VALUES (?,?,?,?,?)",
                (card_id, card["deck_id"], reviewed.isoformat(timespec="seconds"), rating, 8 + index),
            )
            card.update(interval_days=interval, ease=ease, repetitions=repetitions, due_at=due)

BACKUP.write_text(json.dumps(trainer.snapshot(db), ensure_ascii=False, indent=2) + "\n")
print("Demo:", trainer.stats(db, NOW))
print("Queue:", {k: v for k, v in trainer.session(db, NOW).items() if k != "cards"})
print("Files:", DB, BACKUP)
db.close()
