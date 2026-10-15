// Deliberate mistakes, for the check in eslint.config.js that keeps Vapi
// reached only through src/providers/vapi/, so every change to a firm's agent
// goes through the push's checks (src/agent-push.ts). Nothing runs this file:
// lint reads it.
//
// Each mistake carries a comment that turns its rule off for the next line.
// A comment that turns off nothing fails `npm run check`, so if the check
// ever stops catching one of these, the check goes red.

export async function mistakes(assistant: string): Promise<unknown[]> {
  // eslint-disable-next-line frontline/vapi-outside-provider -- deliberate: Vapi's own address
  const read = await fetch('https://api.vapi.ai/assistant');

  // eslint-disable-next-line frontline/vapi-outside-provider -- deliberate
  const address = `https://api.vapi.ai/assistant/${assistant}`;
  return [read, address];
}

// Not mistakes: these must pass, so the check does not get in the way of
// ordinary words about Vapi.
export function notMistakes(): string[] {
  return ['Vapi answers the calls.', 'dashboard.vapi.ai is where Greg looks at an agent.'];
}
