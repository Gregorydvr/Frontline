// The demo firm's texts in plain text, for /local/texts on this machine only:
// what went out through the stand-in, what was not sent and why, and what came
// in. For checking the record by eye. Staff see texts in the control room
// (/control).

import { instantFromIso } from '../clock';
import { clock24, shortDate } from '../london';
import { getCustomer, getOwner, listMessagesBetween, listTextsInBetween } from '../record';
import type { RecordDb } from '../record/db';
import type { FirmId, Message } from '../record/types';

const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

export async function showTexts(db: RecordDb, firm: FirmId): Promise<string> {
  const lines = ['TEXTS OUT', ''];
  const out = await listMessagesBetween(db, firm, ...allTime);
  if (out.length === 0) {
    lines.push('  None yet.');
  }
  for (const message of out) {
    lines.push(
      `  ${shortDate(message.createdAt)}  ${clock24(message.createdAt)}  ${message.kind} to ${await who(db, firm, message)}: ${stateOf(message)}`,
    );
    if (message.words !== null) {
      lines.push(`    ${message.words}`, `    (${String(message.segments)} segment${message.segments === 1 ? '' : 's'})`);
    }
  }
  lines.push('', 'TEXTS IN', '');
  const came = await listTextsInBetween(db, firm, ...allTime);
  if (came.length === 0) {
    lines.push('  None yet.');
  }
  for (const text of came) {
    lines.push(
      `  ${shortDate(text.receivedAt)}  ${clock24(text.receivedAt)}  from ${text.customer?.name ?? text.from ?? 'no number'}`,
      `    ${text.words}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function who(db: RecordDb, firm: FirmId, message: Message): Promise<string> {
  if (message.to.kind === 'owner') {
    return `the owner, ${(await getOwner(db, firm, message.to.owner))?.name ?? '?'}`;
  }
  return (await getCustomer(db, firm, message.to.customer))?.name ?? '?';
}

function stateOf(message: Message): string {
  return message.reason === null ? message.state : `${message.state} (${message.reason})`;
}
