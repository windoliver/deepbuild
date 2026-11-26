// #1866 AC3: 1,000 revisions of one document presented through a real hub while no app is connected, then the app's first
// `canvas.drawn`: that document's newest revision only. The merge base is the wrong program: it hands over the history,
// 1,000 entries. Each revision is a whole document of one item, shown on the CLI's connection (`canvas.show`, what
// `deep show` calls: the same presentation as deep_show's), with no snapshot asked for and a panel of 64 x 48 px (#806's
// world file). The hub, its canvas core and the record are real (#806's and #26's helpers); no app and no replica runs, and
// no app connection opens before the one the test reads.
//
// The hub's canvas core plays every call it kept again for each new one (crates/deep-show/src/canvas_side.rs), so one core
// would take hours over 1,000 revisions. When its core ends, the hub starts another, which opens the document from the
// record (#1721): the test ends it, by its PID, every CORE_CALLS revisions. What the hub presented stays the hub's own.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeHome, startHub, t26, t393, World, type JsonObject, type Line } from '../806/helpers.ts';
import { AC3, MINUTE } from './helpers.ts';

afterEach(cleanup, MINUTE);

const REVISIONS = 1000;
const CORE_CALLS = 40;
const SIZE: [number, number] = [64, 48];

/** One item, somewhere else in each revision. */
const revision = (n: number): JsonObject => t393.board('Revisions', SIZE, [t393.rect('mark', 'Mark', [n % 50, Math.floor(n / 50), 8, 8], 'a0')]);
/** Whether the hub answered that its canvas core ended under the call: nothing of it is recorded, and its next call starts another. */
const coreEnded = (reply: Line): boolean => reply.error?.code === 'unavailable' && /exited/.test(String(reply.error.remediation));
/** The document shown once more, as its revision `rev`; a call the hub's core ended under is made again at that answer. */
async function present(cli: t26.Conn, doc: string, rev: number): Promise<void> {
  const show = (): Promise<Line> => cli.call('canvas.show', { doc, document: JSON.stringify(revision(rev)), include: ['issues'] }, 2 * MINUTE);
  let reply = await show();
  for (const until = Date.now() + 2 * MINUTE; coreEnded(reply) && Date.now() < until;) reply = await show();
  expect([reply.result?.outcome, reply.result?.rev], `BLOCKED: revision ${rev} of ${doc} is presented (a deep-show in target/ built before #1721 counts from 1 again when the core starts again: build this checkout's): ${JSON.stringify(reply.error ?? reply.result).slice(0, 600)}`).toEqual(['presented', rev]);
}
/**
 * Ends the hub's canvas core, the hub's own child, by its PID, where it runs one. The next call either still reaches it, is
 * answered that it ended, or starts another: `present` takes each.
 */
function endCore(hub: t26.Hub): void {
  const table = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const cores = table.split('\n').map((row) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row)).filter((m) => m && Number(m[2]) === hub.pid && /deep-show canvas\s*$/.test(m[3]!)).map((m) => Number(m![1]));
  for (const pid of cores) process.kill(pid, 'SIGTERM');
}
/** What an app takes: the presented revisions `canvas.drawn` hands it, as [document, revision]. */
async function drawn(app: t26.Conn): Promise<[string, number][]> {
  const reply = await app.call('canvas.drawn', {}, 2 * MINUTE);
  expect(reply.error, 'canvas.drawn is answered').toBeUndefined();
  return ((reply.result as Line).presented as Line[]).map((p): [string, number] => [String(p.doc), Number(p.rev)]);
}

describe(`${AC3} With 1,000 revisions of one document presented while no app is connected, the app's first \`canvas.drawn\` returns that document's newest revision only. A hub that hands over the history returns 1,000 entries and fails this test`, () => {
  it(`${AC3} the app's first canvas.drawn returns one entry of the document, its newest revision, beside the one of a document shown after it; then only what is presented later`, async () => {
    const { tmp, home } = makeHome();
    const [doc, other] = [t26.ulid(), t26.ulid()];
    const world = new World(join(tmp, 'world.json'), { panels: { main: { rect: [0, 0, ...SIZE] } }, docs: { [doc]: { panel: 'main' }, [other]: { panel: 'main' } } });
    const hub = await startHub(home, { world: world.path });
    const cli = await t26.control(hub);
    const t0 = performance.now();
    for (let rev = 1; rev <= REVISIONS; rev++) {
      await present(cli, doc, rev);
      // Never before another document's first show: the hub reads that one's revisions while the core may be ending.
      if (rev % CORE_CALLS === 0 && rev < REVISIONS) endCore(hub);
    }
    console.log(`#1866 AC3: ${REVISIONS} revisions presented in ${Math.round((performance.now() - t0) / 1000)} s`);
    // Another document, shown once after: the newest revision of each shown document is what an app that connects takes.
    await present(cli, other, 1);
    // The world really presented them: the record holds each revision, so a short answer below is the hub's letting go.
    const recorded = (await t26.events(hub)).filter((e) => e.kind === 'doc.patched' && e.data.doc === `doc:${doc}`).map((e) => Number(e.data.rev));
    expect(recorded, 'BLOCKED: the record holds every revision, presented in order').toEqual(Array.from({ length: REVISIONS }, (_, i) => i + 1));

    const token = readFileSync(join(t26.rootOf(home), 'control.token'), 'utf8').trim();
    const { conn: app, answer } = await t26.Conn.open(hub.socket, { hello: 'app', token });
    expect(answer?.role, 'BLOCKED: the hub takes the app\'s hello').toBe('app');
    const first = await drawn(app);
    const of = (id: string): number[] => first.filter(([d]) => d === id).map(([, rev]) => rev);
    expect(of(doc).length, `the app's first canvas.drawn returns ${doc}'s newest revision only; it returned ${of(doc).length} entries of it, revisions ${of(doc).slice(0, 3).join(', ')} … ${of(doc).at(-1)}`).toBe(1);
    expect(of(doc), 'and the one entry is its newest revision').toEqual([REVISIONS]);
    expect(of(other), 'each shown document\'s newest revision is taken: the other document\'s one revision too').toEqual([1]);

    // Taken, they aren't handed over again: the next answer holds only what was presented since.
    expect(await drawn(app), 'nothing was presented since the app\'s first canvas.drawn').toEqual([]);
    await present(cli, doc, REVISIONS + 1);
    expect(await drawn(app), 'one revision was presented since').toEqual([[doc, REVISIONS + 1]]);
    app.close();
    cli.close();
  }, 30 * MINUTE);
});
