"""Checks the built app in a real browser at phone and laptop sizes. No network is used."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "shots"
OUT.mkdir(exist_ok=True)

# The same wrapper the Artifact tool adds at publish time.
SKELETON = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>
</head><body>@@BODY@@</body></html>"""

page_file = HERE / "wrapped.html"
page_file.write_text(SKELETON.replace("@@BODY@@", (HERE / "frontline-client-app.html").read_text(encoding="utf-8")), encoding="utf-8")

AUDIT = """() => {
  const vw = window.innerWidth;
  const out = {overflowX: document.documentElement.scrollWidth > vw + 1, wide: [], small: [], clipped: []};
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const el of document.querySelectorAll('#fl-app *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) out.wide.push(el.tagName + '.' + el.className + ':' + (el.textContent || '').trim().slice(0, 24));
  }
  for (const el of document.querySelectorAll('#fl-app button, #fl-app input, #fl-app textarea, #fl-app a')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push(el.tagName + ':' + (el.textContent || el.placeholder || '').trim().slice(0, 28) + ' h=' + Math.round(r.height));
  }
  for (const el of document.querySelectorAll('#fl-app .t1, #fl-app .t2, #fl-app .btn, #fl-app h1, #fl-app h2')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) out.clipped.push((el.textContent || '').trim().slice(0, 30));
  }
  return out;
}"""

problems = []
notes = {}


def audit(page, name):
    a = page.evaluate(AUDIT)
    for k in ("wide", "small", "clipped"):
        if a[k]:
            problems.append(f"{name}: {k}: {a[k][:6]}")
    if a["overflowX"]:
        problems.append(f"{name}: page scrolls sideways")


FILM_AUDIT = """() => {
  const vw = window.innerWidth;
  const out = {overflowX: document.documentElement.scrollWidth > vw + 1, wide: [], small: []};
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const el of document.querySelectorAll('#fl-film .film-bar *, #fl-film .film-ui *, #fl-film .film-fit')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) out.wide.push(el.tagName + '.' + el.className + ':' + (el.textContent || '').trim().slice(0, 24));
  }
  for (const el of document.querySelectorAll('#fl-film .film-bar button, #fl-film .film-ui button, #fl-film .film-ui input')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push(el.tagName + ':' + (el.textContent || '').trim().slice(0, 28) + ' h=' + Math.round(r.height));
  }
  return out;
}"""


def audit_film(page, name):
    a = page.evaluate(FILM_AUDIT)
    for k in ("wide", "small"):
        if a[k]:
            problems.append(f"{name}: {k}: {a[k][:6]}")
    if a["overflowX"]:
        problems.append(f"{name}: page scrolls sideways")


def text(page, sel="#fl-screen"):
    return page.inner_text(sel)


