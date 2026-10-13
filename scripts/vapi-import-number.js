// Brings a firm's Twilio number into Vapi and answers it with the firm's
// agent, using a Twilio API key rather than the account's auth token: the
// auth token signs Twilio's requests to the Worker, so it stays with the
// Worker alone. Vapi's dashboard takes only the auth token, so this uses
// Vapi's API.
//
//   node scripts/vapi-import-number.js <number> <Twilio account id> <assistant id>           shows what would be sent
//   node scripts/vapi-import-number.js <number> <Twilio account id> <assistant id> --apply   brings it in
//
// Run on Greg's own machine only, when he asks for it (CLAUDE.md). The keys
// come from the environment and are never printed or written anywhere:
// VAPI_API_KEY (Vapi's private key), TWILIO_API_KEY and TWILIO_API_SECRET
// (a Twilio API key made for Vapi).
//
// smsEnabled is false, so Vapi leaves the number's messaging webhook alone:
// texts go to the Worker's /twilio/texts, set in Twilio's console. The number
// has no server address of its own, so Vapi sends the call's report to the
// agent's server, the Worker. It refuses a number Vapi already has.

import { SECRET_NAME } from './vapi-settings.js';

const API = 'https://api.vapi.ai';
const UK_NUMBER = /^\+44\d{10}$/;
const TWILIO_ACCOUNT = /^AC[0-9a-f]{32}$/;
const TWILIO_KEY = /^SK[0-9a-f]{32}$/;
const VAPI_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const [number, account, assistant, ...rest] = process.argv.slice(2);
const apply = rest.includes('--apply');
if (!number || !account || !assistant || rest.some((arg) => arg !== '--apply')) {
  fail('Usage: node scripts/vapi-import-number.js <number, such as +447700900001> <Twilio account id> <assistant id> [--apply]');
}
if (!UK_NUMBER.test(number)) fail('The number must be a UK number written as +44 and ten digits.');
if (!TWILIO_ACCOUNT.test(account)) fail('The Twilio account id must be AC and 32 letters and digits.');
if (!VAPI_ID.test(assistant)) fail('The assistant id is not one of Vapi\'s ids.');

const vapiKey = process.env.VAPI_API_KEY;
const twilioKey = process.env.TWILIO_API_KEY?.trim();
const twilioSecret = process.env.TWILIO_API_SECRET?.trim();
if (!vapiKey) fail('VAPI_API_KEY is not set.');
if (!twilioKey || !TWILIO_KEY.test(twilioKey)) fail('TWILIO_API_KEY is not set, or is not SK and 32 letters and digits.');
if (!twilioSecret || twilioSecret.length < 32) fail('TWILIO_API_SECRET is not set, or is too short to be one.');

const agent = await vapi('GET', `/assistant/${assistant}`);
const held = await vapi('GET', '/phone-number?limit=1000');
if (!Array.isArray(held)) fail('Vapi\'s list of numbers was not a list. Nothing was sent.');
const already = held.find((entry) => entry.number === number);
if (already) fail(`Vapi already has ${number}, as ${already.id}. Nothing was sent.`);

const body = {
  provider: 'twilio',
  number,
  twilioAccountSid: account,
  twilioApiKey: twilioKey,
  twilioApiSecret: twilioSecret,
  smsEnabled: false,
  assistantId: assistant,
};

if (!apply) {
  console.log(`Would bring ${number} into Vapi, answered by "${agent.name}" (run again with --apply to do it):\n${print(body)}`);
} else {
  const made = await vapi('POST', '/phone-number', body);
  const readBack = await vapi('GET', `/phone-number/${made.id}`);
  console.log(`Brought in, as ${made.id}. Read back from Vapi:\n${print(readBack)}`);
  const wrong = [
    readBack.number !== number && 'number',
    readBack.assistantId !== assistant && 'assistantId',
    readBack.smsEnabled !== false && 'smsEnabled',
    (readBack.server !== undefined || readBack.serverUrl !== undefined) && 'a server address',
  ].filter(Boolean);
  if (wrong.length > 0) {
    console.log(`\nNot as asked: ${wrong.join(', ')}`);
    process.exitCode = 1;
  }
}

async function vapi(method, path, sent) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
      body: sent === undefined ? undefined : JSON.stringify(sent),
    });
  } catch (error) {
    fail(`${method} ${path} failed to reach Vapi (${String(error)}). If it says "fetch failed", set NODE_OPTIONS=--dns-result-order=ipv4first and run again.`);
  }
  const answer = await response.json().catch(() => null);
  if (!response.ok) fail(`${method} ${path} was refused: HTTP ${String(response.status)}\n${print(answer)}`);
  return answer;
}

/** Pretty JSON, with any field whose name looks like a secret hidden. */
function print(value) {
  return JSON.stringify(
    value,
    (name, inner) => (name && SECRET_NAME.test(name) && typeof inner === 'string' ? '(hidden)' : inner),
    2,
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
