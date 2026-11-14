/**
 * The list's sections, as deep status has always listed them (#19): what needs you, is stuck or is flagged, then what
 * works, then what finished, then the quiet ones, so no number of working sessions pushes one that needs you down.
 */
export const SECTION: Record<string, number> = {
  'needs you': 0, stuck: 0, flagged: 0, BLOCKED: 0, INVALID: 0, INCONCLUSIVE: 0, stale: 0,
  'sent back': 1, 'says done': 1, working: 1, queued: 1, PASS: 2, finished: 2, quiet: 3,
};
