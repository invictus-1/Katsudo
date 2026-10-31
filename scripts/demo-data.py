"""Make a Katsudō database full of believable, made-up history: a person who codes by day and
plays osu! and other games in the evening, from January 2025 to today. Nothing in it is real.
Used for the screenshots, and handy for trying Katsudō without importing anything:

    python scripts/demo-data.py demo/katsudo.db
    set KATSUDO_DATA_DIR=demo  (then start Katsudō; it uses demo/ instead of your own data)
"""
import datetime as dt
import json
import math
import os
import random
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "demo", "katsudo.db")
START = dt.date(2025, 1, 1)
TODAY = dt.date.today()
rng = random.Random(1986)

# (key, name, keys per active minute, clicks per minute, used for)
APPS = [
    ("code.exe", "Visual Studio Code", 95, 4, "work"),
    ("windowsterminal.exe", "Windows Terminal", 70, 2, "work"),
    ("firefox.exe", "Firefox", 22, 9, "both"),
    ("figma.exe", "Figma", 12, 26, "work"),
    ("obsidian.exe", "Obsidian", 60, 5, "work"),
    ("slack.exe", "Slack", 45, 6, "work"),
    ("discord.exe", "Discord", 55, 5, "evening"),
    ("spotify.exe", "Spotify", 1, 3, "both"),
    ("osu!.exe", "osu!", 420, 8, "evening"),
    ("factorio.exe", "Factorio", 90, 40, "evening"),
    ("blender.exe", "Blender", 25, 30, "evening"),
    ("steam.exe", "Steam", 4, 10, "evening"),
    ("explorer.exe", "File Explorer", 6, 14, "both"),
]
SITES = ["github.com", "docs.rs", "developer.mozilla.org", "stackoverflow.com", "news.ycombinator.com", "youtube.com",
         "wikipedia.org", "osu.ppy.sh", "reddit.com", "figma.com", "crates.io", "twitch.tv"]
DOCS = {"code.exe": ["main.rs - side-project", "app.tsx - side-project", "README.md - side-project", "styles.css - side-project"],
        "obsidian.exe": ["Daily note - Obsidian", "Ideas - Obsidian"], "blender.exe": ["robot.blend - Blender"]}
WORK = {"code.exe": 34, "windowsterminal.exe": 10, "firefox.exe": 22, "figma.exe": 8, "obsidian.exe": 7, "slack.exe": 10, "explorer.exe": 3, "spotify.exe": 2}
EVENING = {"osu!.exe": 26, "factorio.exe": 14, "discord.exe": 14, "firefox.exe": 20, "blender.exe": 8, "steam.exe": 4, "spotify.exe": 4, "code.exe": 10}
LETTERS = "etaoinsrhldcumfpgwybvkxjqz"
# Where each app's clicks land: (x, y, spread x, spread y, weight) on the screens below.
HOTSPOTS = {
    "default": [(1280, 700, 500, 300, 5), (40, 300, 20, 200, 1)],
    "taskbar": [(1180, 1420, 260, 8, 3), (2480, 1420, 40, 8, 1)],
    "code.exe": [(150, 420, 90, 260, 4), (1100, 700, 420, 330, 5), (700, 18, 300, 6, 2), (2530, 14, 10, 4, 1)],
    "windowsterminal.exe": [(3500, 720, 380, 260, 4), (2700, 210, 120, 8, 1)],
    "firefox.exe": [(500, 18, 380, 7, 4), (900, 60, 260, 8, 2), (1300, 760, 520, 330, 6), (2540, 14, 8, 4, 1)],
    "figma.exe": [(1280, 720, 420, 260, 6), (140, 500, 80, 300, 3), (2400, 520, 90, 300, 3)],
    "obsidian.exe": [(3200, 600, 380, 300, 4), (2700, 500, 90, 300, 2)],
    "slack.exe": [(2760, 520, 110, 280, 4), (3600, 1180, 500, 30, 4)],
    "discord.exe": [(2700, 600, 80, 330, 3), (3500, 1200, 560, 25, 4), (3700, 640, 500, 330, 2)],
    "spotify.exe": [(3520, 1190, 60, 15, 4), (3000, 600, 300, 250, 1)],
    "osu!.exe": [(1280, 720, 520, 320, 8), (2300, 1200, 120, 80, 1)],
    "factorio.exe": [(1280, 720, 700, 400, 6), (1280, 1360, 380, 30, 3)],
    "blender.exe": [(1150, 660, 520, 330, 5), (2350, 500, 140, 330, 3), (1280, 24, 500, 8, 1)],
    "steam.exe": [(3520, 640, 600, 340, 4)],
    "explorer.exe": [(3300, 620, 500, 300, 3), (2750, 500, 90, 260, 2)],
}
SCREENS = [{"x": 0, "y": 0, "w": 2560, "h": 1440, "primary": True}, {"x": 2560, "y": 180, "w": 1920, "h": 1080, "primary": False}]

