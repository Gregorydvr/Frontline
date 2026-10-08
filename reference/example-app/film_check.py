"""Checks the film's story: the money on every day it visits, the counts, the dates, the taps and the timing
of the narration; and, for version 2, that the stage stays still and the list stays short.
Run after build.py and test.py (it uses wrapped.html). No network is used."""
import datetime
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
problems = []


def check(ok, what):
    if not ok:
        problems.append(what)


GET = """() => {
  const F = window.__flFilm;
  const sum = jobs => { const t = {q: 0, o: 0, v: 0}; Object.values(jobs).forEach(j => {
    if (j.q && j.q.state === 'waiting') t.q += j.q.amt;
    if (j.inv && (j.inv.state === 'sent' || j.inv.state === 'overdue')) t.o += j.inv.amt;
    if (j.inv && j.inv.state === 'overdue') t.v += j.inv.amt; }); return t; };
  return {
    dur: F.duration,
    beats: F.beats.map(b => ({id: b.id, title: b.title, t0: b.t0, t1: b.t1, say: b.say})),
    caps: F.captions().map(c => ({t0: c.t0, t1: c.t1, text: c.text, late: c.late})),
    cards: F.cards,
    snaps: F.snaps.map(n => ({at: n.at, day: n.data.day, clock: n.s.tom.clock, money: sum(n.data.jobs), ok: n.data.approvals, did: n.s.did,
      items: n.s.items.map(i => [i.who, i.text]), lay: n.s.lay, chap: n.s.chap.n, focus: n.s.focus.who, spot: n.s.tom.spot, tapT: n.s.tom.tap, tapC: n.s.cust.tap, scroll: n.s.tom.scroll, route: n.s.tom.route,
      jobs: n.data.jobs, ahmed: n.data.jobs.ahmed, msgs: n.s.cust.msgs.length, feed: n.data.feed.length })),
    seedAhmed: null
  };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: errors.append("network request: " + r.url) if r.url.startswith("http") else None)
    page.goto((HERE / "wrapped.html").as_uri())
    page.evaluate("document.fonts.ready")
    # the app's own Mrs Ahmed, read from her job page before the film opens
    page.locator('[data-act="go"][data-name="jobs"]:visible').first.click()
    page.locator('#fl-jobs [data-act="job"][data-id="ahmed"]').click()
    app_ahmed = page.evaluate("""() => Array.from(document.querySelectorAll('#fl-screen .tl li')).map(li => li.querySelector('.who').textContent + '|' + li.querySelector('time').textContent + '|' + li.lastElementChild.textContent)""")
    page.evaluate("window.__flFilm.open({capture: true})")
    page.wait_for_timeout(300)
    d = page.evaluate(GET)
    # every half second of the film draws without an error, and the same time always draws the same picture
    t = 0.0
    while t < d["dur"]:
        page.evaluate("(t) => window.__flFilm.seek(t)", t)
        t += 0.5
    for t in (5.0, 12.0, 31.0, 33.1, 47.9, 61.3, 76.4, 97.2, 101.5, 109.9, 131.4, 147.0, 165.0, 171.0, 179.0):
        # the stage (every element and every style on it) must come out the same however that moment is reached
        page.evaluate("(t) => window.__flFilm.seek(t)", t)
        a = page.evaluate("document.querySelector('.film-stage').outerHTML")
        page.evaluate("(t) => { window.__flFilm.seek(3); window.__flFilm.seek(170); window.__flFilm.seek(t - 4); window.__flFilm.seek(t); }", t)
        check(a == page.evaluate("document.querySelector('.film-stage').outerHTML"), f"frame at {t}s differs after seeking away and back")
    b.close()

check(not errors, f"errors: {errors[:4]}")
snaps, beats = d["snaps"], d["beats"]
last = snaps[-1]

# the counts the film ends on, and the ticks that make them up
check(last["did"]["tom"] == 9 and last["did"]["fl"] == 32, f"final counts {last['did']}")
seen, prev = [], []
for n in snaps:
    for it in n["items"]:
        if it not in prev and it[0] in ("fl", "tom"):
            seen.append(it)
    prev = n["items"]
check(sum(1 for i in seen if i[0] == "fl") == 32 and sum(1 for i in seen if i[0] == "tom") == 9, "ledger lines do not add up to 32 and 9")

# money on each day: quoted, owed, overdue
want = [
    ("Monday 28 September", "11:15", (3440, 640, 0)),
    ("Wednesday 30 September", "13:00", (1260, 640, 0)),
    ("Thursday 1 October", "14:45", (1260, 3104, 0)),
    ("Thursday 1 October", "17:10", None),
    ("Sunday 4 October", "10:00", (3370, 3104, 0)),
    ("Sunday 4 October", "18:43", (480, 3104, 0)),
    ("Wednesday 14 October", "13:00", (9130, 2310, 640)),
    ("Thursday 15 October", "13:48", (10970, 2310, 640)),
    ("Thursday 5 November", "09:00", (2720, 4825, 2457)),
    ("Friday 6 November", "10:00", (1480, 2368, 0)),
    ("Friday 6 November", "16:00", (1480, 2368, 0)),
]
for day, clock, m in want:
    hit = [n for n in snaps if n["day"] == day and n["clock"] == clock]
    check(bool(hit), f"no moment at {day} {clock}")
    if hit and m:
        got = (hit[-1]["money"]["q"], hit[-1]["money"]["o"], hit[-1]["money"]["v"]) if clock in ("18:43",) else (hit[0]["money"]["q"], hit[0]["money"]["o"], hit[0]["money"]["v"])
        check(got == m, f"money at {day} {clock}: {got}, wanted {m}")
after_quote = [n for n in snaps if n["day"] == "Thursday 1 October" and n["ahmed"].get("q", {}).get("state") == "waiting"]
check(after_quote and (after_quote[0]["money"]["q"], after_quote[0]["money"]["o"]) == (4150, 3104), "money after the quote is sent")
after_inv = [n for n in snaps if n["day"] == "Thursday 15 October" and n["ahmed"].get("inv", {}).get("state") == "sent"]
check(after_inv and (after_inv[0]["money"]["q"], after_inv[0]["money"]["o"], after_inv[0]["money"]["v"]) == (10970, 4767, 640), "money after the invoice is sent")
paid = [n for n in snaps if n["day"] == "Thursday 5 November" and n["ahmed"]["inv"]["state"] == "paid"]
check(paid and (paid[0]["money"]["q"], paid[0]["money"]["o"], paid[0]["money"]["v"]) == (2720, 2368, 0), "money after she pays")

# the job's own sums
check(2450 + 180 + 260 == 2890, "quote lines")
check(round(2890 * 0.2) == 578, "deposit is 20%")
check(2890 + 145 - 578 == 2457, "invoice is quote plus filter less deposit")
fri = [n for n in snaps if n["day"] == "Friday 6 November" and n["clock"] == "16:00"][0]["jobs"]
check(fri["grant"]["q"]["amt"] + fri["doyle"]["q"]["amt"] + fri["hill"]["q"]["amt"] == 4890, "week: quotes sent")
check(fri["grant"]["q"]["amt"] + fri["doyle"]["q"]["amt"] == 3410 and fri["grant"]["q"]["state"] == fri["doyle"]["q"]["state"] == "accepted", "week: quotes won")
check(fri["hill"]["q"]["state"] == "waiting" and fri["hill"]["q"]["amt"] == 1480, "week: waiting")
check(fri["turner"]["inv"]["amt"] + 2457 == 3929 and fri["turner"]["inv"]["state"] == "paid", "week: paid")
check(round(fri["grant"]["q"]["amt"] * 0.2) == 544, "week: deposit in")
check(fri["kaur"]["inv"]["amt"] == 2368 and fri["kaur"]["inv"]["state"] == "sent" and round(2960 * 0.8) == 2368, "week: owed")

# the days are the right days of the week
for text, y in (("Monday 28 September", 2026), ("Wednesday 30 September", 2026), ("Thursday 1 October", 2026), ("Sunday 4 October", 2026),
                ("Wednesday 14 October", 2026), ("Thursday 15 October", 2026), ("Thursday 29 October", 2026), ("Thursday 5 November", 2026),
                ("Friday 6 November", 2026), ("Friday 1 October", 2027), ("Wednesday 13 October", 2027)):
    wd, dd, mm = text.split()
    real = datetime.date(y, {"September": 9, "October": 10, "November": 11}[mm], int(dd))
    check(real.strftime("%A") == wd, f"{text} {y} is a {real.strftime('%A')}")
check(datetime.date(2026, 10, 15) + datetime.timedelta(days=30) == datetime.date(2026, 11, 14), "Gas Safe: 30 days from 15 October")
check(datetime.date(2026, 10, 15) + datetime.timedelta(days=14) == datetime.date(2026, 10, 29), "invoice due 14 days on")
check(datetime.date(2026, 10, 29) + datetime.timedelta(days=7) == datetime.date(2026, 11, 5), "reminder 7 days after it was due")
check(datetime.date(2026, 10, 1) + datetime.timedelta(days=3) == datetime.date(2026, 10, 4), "nudge on day 3")

# Mrs Ahmed in the film on the morning of 15 October is Mrs Ahmed in the app's own example
start = [n for n in snaps if n["day"] == "Thursday 15 October"][0]["ahmed"]
film_tl = [f"{ {'fl': 'Front-line', 'you': 'You', 'cust': 'Customer'}[e[2]] }|{e[1]}|{e[3]}" for e in start["tl"]]
check(film_tl == app_ahmed[:len(film_tl)], "Mrs Ahmed's history in the film differs from the app's example")
check(start["q"] == {"amt": 2890, "state": "accepted"}, "Mrs Ahmed's quote on 15 October")

tl = last["ahmed"]["tl"]
key = lambda e: (datetime.datetime.strptime(e[0] + ("" if e[0][-4:].isdigit() else " 2026"), "%a %d %b %Y"), e[1])
check(all(key(tl[i]) <= key(tl[i + 1]) for i in range(len(tl) - 1)), "Mrs Ahmed's history is out of time order")
check(sum(1 for e in tl if e[2] == "you") == 9, f"Tom's entries in her history: {sum(1 for e in tl if e[2] == 'you')}")
say = " ".join(b["say"] for b in beats)
check("did nine small things" in say and "did thirty-two" in say, "the narration's counts")

# version 2: five chapters and "after the job", each opened by a card, in the app's own order and names
check([b["id"] for b in beats] == ["intro", "calls", "quotes", "followups", "paperwork", "invoices", "after", "outro"], f"the steps: {[b['id'] for b in beats]}")
check([c["title"] for c in d["cards"]] == ["Calls & bookings", "Quotes", "Follow-ups", "Job paperwork", "Invoices & reminders", "After the job"], f"the chapter cards: {[c['title'] for c in d['cards']]}")
check(all(abs(c["t"] - b["t0"]) < 1e-6 for c, b in zip(d["cards"], beats[1:7])), "a chapter card does not open its chapter")
check([n["chap"] for n in snaps] == sorted(n["chap"] for n in snaps), "the chapters run out of order")
# the stage stays still: the picture is arranged once, as the opening card clears, and put away once, for the closing card
moves = sorted({n["lay"]["t0"] for n in snaps if n["lay"]["t0"] > 0})
check(len(moves) == 2 and moves[0] < beats[1]["t0"] and moves[1] > beats[-1]["t0"], f"the picture moves at {moves}")
check(len({n["lay"]["to"]["mx"] for n in snaps}) == 1, "the middle column moves")
# the list stays short enough to take in, and every line fits the column
longest = max(len(n["items"]) for n in snaps)
counted = max(sum(1 for i in n["items"] if i[0] in ("fl", "tom")) for n in snaps)
check(counted <= 5 and longest <= 6, f"the list grows to {longest} lines, {counted} of them things done")
texts = sorted({i[1] for n in snaps for i in n["items"]}, key=len)
check(len(texts[-1]) <= 44, f"a line of the list is long: {texts[-1]}")
# where Tom's screen is lit, there is something there to light
for n in snaps:
    sp = n["spot"]
    check(not sp or (sp["w"] > 40 and sp["h"] > 20 and 0 <= sp["x"] < 390), f"the spotlight at {n['at']}s on {sp and sp['sel']} found nothing")

# every tap lands on something and every scroll knows where it is going
for n in snaps:
    for who in ("tapT", "tapC"):
        tp = n[who]
        if tp and abs(tp["t0"] - n["at"]) < 1e-6:
            check(tp["x"] > 0 and tp["y"] > 0 and tp["x"] < 390 and tp["y"] < 720, f"tap at {n['at']}s on {tp['sel']} lands at {tp['x']},{tp['y']}")
    check(n["scroll"]["to"] is not None and n["scroll"]["from"] is not None, f"scroll at {n['at']}s not worked out")

# the narration fits: no line runs into the next, and nothing is said after the film ends
late = [c for c in d["caps"] if c["late"]]
check(not late, f"narration lines that overrun: {[(round(c['t0'], 1), c['text']) for c in late]}")
words = sum(len(b["say"].split()) for b in beats)
print(json.dumps({"length": d["dur"], "length as m:ss": f"{int(d['dur'] // 60)}:{int(d['dur'] % 60):02d}", "beats": len(beats), "cues": len(snaps) - 1,
                  "narration words": words, "narration lines": len(d["caps"]), "chapter cards": len(d["cards"]), "messages to the customer": last["msgs"],
                  "most lines in the list at once": longest, "times the picture is rearranged": len(moves)}, indent=1))
print("FILM PROBLEMS:" if problems else "FILM STORY OK")
for x in problems:
    print(" -", x)
sys.exit(1 if problems else 0)
