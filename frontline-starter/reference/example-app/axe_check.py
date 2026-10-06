"""Runs axe-core (WCAG 2.2 AA rules) over the app's main screens and sheets. No network."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
AXE = (HERE / "node_modules/axe-core/axe.min.js").read_text()
RUN = """async () => { const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}});
  return r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, first: v.nodes[0].html.slice(0, 160), why: (v.nodes[0].failureSummary || '').slice(0, 200)})); }"""

found = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, tag in ((390, 844, "phone"), (1280, 800, "laptop")):
        page = b.new_page(viewport={"width": w, "height": h})
        page.goto((HERE / "wrapped.html").as_uri())
        page.evaluate("document.fonts.ready")
        page.add_script_tag(content=AXE)
        def check(name):
            page.wait_for_timeout(250)
            v = page.evaluate(RUN)
            if v:
                found[f"{tag} {name}"] = v
        check("home")
        page.locator('[data-act="review"][data-id="q-patel"]').first.click(); check("review quote")
        page.locator('[data-act="sheet"][data-name="preview"]').click(); check("preview sheet")
        page.keyboard.press("Escape")
        page.locator('[data-act="sheet"][data-name="change"]').click(); check("change sheet")
        page.keyboard.press("Escape")
        page.locator('[data-act="job"]').first.click(); check("job")
        page.locator('[data-act="back"]').click(); page.locator('[data-act="back"]').click()
        for key in ("calls", "quotes", "followups", "paperwork", "invoices"):
            page.locator(f'[data-act="section"][data-id="{key}"]:visible').first.click(); check("section " + key)
            page.locator('[data-act="back"]').click()
        for name in ("feed", "money", "rules", "jobs"):
            loc = page.locator(f'[data-act="go"][data-name="{name}"]:visible')
            if loc.count():
                loc.first.click(); check(name)
                page.locator('[data-act="back"]').click()
        page.locator('[data-act="sheet"][data-name="send"]:visible').first.click(); check("send sheet")
        page.locator('[data-act="send-rec"]').click(); check("recording")
        page.keyboard.press("Escape")
        page.locator('[data-act="sheet"][data-name="message"]:visible').first.click(); check("message sheet")
        page.keyboard.press("Escape")
        page.locator('[data-act="sheet"][data-name="settings"]:visible').first.click(); check("settings sheet")
        page.keyboard.press("Escape")
        page.locator('[data-act="film"]:visible').first.click()
        page.wait_for_timeout(700)
        page.locator('[data-act="film-play"]').click()
        for t in (2, 20, 61, 97, 168):
            page.evaluate("(t) => window.__flFilm.seek(t)", t); check(f"film at {t}s")
        page.close()
    b.close()
print(json.dumps(found, indent=1) if found else "NO AXE VIOLATIONS")