if os.path.exists(OUT):
    raise SystemExit(f"{OUT} already exists; pick a new path")
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
db = sqlite3.connect(OUT)
schema = re.search(r'const SCHEMA: &str = r#"(.*?)"#;', open(os.path.join(ROOT, "src-tauri", "src", "db.rs"), encoding="utf-8").read(), re.S).group(1)
db.executescript(schema)
db.execute("ALTER TABLE source ADD COLUMN device TEXT NOT NULL DEFAULT 'this-pc'")
db.execute("INSERT INTO source (id, kind, label, created_at) VALUES (1, 'native', 'Katsudō', ?)", (int(dt.datetime(2025, 1, 1).timestamp()),))
for k, v in [("schema_version", "2"), ("keymap_version", "3"), ("setting.welcome", "false")]:
    db.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (k, v))
app_id = {}
for key, name, *_ in APPS:
    app_id[key] = db.execute("INSERT INTO app (key, name) VALUES (?, ?)", (key, name)).lastrowid
title_id = {}
def title(text):
    if text not in title_id:
        title_id[text] = db.execute("INSERT INTO title (text) VALUES (?)", (text,)).lastrowid
    return title_id[text]
rate = {k: (kpm, cpm) for k, _, kpm, cpm, _ in APPS}

def pick(weights):
    r = rng.random() * sum(weights.values())
    for k, w in weights.items():
        r -= w
        if r <= 0:
            return k
    return k

def key_mix(app, n):
    """n presses spread over plausible keys for this app."""
    out = {}
    def add(k, c):
        if c > 0:
            out[k] = out.get(k, 0) + c
    if app == "osu!.exe":
        style = rng.random()
        if style < 0.6:
            add("z", int(n * 0.48)); add("x", int(n * 0.47))
        else:
            for k in "dfjk":
                add(k, int(n * 0.235))
        add("escape", int(n * 0.01)); add("enter", int(n * 0.02))
    elif app == "factorio.exe":
        for k, w in zip("wasd", (0.2, 0.14, 0.12, 0.14)):
            add(k, int(n * w))
        for k, w in (("e", 0.08), ("q", 0.06), ("r", 0.04), ("lshift", 0.06), ("lctrl", 0.05), ("1", 0.03), ("2", 0.03), ("3", 0.02), ("space", 0.03)):
            add(k, int(n * w))
    else:
        add("space", int(n * 0.16)); add("backspace", int(n * 0.07)); add("enter", int(n * 0.03)); add("lshift", int(n * 0.04))
        add("lctrl", int(n * (0.05 if app in ("code.exe", "windowsterminal.exe") else 0.02))); add("tab", int(n * 0.015))
        rest = n * 0.6
        for i, ch in enumerate(LETTERS):
            add(ch, int(rest * 0.9 ** i * 0.1))
        for ch, w in ((".", 0.012), (",", 0.008), (";", 0.006 if app == "code.exe" else 0.001), ("/", 0.004), ("'", 0.004), ("-", 0.004), ("=", 0.003), ("[", 0.002), ("]", 0.002)):
            add(ch, int(n * w))
        for k, w in (("left", 0.006), ("right", 0.006), ("up", 0.004), ("down", 0.004), ("delete", 0.003), ("f5", 0.001), ("escape", 0.002)):
            add(k, int(n * w))
    return out

