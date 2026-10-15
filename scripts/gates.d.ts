// Types for scripts/gates.js, for the tests.

export interface GateAnswer {
  status: number;
  location: string | null;
  robots: string | null;
  body: string | null;
}

export const NOBODYS_TOKEN: string;

export function judgeGates(answers: { links: GateAnswer; app: GateAnswer; control: GateAnswer }): { ok: boolean; line: string }[];
