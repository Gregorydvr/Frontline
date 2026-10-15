// Types for scripts/call-report-text.js, for the tests.

import type { CallReportForStaff } from '../src/call-report';

export interface VapiCallSummary {
  id: string | null;
  startedAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  caller: 'mobile' | 'landline' | 'withheld';
  dateLine: string | null;
  tools: {
    name: string;
    secondsIn: number | null;
    argumentsAs: 'text' | 'object' | 'none';
    arguments: unknown;
    answer: unknown;
  }[];
  detailsGiven: string[];
  callerType: string | null;
  urgentMatch: string | null;
}

export interface BookingSummary {
  freeTimes: { secondsIn: number | null; day: string | null; times: { start: string; say: string }[] | null }[];
  bookVisit: {
    secondsIn: number | null;
    start: string | null;
    result: 'booked' | 'taken' | 'not_offered' | 'unreadable' | 'no_answer' | (string & {});
    say: string | null;
    text: boolean | null;
  }[];
}

export declare function readOnly(method: string): 'GET';
export declare function firmFromSettings(settings: unknown): string | null;
export declare function numberKind(number: unknown): 'mobile' | 'landline' | 'withheld';
export declare function summariseVapiCall(call: unknown): VapiCallSummary;
export declare function bookingSummary(vapi: VapiCallSummary): BookingSummary;
export declare function bookingLines(vapi: VapiCallSummary, frontline: CallReportForStaff | null): string[];
export declare function conversation(call: unknown): string[];
export declare function crossCheck(vapi: VapiCallSummary, frontline: CallReportForStaff | null): string[];
export declare function reportLines(vapi: VapiCallSummary, frontline: CallReportForStaff | null, problems: readonly string[]): string[];
export declare function uk(value: unknown): string;
