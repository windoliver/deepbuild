// The wrong program the Proof names, planted in test code: a twin of the asks core that keeps only the newest 100
// stops of a session. It is made from packages/asks at the commit these tests were written against (BASE_COMMIT),
// with one edit where a stop is applied, so it stays the same program whatever the change or the merge base become.

import { asksAt, BASE_COMMIT, coreAt, type Core } from './helpers.ts';

/** How many of a session's stops the twin keeps. */
export const KEPT = 100;
/** The base's line that keeps a session's stop; the twin keeps it, then lets the oldest go past the newest KEPT. */
const KEEPS = '        this.stops.set(e.session, [...(this.stops.get(e.session) ?? []), stop]);\n';
const KEEPS_NEWEST = `        const kept = [...(this.stops.get(e.session) ?? []), stop];
        // #2653's planted wrong program: only the newest ${KEPT} stops of a session are kept, the rest let go from both tables.
        for (const gone of kept.splice(0, Math.max(0, kept.length - ${KEPT}))) this.stopIds.delete(gone.id);
        this.stops.set(e.session, kept);
`;

/** The asks core at BASE_COMMIT, keeping only the newest 100 stops of a session. */
export async function newestHundred(): Promise<Core> {
  const dir = asksAt(BASE_COMMIT, `newest-${KEPT}`, (file, text) => {
    if (file !== 'index.ts') return text;
    if (text.split(KEEPS).length !== 2) throw Error(`BLOCKED: the twin's edit doesn't apply: packages/asks/src/index.ts at ${BASE_COMMIT} keeps a stop elsewhere than one line`);
    return text.replace(KEEPS, KEEPS_NEWEST);
  });
  return coreAt(dir, `a core that keeps only the newest ${KEPT} stops of a session`);
}
