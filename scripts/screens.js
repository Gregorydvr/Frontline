// npm run check:screens: the example app's own checks, run on the owner's
// screens in a real browser, at a phone's size (390 by 844) and a laptop's
// (1280 by 800):
// - nothing makes the page scroll sideways
// - no button, link or field is under 44px tall
// - no text is cut off
// - no accessibility failures, by axe-core's WCAG 2.2 AA rules, as
//   reference/example-app/axe_check.py runs them
// It also saves a screenshot of every screen in screens/ (never committed),
// beside the example app's Home and Calls & bookings at the same sizes.
//
// It starts the system as `npm run dev` does, on a port of its own, with a
// database of its own that starts empty, so the demo firm is fresh. It logs
// in as Tom, the demo firm's owner, the real way: a link sent by text to the
// stand-in for texts. Nothing leaves this machine.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'screens');
const PORT = 8799;
const ADDRESS = `http://localhost:${String(PORT)}`;
const AXE = join(ROOT, 'node_modules/axe-core/axe.min.js');
const EXAMPLE = join(ROOT, 'reference/example-app/frontline-client-app.html');
// The page the example's own checks wrap it in (SKELETON in
// reference/example-app/test.py), which, among other things, keeps its
// closed panels hidden.
const SKELETON = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style>
</head><body>@@BODY@@</body></html>`;
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 800 },
];
const WRANGLER = join(ROOT, 'node_modules/.bin/wrangler');
const QUIET = { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' };

// The example's checks (AUDIT in reference/example-app/test.py), on the app
// and any panel over it.
const AUDIT = `() => {
  const vw = window.innerWidth;
  const out = { overflowX: document.documentElement.scrollWidth > vw + 1, wide: [], small: [], clipped: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const el of document.querySelectorAll('.app *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) out.wide.push(el.tagName + '.' + el.className + ':' + (el.textContent || '').trim().slice(0, 24));
  }
  for (const el of document.querySelectorAll('.app button, .app input, .app textarea, .app a')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5) out.small.push(el.tagName + ':' + (el.textContent || el.placeholder || '').trim().slice(0, 28) + ' h=' + Math.round(r.height));
  }
  for (const el of document.querySelectorAll('.app .t1, .app .t2, .app .btn, .app h1, .app h2')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) out.clipped.push((el.textContent || '').trim().slice(0, 30));
  }
  return out;
}`;

const AXE_RUN = `async () => {
  const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, first: v.nodes[0].html.slice(0, 160) }));
}`;

const problems = [];
let checked = 0;

async function check(page, name) {
  await page.evaluate('document.fonts.ready');
  const audit = await page.evaluate(`(${AUDIT})()`);
  for (const kind of ['wide', 'small', 'clipped']) {
    if (audit[kind].length > 0) problems.push(`${name}: ${kind}: ${JSON.stringify(audit[kind].slice(0, 6))}`);
  }
  if (audit.overflowX) problems.push(`${name}: the page scrolls sideways`);
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(`(${AXE_RUN})()`);
  for (const violation of violations) problems.push(`${name}: ${violation.id} (${violation.impact}): ${violation.help}. ${violation.first}`);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  checked += 1;
}

async function waitForHealth() {
  for (let tries = 0; tries < 120; tries += 1) {
    try {
      const answer = await fetch(`${ADDRESS}/health`);
      if (answer.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('The system did not start');
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const state = mkdtempSync(join(tmpdir(), 'frontline-screens-'));
  // The example, wrapped as its own checks wrap it, in a copy of its own:
  // reference/ is never changed.
  const wrapped = join(state, 'example.html');
  writeFileSync(wrapped, SKELETON.replace('@@BODY@@', () => readFileSync(EXAMPLE, 'utf8')));
  const migrate = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state], { env: QUIET, cwd: ROOT, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`The migrations did not apply:\n${migrate.stderr}`);
  const worker = spawn(
    WRANGLER,
    ['dev', 'src/local.ts', '--port', String(PORT), '--persist-to', state, '--var', `PUBLIC_ADDRESS:${ADDRESS}`, '--var', `LINK_ADDRESS:${ADDRESS}`],
    { env: QUIET, cwd: ROOT, stdio: 'ignore' },
  );
  const browser = await chromium.launch();
  try {
    await waitForHealth();
    for (const size of SIZES) {
      const viewport = { width: size.width, height: size.height };
      // axe is added to each page as a script, which the pages' policy would
      // otherwise refuse, rightly.
      const context = await browser.newContext({ viewport, bypassCSP: true });
      const page = await context.newPage();

      // The pages for logging in, then logging in as Tom the real way.
      await page.goto(`${ADDRESS}/login`);
      await check(page, `${size.name}-login`);
      await page.goto(`${ADDRESS}/local/login`);
      await page.click('button[type=submit]');
      const link = await page.getAttribute('a[href*="/in/"]', 'href');
      await page.goto(link);
      await check(page, `${size.name}-login-link`);
      await page.click('button[type=submit]');
      await page.waitForURL(`${ADDRESS}/`);
      await check(page, `${size.name}-home`);
      await page.goto(link);
      await check(page, `${size.name}-login-expired`);

      for (const [name, path] of [
        ['calls', '/calls'],
        ['jobs', '/jobs'],
        ['jobs-none', '/jobs?q=zzz'],
        ['done', '/done'],
        ['rules', '/rules'],
        ['message', '/message?from=home'],
        ['not-found', '/jobs/0aaaaaaaaaaaaaaaaaaaaaaaaa'],
      ]) {
        await page.goto(`${ADDRESS}${path}`);
        await check(page, `${size.name}-${name}`);
      }
      // A job's page for each state: booked, passed to the owner, on today.
      await page.goto(`${ADDRESS}/jobs`);
      for (const [name, who] of [
        ['job-booked', 'Mrs Green'],
        ['job-urgent', 'Mr Price'],
        ['job-today', 'Mr Davies'],
      ]) {
        await page.goto(`${ADDRESS}/jobs`);
        await page.click(`a.row:has-text("${who}")`);
        await check(page, `${size.name}-${name}`);
      }
      // The find box narrows the list as the owner types.
      await page.goto(`${ADDRESS}/jobs`);
      await page.fill('#fl-find', 'beech');
      const shown = await page.locator('#fl-jobs a.row:visible').count();
      if (shown !== 1) problems.push(`${size.name}-jobs: typing "beech" shows ${String(shown)} jobs, not 1`);
      // Message us, sent.
      await page.goto(`${ADDRESS}/message?from=home`);
      await page.fill('#fl-msg', 'Please put my day rate up to £320 from Monday.');
      await page.click('.sheet button[type=submit]');
      await check(page, `${size.name}-message-sent`);
      await context.close();

      // The example app at the same size: Home, and Calls & bookings.
      const example = await browser.newPage({ viewport });
      await example.goto(pathToFileURL(wrapped).href);
      await example.evaluate('document.fonts.ready');
      await example.screenshot({ path: join(OUT, `example-${size.name}-home.png`), fullPage: true });
      await example.click('[data-act="section"][data-id="calls"]:visible');
      await example.screenshot({ path: join(OUT, `example-${size.name}-calls.png`), fullPage: true });
      await example.close();
    }
  } finally {
    await browser.close();
    worker.kill();
    rmSync(state, { recursive: true, force: true });
  }

  console.log(`Checked ${String(checked)} screens at 390 by 844 and 1280 by 800. Screenshots are in screens/.`);
  if (problems.length > 0) {
    console.log(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('No sideways scroll, nothing under 44px, nothing cut off, and no accessibility failures.');
  }
}

await main();
