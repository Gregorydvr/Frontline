// Sets a firm's voice agent in Vapi from a settings file in vapi/, then reads
// it back and shows each setting that changed, before and after.
//
//   node scripts/vapi-assistant.js <assistant id> <settings file>           shows what would change
//   node scripts/vapi-assistant.js <assistant id> <settings file> --apply   changes it
//
// Run on Greg's own machine only, when he asks for it (CLAUDE.md). The Vapi
// private key comes from the VAPI_API_KEY environment variable and is never
// printed or written anywhere. The settings file must hold no key, token,
// secret or password: Vapi's server credential is named by its id. Anything
// printed is shown with such fields hidden, in case Vapi sends one back.
//
// Vapi replaces each top-level setting it is given as a whole, so the file
// holds every part of each setting it names, such as all of `model`.

import { readFileSync } from 'node:fs';

const API = 'https://api.vapi.ai';
const SECRET_NAME = /secret|token|password|api_?key|authorization/i;
const VAPI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const [id, file, ...rest] = process.argv.slice(2);
const apply = rest.includes('--apply');
if (!id || !file || rest.some((arg) => arg !== '--apply')) {
  fail('Usage: node scripts/vapi-assistant.js <assistant id> <settings file> [--apply]');
}
if (!VAPI_ID.test(id)) fail('The assistant id is not one of Vapi\'s ids.');
const key = process.env.VAPI_API_KEY;
if (!key) fail('VAPI_API_KEY is not set.');

const settings = JSON.parse(readFileSync(file, 'utf8'));
if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
  fail('The settings file must hold one JSON object.');
}
const secretPath = findSecret(settings);
if (secretPath) fail(`The settings file has ${secretPath}. Keys and secrets stay out of the repository.`);

const before = await vapi('GET');
const fields = Object.keys(settings);

if (!apply) {
  const changing = fields.filter((field) => !same(before[field], settings[field]));
  show(`Would change on ${id} (run again with --apply to change it)`, changing, before, settings);
} else {
  await vapi('PATCH', settings);
  const after = await vapi('GET');
  const changed = fields.filter((field) => !same(before[field], after[field]));
  show(`Changed on ${id}`, changed, before, after);
  const notTaken = fields.filter((field) => !same(after[field], settings[field]));
  if (notTaken.length > 0) {
    console.log(`\nVapi now holds something other than the file for: ${notTaken.join(', ')}`);
    for (const field of notTaken) {
      console.log(`\n${field}, as Vapi holds it:\n${print(after[field])}`);
    }
    process.exitCode = 1;
  }
}

async function vapi(method, body) {
  let response;
  try {
    response = await fetch(`${API}/assistant/${id}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(`${method} failed to reach Vapi (${String(error)}). If it says "fetch failed", set NODE_OPTIONS=--dns-result-order=ipv4first and run again.`);
  }
  const answer = await response.json().catch(() => null);
  if (!response.ok) fail(`${method} was refused: HTTP ${String(response.status)}\n${print(answer)}`);
  return answer;
}

function show(heading, changed, from, to) {
  if (changed.length === 0) {
    console.log(`${heading}: nothing.`);
    return;
  }
  console.log(`${heading}: ${changed.join(', ')}`);
  for (const field of changed) {
    console.log(`\n=== ${field}\n--- before\n${print(from[field])}\n--- after\n${print(to[field])}`);
  }
}

/** The same JSON, whatever order the keys are in. */
function same(a, b) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map((name) => [name, sorted(value[name])]));
  }
  return value;
}

/** Pretty JSON, with any field whose name looks like a secret hidden. */
function print(value) {
  if (value === undefined) return '(not set)';
  return JSON.stringify(
    value,
    (name, inner) => (name && SECRET_NAME.test(name) && typeof inner === 'string' ? '(hidden)' : inner),
    2,
  );
}

/** Where in the settings a field is named like a secret, if anywhere. */
function findSecret(value, path = '') {
  if (typeof value !== 'object' || value === null) return null;
  for (const [name, inner] of Object.entries(value)) {
    const here = `${path}${Array.isArray(value) ? `[${name}]` : `.${name}`}`;
    if (!Array.isArray(value) && SECRET_NAME.test(name)) return here;
    const deeper = findSecret(inner, here);
    if (deeper) return deeper;
  }
  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
