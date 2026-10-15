// What `npm run practice:gates` checks (scripts/gates.js): a customer's link
// opens with no Cloudflare Access login, and the owner's app and the control
// room do not. The script itself reaches the network, so it is not run here;
// how it judges the answers is, with answers shaped as practice gave them on
// 15 Oct 2026.

import { describe, expect, it } from 'vitest';
import { judgeGates, NOBODYS_TOKEN, type GateAnswer } from '../scripts/gates.js';
import { isId } from '../src/ids';

const ACCESS = 'https://front-line.cloudflareaccess.com/cdn-cgi/access/login/practice-control.example?redirect_url=%2F';
const expired: GateAnswer = { status: 404, location: null, robots: 'noindex, nofollow', body: '<h1>This link has expired</h1>' };
const toAccess: GateAnswer = { status: 302, location: ACCESS, robots: null, body: null };
const fine = { links: expired, app: toAccess, control: toAccess };
const failed = (answers: typeof fine) => judgeGates(answers).filter((check) => !check.ok).map((check) => check.line);

describe('the gates in front of practice', () => {
  it('pass as practice answers today', () => {
    expect(failed(fine)).toEqual([]);
  });

  it('fail when a customer’s link is sent to the Access login', () => {
    expect(failed({ ...fine, links: { ...toAccess, robots: 'noindex' } })).toEqual([
      'A customer\'s link opens with no Access login: Front-line answered 302, sent to Access.',
    ]);
  });

  it('fail when the link page does not tell search engines to keep out', () => {
    expect(failed({ ...fine, links: { ...expired, robots: null } })).toEqual(['Search engines are told to keep out of customers\' links: nothing said.']);
  });

  it('fail when the owner’s app or the control room opens with no Access login', () => {
    expect(failed({ ...fine, app: expired, control: { status: 200, location: null, robots: null, body: '' } })).toEqual([
      'The owner\'s app sends anyone with no Access login to Access: 404.',
      'The control room sends anyone with no Access login to Access: 200.',
    ]);
  });

  it('do not count a redirect somewhere other than Access, or one that is not an address', () => {
    expect(failed({ ...fine, control: { ...toAccess, location: 'https://cloudflareaccess.com.example/login' } })).toHaveLength(1);
    expect(failed({ ...fine, app: { ...toAccess, location: 'not an address' } })).toHaveLength(1);
  });

  it('ask with a token that has the form of a real one, so the page is not refused for its shape', () => {
    expect(isId(NOBODYS_TOKEN)).toBe(true);
  });
});
