import { describe, expect, it } from 'vitest';
import { settingsProblem } from '../scripts/vapi-settings.js';
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
