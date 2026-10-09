// How long each thing held about a person is kept, in one place (slice H of
// docs/build-brief.md, rule 14 in CLAUDE.md). Where each comes from is in
// docs/decisions.md. The clock deletes each when its period runs out: a call's
// recording by its own row in the due list, everything else by the firm's
// daily sweep (src/record/keeping.ts). Periods are counted on the firm's own
// clock.

const DAY = 24 * 60 * 60_000;

export const PERIODS = {
  /** A call's recording, from the end of the call. The call, its summary and transcript stay with the job. */
  recording: 30 * DAY,
  /** How long the move of a recording from the inbox is still worth trying. */
  recordingMove: DAY,
  /** Anything left in the inbox, such as a second copy Vapi wrote. */
  inbox: DAY,
  /** An enquiry that never became a job (keeping.ts says what that is), from the last thing on it. */
  enquiryMonths: 12,
  /** What an owner wrote in Message us, from when they wrote it. */
  ownerMessageMonths: 12,
  /** A customer's link, from when it expires. */
  linkAfterExpiry: 0,
  /** An owner's login link, from when it expires. */
  loginLinkAfterExpiry: DAY,
  /** An owner's login, from when it ended. */
  sessionAfterEnd: DAY,
  /** A time held during a call, from its last change. */
  hold: 30 * DAY,
  /** A firm's export, from when it was made. It goes sooner if the firm is deleted. */
  firmExport: 30 * DAY,
  /** A leaving firm, from when staff said it is leaving, until the clock deletes it. */
  leaving: 30 * DAY,
  /** The staff log, from each row. A member of staff is kept while the log names them. */
  staffLogYears: 6,
  /** The restore ledger, a little longer than a restore can reach back (30 days). */
  ledger: 35 * DAY,
} as const;

/** The instant the same time of day a number of calendar months before, in UTC. */
export function monthsBefore(at: number, months: number): number {
  const date = new Date(at);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.getTime();
}
