# Recall demo collection and media

This sample collection contains 18 cards across Spanish essentials, Everyday science, and Better writing. It includes tags, due reviews, learned cards, a practice streak, and review history. The cards are example content for screenshots and a product walkthrough.

Run the demo without changing the default collection:

```sh
python3 trainer.py --db demo/recall-demo.sqlite3 --port 8001
```

Then open http://127.0.0.1:8001. The default `trainer.sqlite3` is separate.

`recall-demo.json` is a complete, restorable backup of the same sample collection. Restoring it through the app replaces the collection currently open, so use the separate demo database when exploring it.

`media/` contains desktop and mobile screenshots and two silent 20-second MP4 walkthroughs. The widescreen version presents the full desktop app; the square version frames the main app content for a feed post.

Regenerate the sample data with `python3 demo/seed_demo.py`. On macOS with Google Chrome and FFmpeg installed, regenerate screenshots and videos with `node demo/capture_demo.mjs`. The capture uses a temporary copy of the demo database, so recording a review does not change the reusable sample.