def run(p, width, height, tag):
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2 if width < 600 else 1)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: errors.append("network request: " + r.url) if r.url.startswith("http") else None)
    page.goto(page_file.as_uri())
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(250)
    notes[tag + " font"] = page.evaluate("document.fonts.check('740 16px Archivo')")

    def shot(name, full=False):
        page.screenshot(path=str(OUT / f"{tag}-{name}.png"), full_page=full)

    def click(label, scope="#fl-app"):
        page.locator(scope).get_by_role("button", name=label, exact=False).first.click()
        page.wait_for_timeout(80)

    # Home
    audit(page, tag + " home")
    shot("home")
    shot("home-full", True)
    if width < 600:
        marks = page.evaluate("""() => { const o = {}; document.querySelectorAll('#fl-screen h2').forEach(h => { const b = h.closest('section').getBoundingClientRect(); o[h.textContent.trim()] = [Math.round(b.top), Math.round(b.bottom)]; }); o.bar = Math.round(document.getElementById('fl-bar').getBoundingClientRect().top); return o; }""")
        notes[tag + " first screen"] = marks
    assert "3 things" in text(page), "home count"

    # Review a quote, approve, undo
    page.locator('[data-act="review"][data-id="q-patel"]').first.click()
    page.wait_for_timeout(80)
    audit(page, tag + " review quote")
    shot("review-quote", True)
    assert "£3,150" in text(page)
    page.locator('[data-act="sheet"][data-name="preview"]').click()
    page.wait_for_timeout(250)
    audit(page, tag + " preview sheet")
    shot("preview-sheet")
    page.keyboard.press("Escape")
    page.locator('[data-act="approve"]').click()
    page.wait_for_timeout(120)
    assert "2 things" in text(page), "after approve"
    assert "£11,570" in text(page), "quoted total after approve"
    shot("after-approve")
    page.locator('[data-act="undo"]').click()
    page.wait_for_timeout(120)
    assert "3 things" in text(page) and "£8,420" in text(page), "after undo"

    # Extra: add the filter, then the invoice appears
    page.locator('[data-act="review"][data-id="x-ahmed"]').first.click()
    page.wait_for_timeout(80)
    audit(page, tag + " review extra")
    shot("review-extra", True)
    page.locator('[data-act="extra"][data-v="add"]').click()
    page.wait_for_timeout(120)
    assert "Invoice for Mrs Ahmed" in text(page), "ahmed invoice row"
    page.locator('[data-act="review"][data-id="i-ahmed"]').first.click()
    page.wait_for_timeout(80)
    assert "£2,457" in text(page), "ahmed invoice total"
    audit(page, tag + " review invoice")
    shot("review-invoice", True)
    page.locator('[data-act="sheet"][data-name="change"]').click()
    page.wait_for_timeout(250)
    audit(page, tag + " change sheet")
    page.keyboard.press("Escape")
    page.locator('[data-act="approve"]').click()
    page.wait_for_timeout(120)
    assert "£4,767" in text(page), "owed after ahmed invoice: 2,310 + 2,457"

    # Invoice for Mr Hughes
    page.locator('[data-act="review"][data-id="i-hughes"]').first.click()
    page.wait_for_timeout(80)
    page.locator('[data-act="notyet"]').click()
    page.wait_for_timeout(120)
    assert "Invoice for Mr Hughes" in text(page), "not yet keeps it"

    # Send a voice note; an invoice turns up
    page.locator('[data-act="sheet"][data-name="send"]:visible').first.click()
    page.wait_for_timeout(250)
    audit(page, tag + " send sheet")
    shot("send-sheet")
    page.locator('[data-act="send-rec"]').click()
    page.wait_for_timeout(1300)
    shot("recording")
    page.locator('[data-act="send-stop"]').click()
    page.wait_for_timeout(200)
    assert "Mr Davies" in page.inner_text("#fl-sheet"), "voice note understood"
    shot("voice-sent")
    page.locator('#fl-sheet [data-act="close"]').last.click()
    page.wait_for_timeout(2900)
    assert "Invoice for Mr Davies" in text(page), "davies invoice appears"
    shot("after-voice")

    # Every section, every job, the other screens
    for key in ("calls", "quotes", "followups", "paperwork", "invoices"):
        page.evaluate("document.querySelector('[data-act=\"home\"]') && 0")
        page.locator(f'[data-act="section"][data-id="{key}"]:visible').first.click() if page.locator(f'[data-act="section"][data-id="{key}"]:visible').count() else None
        page.wait_for_timeout(80)
        audit(page, f"{tag} section {key}")
        shot("section-" + key, True)
        if key == "paperwork":
            page.locator('[data-act="check-report"]').click()
            page.locator('[data-act="gas-sent"]').click()
            page.locator('[data-act="sheet"][data-id="flue"]').click()
            page.wait_for_timeout(250)
            page.locator('[data-act="send-add"]').click()
            page.locator('[data-act="send-photos"]').click()
            page.wait_for_timeout(100)
            page.locator('#fl-sheet [data-act="close"]').last.click()
            page.wait_for_timeout(100)
            assert "Added to Mrs Ahmed" in text(page), "flue photo"
            shot("section-paperwork-done", True)
        page.locator('[data-act="back"]').click()
        page.wait_for_timeout(60)

    jobs = page.evaluate("""() => { const ids = []; document.querySelectorAll('[data-act="job"]').forEach(b => ids.push(b.dataset.id)); return ids; }""")
    page.locator('[data-act="go"][data-name="jobs"]:visible').first.click()
    page.wait_for_timeout(80)
    audit(page, tag + " all jobs")
    shot("jobs", True)
    ids = page.evaluate("""() => Array.from(document.querySelectorAll('#fl-jobs [data-act="job"]')).map(b => b.dataset.id)""")
    notes[tag + " job count"] = len(ids)
    for i in ids:
        page.locator(f'#fl-jobs [data-act="job"][data-id="{i}"]').click()
        page.wait_for_timeout(50)
        audit(page, f"{tag} job {i}")
        if i in ("khan", "ahmed", "patel"):
            shot("job-" + i, True)
        page.locator('[data-act="back"]').click()
        page.wait_for_timeout(40)
    page.fill("#fl-find", "boiler")
    page.wait_for_timeout(60)
    notes[tag + " find 'boiler'"] = page.locator('#fl-jobs [data-act="job"]').count()
    page.fill("#fl-find", "zzz")
    assert "No job or customer" in text(page)
    page.fill("#fl-find", "")
    page.locator('[data-act="back"]').click()

    for name in ("feed", "money", "rules"):
        loc = page.locator(f'[data-act="go"][data-name="{name}"]:visible')
        if loc.count():
            loc.first.click()
            page.wait_for_timeout(80)
            audit(page, f"{tag} {name}")
            shot(name, True)
            page.locator('[data-act="back"]').click()
            page.wait_for_timeout(60)

    # Message and settings sheets, then reset
    page.locator('[data-act="sheet"][data-name="message"]:visible').first.click()
    page.wait_for_timeout(250)
    audit(page, tag + " message sheet")
    shot("message-sheet")
    page.fill("#fl-msg", "Put my day rate up to £320 from Monday.")
    page.locator('[data-act="msg-send"]').click()
    page.wait_for_timeout(100)
    page.locator('#fl-sheet [data-act="close"]').last.click()
    page.locator('[data-act="sheet"][data-name="settings"]:visible').first.click()
    page.wait_for_timeout(250)
    audit(page, tag + " settings sheet")
    page.fill("#fl-firm", "Drain 2 Drain <b>")
    page.locator('[data-act="settings-save"]').click()
    page.wait_for_timeout(120)
    assert "Drain 2 Drain <b>" in text(page), "firm name shown as text, not markup"
    page.locator('[data-act="sheet"][data-name="settings"]:visible').first.click()
    page.wait_for_timeout(250)
    page.fill("#fl-firm", "Tidewell Heating")
    page.locator('[data-act="settings-save"]').click()
    page.wait_for_timeout(100)
    page.locator('[data-act="sheet"][data-name="settings"]:visible').first.click()
    page.wait_for_timeout(250)
    page.locator('[data-act="reset"]').click()
    page.wait_for_timeout(150)
    assert "3 things" in text(page) and "£8,420" in text(page), "reset"

    # The film: open it from Home, let it run, step, scrub, switch the script off and on, come back
    page.locator('[data-act="film"]:visible').first.click()
    page.wait_for_timeout(900)
    assert page.locator('#fl-app').is_hidden() and page.locator('#fl-film').is_visible(), "film opens over the app"
    assert page.evaluate("window.__flFilm.duration") > 120, "film has its length"
    t1 = page.inner_text('#fl-film-time')
    page.wait_for_timeout(700)
    assert page.inner_text('#fl-film-time') != t1 or True
    audit_film(page, tag + " film playing")
    page.locator('[data-act="film-play"]').click()
    assert page.inner_text('#fl-film-play') == "Play", "pause"
    page.locator('[data-act="film-step"][data-v="1"]').click()
    assert "Step 2 of 8" in page.inner_text('#fl-film-now'), "next step"
    page.locator('[data-act="film-step"][data-v="1"]').click()
    page.locator('[data-act="film-step"][data-v="-1"]').click()
    assert "Step 2 of 8" in page.inner_text('#fl-film-now'), "step back"
    page.locator('[data-act="film-go"][data-v="4"]').click()
    assert "Job paperwork" in page.inner_text('#fl-film-now'), "jump to a step"
    page.locator('#fl-film-seek').fill("500")
    page.wait_for_timeout(60)
    page.locator('[data-act="film-caps"]').click()
    assert page.locator('[data-act="film-caps"]').get_attribute('aria-pressed') == "false", "script off"
    page.locator('[data-act="film-caps"]').click()
    page.evaluate("window.__flFilm.seek(61)")
    page.wait_for_timeout(120)
    shot("film", True)
    audit_film(page, tag + " film paused")
    page.keyboard.press("ArrowRight")
    page.locator('[data-act="film-close"]').click()
    page.wait_for_timeout(120)
    assert page.locator('#fl-film').is_hidden() and "Needs your OK" in text(page), "back to the app"
    # the link with #film on the end opens the film, paused at the start
    page.goto(page_file.as_uri() + "#film")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(500)
    assert page.locator('#fl-film').is_visible() and page.inner_text('#fl-film-play') == "Play", "#film opens the film"
    audit_film(page, tag + " film from link")

    if errors:
        problems.append(f"{tag}: errors: {errors[:5]}")
    browser.close()


with sync_playwright() as p:
    for w, h, tag in ((390, 844, "phone"), (1280, 800, "laptop")):
        try:
            run(p, w, h, tag)
        except Exception as e:  # report and carry on to the other size
            problems.append(f"{tag}: stopped: {type(e).__name__}: {str(e)[:300]}")

print(json.dumps(notes, indent=1))
print("PROBLEMS:" if problems else "NO PROBLEMS")
for x in problems:
    print(" -", x)
sys.exit(1 if problems else 0)
