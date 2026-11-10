// Read before ../39/helpers.ts clears every DEEP_* variable: the live file imports this first (README: How to run).
export const OPTED = process.env.DEEP_LIVE_1023 === '1';
/** The three live sessions' IDs, comma-separated, in the order they were ended. */
export const LIVE_SESSIONS = (process.env.DEEP_LIVE_1023_SESSIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
/** Your real HOME, whose installed hub the live file reads, read-only. */
export const REAL_HOME = process.env.HOME ?? '';
