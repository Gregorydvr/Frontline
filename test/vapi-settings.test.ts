import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { settingsProblem } from '../scripts/vapi-settings.js';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { openRecord } from '../src/record/db';
import { readVapiMessage } from '../src/vapi-report';
import { TOOL_NAMES } from '../src/vapi-tools';
import { testDeps } from './helpers/deps';
import { report, sendTool, tidewell, toolAnswer, toolCall, withDetails } from './helpers/vapi';
import practice from '../vapi/practice-assistant.json';

// scripts/vapi-assistant.js refuses a settings file that holds a key, token,
// secret or password, before it sends anything to Vapi (rule 12 in CLAUDE.md).
// The values here are made up; what matters is the name of the field.
const made = 'x'.repeat(40);

describe('settingsProblem', () => {
  it('lets the settings for the practice agent through', () => {
    expect(settingsProblem(practice)).toBeNull();
  });

  it('lets a server named by its credential id through', () => {
    expect(settingsProblem({ server: { url: 'https://example.test/vapi/server', credentialId: 'an-id' } })).toBeNull();
  });

  it.each([
    [{ secret: made }, '.secret'],
    [{ server: { secret: made } }, '.server.secret'],
    [{ server: { headers: { Authorization: `Bearer ${made}` } } }, '.server.headers.Authorization'],
    [{ credentials: [{ authenticationPlan: { type: 'bearer', token: made } }] }, '.credentials[0].authenticationPlan.token'],
    [{ model: { tools: [{ server: { url: 'https://example.test', secret: made } }] } }, '.model.tools[0].server.secret'],
    [{ apiKey: made }, '.apiKey'],
    [{ api_key: made }, '.api_key'],
    [{ PASSWORD: made }, '.PASSWORD'],
    [{ voice: { providerToken: made } }, '.voice.providerToken'],
    [{ secretAccessKey: { not: 'a string' } }, '.secretAccessKey'],
  ])('refuses %j, naming %s', (settings, path) => {
    expect(settingsProblem(settings)).toBe(`The settings file has ${path}. Keys and secrets stay out of the repository.`);
  });

  it('never quotes the secret it found', () => {
    expect(settingsProblem({ server: { secret: made } })).not.toContain(made);
  });

  it.each([null, [], [{ firstMessage: 'Hello.' }], 'Hello.', 7])('refuses %j, which is not one object', (settings) => {
    expect(settingsProblem(settings)).toBe('The settings file must hold one JSON object.');
  });
});

describe('the practice agent’s schema', () => {
  const properties = practice.analysisPlan.structuredDataPlan.schema.properties;

  it('names exactly the details Front-line reads from a call', () => {
    const filled = { name: 'Mrs Hall', about: 'Boiler service', address: '12 Kiln Lane', postcode: 'ZZ3 9HT', summary: 'Due a service.', urgentMatch: 'a leak', whoRang: 'a supplier' };
    const read = (callerType: string) => {
      const message = readVapiMessage(withDetails(report('landline-caller'), () => ({ ...filled, callerType })));
      return message.kind === 'report' ? Object.keys(message.report.details ?? {}) : [];
    };
    const readByFrontline = new Set([...read('customer'), ...read('other')]);
    expect(new Set(Object.keys(properties))).toEqual(readByFrontline);
  });

  it('asks for the first line and the postcode as separate fields', () => {
    expect(properties.address.description).toContain('Not the postcode.');
    expect(properties.postcode.type).toBe('string');
  });
});

/** One of the agent's tools, as the settings file holds it. */
interface AgentTool {
  type: string;
  async?: boolean;
  messages?: { type: string; content?: string; blocking?: boolean }[];
  function: { name: string; parameters: { properties: Record<string, unknown>; required?: string[] } };
  server: { url: string; credentialId: string };
}

describe('the practice agent’s tools', () => {
  const tools = practice.model.tools as readonly AgentTool[];
  const clock = pretendClock(instantFromIso('2026-09-28T11:14:00+01:00'));
  const db = openRecord(env.DB, clock);
  const deps = testDeps(clock);
  const app = createApp(() => deps);
  const number = '+447700900150';

  /** Uses one of the file's tools as Vapi would: its name, at its address, with the arguments given. */
  async function use(tool: AgentTool, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const address = new URL(tool.server.url).pathname;
    if (address !== '/vapi/free-times' && address !== '/vapi/book') throw new Error(`${tool.function.name} goes to ${address}`);
    const body = toolCall(address === '/vapi/book' ? 'book' : 'free-times', args, { to: number, callId: 'practice-agent-tools' });
    const [call] = body.message.toolCallList as { function: { name: string } }[];
    if (call === undefined) throw new Error('No tool call');
    call.function.name = tool.function.name;
    return toolAnswer(await sendTool(app, address, body));
  }

  function named(name: string): AgentTool {
    const tool = tools.find((one) => one.function.name === name);
    if (tool === undefined) throw new Error(`No tool named ${name}`);
    return tool;
  }

  it('are exactly Front-line’s two, on the same server as the reports, with the same credential, and the agent waits for each', () => {
    expect(tools.map((tool) => tool.function.name).sort()).toEqual(Object.values(TOOL_NAMES).sort());
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.async).toBeUndefined();
      expect(new URL(tool.server.url).origin).toBe(new URL(practice.server.url).origin);
      expect(tool.server.credentialId).toBe(practice.server.credentialId);
    }
  });

  it('each say a line of their own as they start, without holding the call up, and another if Front-line does not answer', () => {
    for (const tool of tools) {
      const start = tool.messages?.find((message) => message.type === 'request-start');
      const failed = tool.messages?.find((message) => message.type === 'request-failed');
      expect(start?.content).toBeTruthy();
      expect(start?.blocking).toBe(false);
      expect(failed?.content).toBeTruthy();
    }
  });

  it('ask for the times on a day and book one, with the names, arguments and addresses the Worker reads', async () => {
    await tidewell(db, number);
    const freeTimes = named(TOOL_NAMES.freeTimes);
    const book = named(TOOL_NAMES.book);
    // The day goes by the name the file gives it: a name the Worker does not
    // read would give the times from tomorrow, not from Thursday.
    const [day, ...moreForFreeTimes] = Object.keys(freeTimes.function.parameters.properties);
    expect(day).toBeDefined();
    expect(moreForFreeTimes).toEqual([]);
    expect(freeTimes.function.parameters.required ?? []).toEqual([]);
    const answer = await use(freeTimes, { [day ?? '']: '2026-10-01' });
    const times = answer.times as { start: string; say: string }[];
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time.start.startsWith('2026-10-01T')).toBe(true);

    const [start, ...moreForBook] = Object.keys(book.function.parameters.properties);
    expect(start).toBeDefined();
    expect(moreForBook).toEqual([]);
    expect(book.function.parameters.required).toEqual([start]);
    const chosen = times[0];
    if (chosen === undefined) throw new Error('No time');
    expect(await use(book, { [start ?? '']: chosen.start })).toEqual({ booked: true, start: chosen.start, say: chosen.say, text: true });
  });

  it('are named in the instructions, which give today’s date in UK time and never Vapi’s own date, which is UTC', () => {
    const [system] = practice.model.messages;
    const instructions = system?.content ?? '';
    for (const name of Object.values(TOOL_NAMES)) expect(instructions).toContain(name);
    expect(instructions).toContain('{{"now" | date: "%Y-%m-%d", "Europe/London"}}');
    for (const filled of instructions.match(/\{\{[^}]*\}\}/g) ?? []) expect(filled).toContain('"Europe/London"');
  });
});