segments, input_hour, keys, net, up, cells, layout, sessions = [], {}, {}, {}, {}, {}, [], []
app_keys = {}  # (day, app id, key) -> presses
day = START
while day <= TODAY:
    ds = day.isoformat()
    weekend = day.weekday() >= 5
    if rng.random() < 0.03:  # a few days away from the PC
        day += dt.timedelta(days=1)
        continue
    blocks = []
    if not weekend:
        s = 8.6 + rng.random() * 0.8
        blocks += [(s, 12.0 + rng.random() * 0.5, WORK), (13.0 + rng.random() * 0.4, 17.5 + rng.random(), WORK)]
    else:
        blocks.append((10.5 + rng.random() * 1.5, 13.5 + rng.random(), EVENING))
    blocks.append((19.0 + rng.random(), 23.0 + rng.random() * 1.2, EVENING))
    if day == TODAY:
        now_h = dt.datetime.now().hour + dt.datetime.now().minute / 60
        blocks = [(a, min(b, now_h), w) for a, b, w in blocks if a < now_h]
    first = last = None
    for start_h, end_h, weights in blocks:
        t = dt.datetime.combine(day, dt.time()) + dt.timedelta(hours=start_h)
        end = dt.datetime.combine(day, dt.time()) + dt.timedelta(hours=end_h)
        first = first or t
        last = end
        segments.append((0, int(t.timestamp()), int(end.timestamp()), 1, None))
        while t < end:
            app = pick(weights)
            mins = rng.uniform(4, 40) if app in ("osu!.exe", "factorio.exe", "blender.exe") else rng.uniform(2, 22)
            seg_end = min(end, t + dt.timedelta(minutes=mins))
            a, b = int(t.timestamp()), int(seg_end.timestamp())
            segments.append((1, a, b, app_id[app], None))
            doc = None
            if app == "firefox.exe":
                doc = rng.choice(SITES[:6] if weights is WORK else SITES[4:])
            elif app in DOCS:
                doc = rng.choice(DOCS[app])
            if doc:
                segments.append((2, a, b, title(doc), app_id[app]))
            # input, per hour
            cur = t
            while cur < seg_end:
                h_end = min(seg_end, cur.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1))
                m = (h_end - cur).total_seconds() / 60
                kpm, cpm = rate[app]
                k = int(kpm * m * rng.uniform(0.6, 1.3))
                c = int(cpm * m * rng.uniform(0.6, 1.3))
                row = input_hour.setdefault((ds, cur.hour, app_id[app]), [0, 0, 0, 0.0])
                row[0] += k; row[1] += c; row[2] += int(c * rng.uniform(0.5, 2.5)); row[3] += m * rng.uniform(1.5, 4.0)
                for kk, n in key_mix(app, k).items():
                    keys[(ds, kk)] = keys.get((ds, kk), 0) + n
                    app_keys[(ds, app_id[app], kk)] = app_keys.get((ds, app_id[app], kk), 0) + n
                for _ in range(min(c, 400)):  # clicks where this app's controls are
                    spots = HOTSPOTS.get(app, HOTSPOTS["default"])
                    if rng.random() < 0.06:
                        spots = HOTSPOTS["taskbar"]
                    (cx, cy, sx, sy) = rng.choices(spots, weights=[s[4] for s in spots])[0][:4]
                    x, y = rng.gauss(cx, sx), rng.gauss(cy, sy)
                    cell = (ds, int(max(0, min(4479, x)) // 32), int(max(0, min(1439, y)) // 32))
                    cc = cells.setdefault(cell, [0, 0])
                    cc[0] += max(1, c // 400)
                    cc[1] += rng.randint(2, 9)
                cur = h_end
            if app == "osu!.exe" and day >= TODAY - dt.timedelta(days=150) and b - a > 300:
                n = b - a
                series, kps = [], rng.uniform(5, 8)
                for i in range(n):
                    if i % 90 < 2:
                        series.append(0)
                        continue
                    target = rng.choice((6, 9, 12, 15, 17)) if i % 40 == 0 else kps
                    kps += (target - kps) * 0.08 + rng.gauss(0, 0.8)
                    series.append(max(0, int(round(kps))))
                best = run = streams = 0
                for v in series + [0]:
                    if v >= 10:
                        run += 1
                    else:
                        streams += run >= 5
                        best = max(best, run)
                        run = 0
                sessions.append((app_id[app], float(a), float(a + n), sum(series), max(series) + rng.randint(0, 3), best, streams,
                                 b"".join(int(v).to_bytes(2, "little") for v in series)))
            t = seg_end
    if first:
        for hr in range(first.hour, min(24, last.hour + 1)):
            net[(ds, hr)] = (int(rng.lognormvariate(19.5, 1.1)), int(rng.lognormvariate(17.5, 1.2)))
            up[(ds, hr)] = 3_600_000
        layout.append((ds, json.dumps(SCREENS)))
    day += dt.timedelta(days=1)

db.executemany("INSERT INTO segment (lane, start, end, ref, app_id, source) VALUES (?, ?, ?, ?, ?, 1)", segments)
db.executemany("INSERT INTO input_hour VALUES (?, ?, 1, ?, ?, ?, ?, ?)", [(d, h, a, *v) for (d, h, a), v in input_hour.items()])
db.executemany("INSERT INTO key_day VALUES (?, 1, ?, ?)", [(d, k, n) for (d, k), n in keys.items()])
db.executemany("INSERT INTO key_app_day VALUES (?, ?, ?, ?)", [(d, a, k, n) for (d, a, k), n in app_keys.items()])
db.executemany("INSERT INTO net_hour VALUES (?, ?, 1, ?, ?)", [(d, h, *v) for (d, h), v in net.items()])
db.executemany("INSERT INTO uptime_hour VALUES (?, ?, 1, ?)", [(d, h, v) for (d, h), v in up.items()])
db.executemany("INSERT INTO mouse_cell VALUES (?, 1, ?, ?, ?, ?)", [(d, x, y, *v) for (d, x, y), v in cells.items()])
db.executemany("INSERT INTO mouse_layout VALUES (?, ?)", layout)
db.executemany("INSERT INTO rhythm_session (app_id, start, end, keys, peak_kps, best_stream, streams, series) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", sessions)
db.commit()
print(f"{OUT}: {len(segments):,} segments, {sum(v[0] for v in input_hour.values()):,} keys, {len(sessions)} osu! sessions, {START} to {TODAY}")
