// Reading Vapi's report as a call ends (src/vapi-report.ts). The example
// reports follow the shape of ServerMessageEndOfCallReport in Vapi's server
// kit, @vapi-ai/server-sdk 2.0.1.

import { describe, expect, it } from 'vitest';
import { instantFromIso } from '../src/clock';
import { readVapiMessage, text } from '../src/vapi-report';
import { report, REPORTS, withDetails } from './helpers/vapi';

describe('readVapiMessage', () => {
  it('reads the urgent call: the call’s id, the numbers, the times, the details and the transcript', () => {
    expect(readVapiMessage(REPORTS['mr-price-leak'])).toEqual({
      kind: 'report',
      report: {
        providerCallId: '2a7d4b63-9f58-4c2e-8b40-1d8f3e6c9b72',
        firmNumber: '+447700900100',
        from: { kind: 'mobile', number: '+447700900016' },
        startedAt: instantFromIso('2026-10-15T11:02:10.480+01:00'),
        endedAt: instantFromIso('2026-10-15T11:04:45.233+01:00'),
        details: {
          callerType: 'customer',
          name: 'Mr Price',
          about: 'Leak under the sink',
          address: '6 Bridge Street',
          summary: 'A leak under the kitchen sink.',
          urgentMatch: 'a leak',
        },
        transcript: REPORTS['mr-price-leak'].message.artifact.transcript,
      },
    });
  });

  it('reads a caller who is not a customer', () => {
    const message = readVapiMessage(REPORTS.supplier);
    expect(message).toMatchObject({
      report: {
        from: { kind: 'mobile', number: '+447700900300' },
        details: { callerType: 'other', whoRang: 'a supplier', summary: 'Your order is ready to collect.' },
      },
    });
  });

  it('reads a landline, and a withheld number', () => {
    expect(readVapiMessage(REPORTS['landline-caller'])).toMatchObject({
      report: { from: { kind: 'landline', number: '+441632960001' } },
    });
    expect(readVapiMessage(REPORTS['withheld-caller'])).toMatchObject({ report: { from: { kind: 'withheld' } } });
  });

  it('reads a report without details as having none', () => {
    expect(readVapiMessage(REPORTS['hang-up'])).toMatchObject({ report: { details: null } });
  });

  it('takes the numbers and times from the call when the report itself leaves them out', () => {
    const body = report('supplier');
    const call = body.message.call as Record<string, unknown>;
    call.phoneNumber = body.message.phoneNumber;
    delete body.message.phoneNumber;
    delete body.message.customer;
    delete body.message.startedAt;
    expect(readVapiMessage(body)).toMatchObject({
      report: {
        firmNumber: '+447700900100',
        from: { kind: 'mobile', number: '+447700900300' },
        startedAt: instantFromIso('2026-10-15T08:26:05.120+01:00'),
      },
    });
  });

  it('gives no firm number for a number rung that is not a UK mobile', () => {
    expect(readVapiMessage(report('supplier', '+441632960999'))).toMatchObject({ report: { firmNumber: null } });
  });

  it('counts each detail that fails its check as missing, and keeps the others', () => {
    const body = withDetails(report('mr-price-leak'), (data) => ({
      ...data,
      name: ['Mr Price'],
      about: '   ',
      address: 'Flat 2\n6 Bridge Street',
      summary: 'Bell\u0007',
      urgentMatch: null,
    }));
    expect(readVapiMessage(body)).toMatchObject({
      report: {
        details: {
          callerType: 'customer',
          name: null,
          about: null,
          address: 'Flat 2 6 Bridge Street',
          summary: null,
          urgentMatch: null,
        },
      },
    });
  });

  it('drops a transcript that is empty or far too long', () => {
    for (const transcript of ['  ', 'x'.repeat(100_001)]) {
      const body = report('supplier');
      (body.message.artifact as Record<string, unknown>).transcript = transcript;
      expect(readVapiMessage(body)).toMatchObject({ report: { transcript: null } });
    }
  });

  it('leaves alone the kinds of message nothing here acts on', () => {
    expect(readVapiMessage({ message: { type: 'status-update', status: 'ended' } })).toEqual({ kind: 'other' });
    expect(readVapiMessage({ message: { type: 'transcript', transcript: 'Hello' } })).toEqual({ kind: 'other' });
  });

  it.each([
    ['nothing', null],
    ['no message', { type: 'end-of-call-report' }],
    ['a message with no type', { message: {} }],
    ['a report with no call', { message: { type: 'end-of-call-report' } }],
    ['a report whose call has no id', { message: { type: 'end-of-call-report', call: { id: '' } } }],
    ['a list', [{ message: { type: 'end-of-call-report' } }]],
  ])('finds %s unreadable', (_, body) => {
    expect(readVapiMessage(body)).toEqual({ kind: 'unreadable' });
  });
});

describe('text', () => {
  it('makes text one line, and refuses empty, too long, or not text', () => {
    expect(text('  No hot\n water. ', 20)).toBe('No hot water.');
    expect(text('', 20)).toBeNull();
    expect(text('x'.repeat(21), 20)).toBeNull();
    expect(text(42, 20)).toBeNull();
    expect(text('Bell\u0007', 20)).toBeNull();
  });
});
