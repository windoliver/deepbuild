// AC3: a commit offer is in scope only when none of the rule files the rules page reads reserves commits (README).
//
// #84's sort world and Claude Code session (tests/acceptance/84/sort, imported by path), run twice, each on a hub of
// its own. The session's working folder is packages/x, a subfolder of the repo. You ask it a question, which opens no
// task; it edits the folder's README, which makes its stop a claim the hub judges, and ends its turn on "Want me to
// commit this?". The line "Never commit unless I ask" is first in the repo's root AGENTS.md, then, in turn, in the
// user-level Codex file ~/.codex/AGENTS.md and nowhere else. Each time no "proceed" by rule commit-not-reserved may be
// sent, in the stop's reply or on the record, and the offer must go to the authority path: an authority ask naming
// it. On the base only ~/.claude/CLAUDE.md and the session's own folder are read, so both times the offer is answered
// "proceed" by rule commit-not-reserved.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { Session, asksNaming, cleanup, lastPos, makeWorld, proceededIn, replyText, settle, startHub, verdict, type Ev, type Hub } from '../84/sort/helpers.ts';

const AC3 = 'AC3 #2120.5a379749';
const OFFER = 'Want me to commit this?';
const RESERVES = '# Rules\n\n- Never commit unless I ask\n';
const ROOT = "the repo's root AGENTS.md";
const CODEX = 'the user-level Codex file ~/.codex/AGENTS.md';
const SUBFOLDER = join('packages', 'x');
const README = { from: 'The x package.', to: "The x package holds the shop's helpers." };

afterAll(cleanup, 60_000);

const stopped = async (hub: Hub): Promise<void> => {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, new Promise((done) => setTimeout(done, 30_000))]);
};

interface Offered { 'proceeds on the record': string[]; 'the reply names commit-not-reserved': boolean; 'an authority ask names the offer': boolean }
/** What became of the offer with the line reserving commits in `where`: the record's proceeds, the stop's reply, the asks. */
async function offered(where: typeof ROOT | typeof CODEX): Promise<Offered> {
  const w = makeWorld({ files: { [join(SUBFOLDER, 'README.md')]: `${README.from}\n`, ...(where === ROOT ? { 'AGENTS.md': RESERVES } : {}) } });
  if (where === CODEX) {
    mkdirSync(join(w.home, '.codex'), { recursive: true });
    writeFileSync(join(w.home, '.codex', 'AGENTS.md'), RESERVES);
  }
  const hub = await startHub(w);
  try {
    // The session's working folder is the subfolder: its hooks' cwd, its transcript's project and CLAUDE_PROJECT_DIR.
    const s = new Session({ ...w, repo: join(w.repo, SUBFOLDER) });
    await s.start();
    await s.typed("Is the x package's README clear?");
    await s.edit('README.md', README.from, README.to);
    const since = await lastPos(hub);
    const stop = await s.stop(`I made the README say what the package holds. ${OFFER}`);
    const authority = (all: Ev[]) => asksNaming(all, since, OFFER).filter((e) => e.data.kind === 'authority');
    const events = await settle(hub, (all) => proceededIn(all, s, since).length > 0 || authority(all).length > 0, 15_000);
    return {
      'proceeds on the record': proceededIn(events, s, since).map((e) => `${String(e.data.rule)}: ${String(e.data.question)}`),
      'the reply names commit-not-reserved': replyText(stop).includes('commit-not-reserved'),
      'an authority ask names the offer': authority(events).length > 0,
    };
  } finally {
    await stopped(hub);
  }
}

test(`${AC3} a session in a subfolder ends its turn on "${OFFER}" while the repo's root AGENTS.md, and in turn the user-level Codex file, says "Never commit unless I ask": no proceed by rule commit-not-reserved is sent and the offer goes to the authority path`, async (ctx) => verdict(ctx, async () => {
  const readings = { [ROOT]: await offered(ROOT), [CODEX]: await offered(CODEX) };
  const held: Offered = { 'proceeds on the record': [], 'the reply names commit-not-reserved': false, 'an authority ask names the offer': true };
  expect(readings, `${AC3} with "Never commit unless I ask" in ${ROOT}, and in turn in ${CODEX}, a session in ${SUBFOLDER} that ends on "${OFFER}" gets no proceed by rule commit-not-reserved, and the offer goes to an authority ask`)
    .toEqual({ [ROOT]: held, [CODEX]: held });
}), 900_000);
