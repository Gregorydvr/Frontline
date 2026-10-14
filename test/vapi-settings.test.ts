import { describe, expect, it } from 'vitest';
import { settingsProblem } from '../scripts/vapi-settings.js';
import { readVapiMessage } from '../src/vapi-report';
import { report, withDetails } from './helpers/vapi';
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
