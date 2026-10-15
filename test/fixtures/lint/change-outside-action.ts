// Deliberate mistakes, for the check in eslint.config.js that keeps every
// action going through act() in src/actions.ts (task 4 of docs/autopilot.md):
// a route reads the record, and changes it only by a named action. Lint reads
// this file as if it were one of the routes. Nothing runs it.
//
// Each mistake carries a comment that turns its rule off for the next line.
// A comment that turns off nothing fails `npm run check`, so if the check
// ever stops catching one of these, the check goes red.
//
// The paths lead to src/ from here, as a route's lead to the same files.

// eslint-disable-next-line no-restricted-imports -- deliberate: a change to the record, past act()
import { setUrgentList } from '../../../src/record';
// eslint-disable-next-line no-restricted-imports -- deliberate: from the record's own file
import { markLeaving } from '../../../src/record/firm-file';
// eslint-disable-next-line no-restricted-imports -- deliberate: a step that changes the record
import { pushAgent } from '../../../src/agent-push';

// Not mistakes: reading the record, and logging a view, are a route's own.
import { getFirm, listOwners, logStaff } from '../../../src/record';

export const used = [setUrgentList, markLeaving, pushAgent, getFirm, listOwners, logStaff];
