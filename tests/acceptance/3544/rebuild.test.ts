// #3544, criteria one to five: a rebuild of the projections is a start the hub reports. Each test copies one record
// (47,500 events in a real file, the commits projection's columns planted to differ, so the hub's record replays the
// whole log at its open), starts a dev hub of its own on it with this checkout's CLI, `deep hub start --root`, in a
// scratch home, and judges what `deep hub start`, `deep hub status`, `deep doctor`, `deep`, the hub's health on its
// socket and the record's file show. The start's wait and the two planted folds are the settings README's Defined here
// names; the base reads neither, so there each test fails where it first needs the hub to say it is rebuilding.
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  AC, asksCounted, bash, cleanup, cleanupAll, columnsOf, countsOf, deep, deniedInItsWords, EVENTS, eventsAfter, exitOf, FOLD, GUARD, healthOf, HOLD_MS, hookRequest, hubLog,
  newSession, numbersIn, PAGES, PLANTED, plantedRecord, rebuildingOf, recorded, sendHook, sentences, SLOW, STALL, startHub, stopHub, STUCK, TABLE, throughDeepHook, tidy, WAIT, WAIT_MS, world,
  type Ended, type Obj, type Running, type Said, type Sent,
} from './helpers.ts';

// The record is built once, before the first test's own time runs; a test that finds it failed says why (BLOCKED).
beforeAll(() => plantedRecord().then(() => undefined, () => undefined), 600_000);
afterEach(cleanup, 180_000);
afterAll(cleanupAll, 180_000);

/** How long a start that should end is given before the test ends it: the ten held pages take 10 s and the replay its own time. */
const START_BOUND = 150_000;
/** The second criterion's deadline for a start on a replay that stands still: it gives up one 2 s wait after two held pages. */
const STALL_BOUND = 30_000;
/** How long a command that reads the hub is given to end: past the 25 s `deep hub status` waits on the merge base. */
const READER_BOUND = 30_000;
/** What a time read from two processes' output may be off by. */
const SLACK_MS = 250;
/** The fewest of the ten pages' counts a start must have printed, rising: it may miss one between two reads of the health. */
const RISES = 5;

const shown = (ran: Running, w: Parameters<typeof tidy>[1], last = 12): string => tidy(ran.text(last), w) || '(nothing)';

it(`${AC.start} deep hub start on a record whose replay a planted fold holds 1 s a page over ten pages, its wait set to 2 s, prints the rebuild sentence with a count that rises and exits 0 once the core answers`, async () => {
  const w = await world();
  const start = startHub(w, { [WAIT]: String(WAIT_MS), [FOLD]: SLOW });
  const ended = await start.ended(START_BOUND);
  start.end();
  const said = sentences(start);
  const counts = said.map((s) => s.replayed);
  const what = `deep hub start --root ${exitOf(start, ended)}, its wait ${WAIT}=${WAIT_MS} and the hub's fold ${FOLD}=${SLOW}, having printed ${said.length} rebuild sentences (events replayed: ${counts.join(', ') || 'none'}); its last lines:\n${shown(start, w)}`;
  console.log(`${AC.start} ${what}`);

  expect(said.length, `deep hub start prints the rebuild sentence, a line that holds "rebuild" and both counts (the events replayed and the log's ${EVENTS}), while the record replays: ${what}\n${hubLog(w)}`).toBeGreaterThan(0);
  // The merge base's start gives the whole start one wait and then says the core didn't start: its sentence is the last line quoted here.
  expect(ended?.code ?? 'still running', `deep hub start exits 0 once the core answers, and gives up on no replay whose count moves within each wait of ${WAIT_MS} ms: ${what}`).toBe(0);
  expect(counts.every((count, i) => i === 0 || count > counts[i - 1]!), `each rebuild sentence deep hub start prints names more events replayed than the one before, so it prints again only when the count has moved: ${what}`).toBe(true);
  expect(new Set(counts).size, `deep hub start prints the sentence again as the count moves, for at least ${RISES} of the ${PAGES} pages' counts: ${what}`).toBeGreaterThanOrEqual(RISES);
  const { health, said: answered } = await healthOf(w.root);
  expect(health !== undefined && !('rebuilding' in health) && typeof health.start === 'string' && Number.isInteger(health.pid), `deep hub start exits 0 only once the core answers: hub.health read right after it answers with the hub's start ID and PID and no rebuilding; it said ${tidy(answered, w)}`).toBe(true);
}, 240_000);

it(`${AC.stall} deep hub start on the same record with a planted fold that never returns from its third page exits 3 one wait after the count last moved, naming the position, and never waits past this test's deadline`, async () => {
  const w = await world();
  const start = startHub(w, { [WAIT]: String(WAIT_MS), [FOLD]: STUCK });
  const ended = await start.ended(STALL_BOUND);
  // A start still running at the deadline is ended here, through its own handle.
  start.end();
  const said = sentences(start);
  const moved = said.find((s) => s.replayed === STALL);
  const what = `deep hub start --root ${exitOf(start, ended)}, its wait ${WAIT}=${WAIT_MS} and the hub's fold ${FOLD}=${STUCK}, having printed ${said.length} rebuild sentences (events replayed: ${said.map((s) => `${s.replayed} at +${s.at - start.began} ms`).join(', ') || 'none'}); its last lines:\n${shown(start, w)}`;
  console.log(`${AC.stall} ${what}`);

  expect(said.length, `deep hub start prints the rebuild sentence, a line that holds "rebuild" and both counts (the events replayed and the log's ${EVENTS}), while the record replays: ${what}\n${hubLog(w)}`).toBeGreaterThan(0);
  expect(ended, `deep hub start gives up on a replay whose count stands still: it had not exited at this test's deadline, ${STALL_BOUND / 1000} s after it started, ${moved ? `${STALL_BOUND - (moved.at - start.began)} ms after it printed that ${STALL} events were replayed` : 'and never printed the count the replay stopped at'}. A start that waits for as long as the socket answers never exits. ${what}`).toBeDefined();
  const end = ended as Ended;
  expect(end.code, `deep hub start exits 3 when the count has not moved for its wait of ${WAIT_MS} ms: ${what}`).toBe(3);
  const { health, said: answered } = await healthOf(w.root);
  expect(rebuildingOf(health), `the hub's health reads the replay where the planted fold left it, two pages in: rebuilding {replayed: ${STALL}, events: ${EVENTS}}; it said ${tidy(answered, w)}`).toEqual({ replayed: STALL, events: EVENTS });
  expect(moved, `deep hub start prints the rebuild sentence when the count moves to ${STALL}, the position the replay stops at: ${what}`).toBeDefined();
  const position = moved as { at: number };
  const last = start.lines.filter((line) => line.text.trim() !== '').at(-1) as Said;
  expect(numbersIn(last.text), `the last line deep hub start prints as it exits 3 names the position the replay stopped at, ${STALL} (written 10000 or 10,000); it reads: ${tidy(last.text, w)}`).toContain(STALL);
  // The criterion's own times, each read from when this process got the line or the exit: one wait after the count
  // last moved, no sooner, and not two.
  const waited = end.at - position.at;
  expect(waited, `deep hub start exits one wait of ${WAIT_MS} ms after the count last moved, not sooner: it exited ${waited} ms after it printed that ${STALL} events were replayed. ${what}`).toBeGreaterThanOrEqual(WAIT_MS - SLACK_MS);
  // deadline: a start that waits a second wait, or longer, has not given up after the one the criterion names
  expect(waited, `deep hub start exits one wait of ${WAIT_MS} ms after the count last moved, not two: it exited ${waited} ms after it printed that ${STALL} events were replayed. ${what}`).toBeLessThan(2 * WAIT_MS);
  expect(last.at - position.at, `the line that names the position is printed as deep hub start gives up, one wait after the count last moved, not only when it moved: it came ${last.at - position.at} ms after the sentence for ${STALL}. ${what}`).toBeGreaterThanOrEqual(WAIT_MS - SLACK_MS);
  // The Scope's last line: the rebuild is not split into several commits. Two pages in and stopped, nothing of it is
  // committed, so the record's file still holds the table as it was planted.
  expect(columnsOf(w.ledger, TABLE), `the rebuild stays one commit (Scope: splitting it is not in this task): with the replay stopped at its third page, the record's file still holds ${TABLE} with the planted column ${PLANTED}`).toContain(PLANTED);
}, 120_000);

interface Read { name: string; ran: Running; reported: Said | undefined; counts: { replayed: number; events: number } | undefined; ended: Ended | undefined }
/** What a line of `deep hub status` says of the replay: the hub's health as one JSON line, its `rebuilding` read exactly. */
function statusCounts(line: Said): { replayed: number; events: number } | undefined {
  if (line.err || !line.text.trim().startsWith('{')) return undefined;
  try { return rebuildingOf(JSON.parse(line.text) as Obj); } catch { return undefined; }
}

it(`${AC.readers} while the record replays, deep hub status, deep doctor and deep each report rebuilding with the same two counts as the hub's health at that reading, within 2 s, and none prints a count of asks`, async () => {
  const w = await world();
  const start = startHub(w, { [WAIT]: String(WAIT_MS), [FOLD]: STUCK });
  // The replay stands still from its third page on: the start's sentence for two pages, or its end, says it is there.
  await Promise.race([start.until((line) => countsOf(line.text)?.replayed === STALL, START_BOUND), start.ended(START_BOUND)]);
  // Its own wait then runs out; the three commands are read with nothing else of this test running.
  const startEnded = await start.ended(STALL_BOUND);
  start.end();
  const first = await healthOf(w.root);
  const held = rebuildingOf(first.health);
  expect(held, `while the record replays, the hub's health says so, rebuilding {replayed: ${STALL}, events: ${EVENTS}} with the planted fold stopped at its third page: deep hub start ${exitOf(start, startEnded)} printing\n${shown(start, w, 6)}\nand hub.health said ${tidy(first.said, w)}\n${hubLog(w)}`).toEqual({ replayed: STALL, events: EVENTS });

  const reads: Read[] = [];
  for (const [name, args, counted] of [
    ['deep hub status', ['hub', 'status', '--root', w.root], statusCounts],
    ['deep doctor', ['doctor'], (line: Said) => countsOf(line.text)],
    ['deep', [], (line: Said) => countsOf(line.text)],
  ] as const) {
    const ran = deep(w, args);
    const reported = await ran.until((line) => counted(line) !== undefined, READER_BOUND);
    const ended = await ran.ended(READER_BOUND);
    ran.end();
    reads.push({ name, ran, reported, counts: reported && counted(reported), ended });
  }
  const second = await healthOf(w.root);
  const tell = (r: Read): string => `${r.name} ${exitOf(r.ran, r.ended)}${r.reported ? `, and reported ${JSON.stringify(r.counts)} ${r.reported.at - r.ran.began} ms after it started` : ', and reported no rebuilding'}; it printed:\n${shown(r.ran, w, 40).slice(0, 3000)}`;
  console.log(`${AC.readers} hub.health before the three commands ${tidy(first.said, w)}, after them ${tidy(second.said, w)}\n${reads.map(tell).join('\n')}`);
  expect(rebuildingOf(second.health), `BLOCKED: the replay moved while the three commands ran, so they weren't read at one reading: hub.health said ${tidy(second.said, w)}`).toEqual(held);

  for (const r of reads) {
    expect(r.counts, `${r.name} reports that the hub is rebuilding with both counts${r.name === 'deep hub status' ? ", in the health's rebuilding on its one JSON line" : ', in one line that holds "rebuild", the events replayed and the events in the log'}: ${tell(r)}`).toEqual(held);
    const after = (r.reported as Said).at - r.ran.began;
    // deadline: the criterion's 2 s; a command that waits for the core, as the merge base's do, reports only once the replay ends
    expect(after, `${r.name} reports rebuilding within 2 s of its start: it took ${after} ms. ${tell(r)}`).toBeLessThanOrEqual(2000);
    expect(r.ended, `${r.name} ends once it has reported: it was still running at this test's bound of ${READER_BOUND / 1000} s. ${tell(r)}`).toBeDefined();
    const asks = asksCounted(r.ran.text());
    expect(asks, `${r.name} prints no count of asks while the hub rebuilds, since none can be read: it printed "${asks}". ${tell(r)}`).toBeUndefined();
  }
}, 240_000);

it(`${AC.hooks} of twenty hooks sent during the replay, the nineteen the hub acknowledged are in the record once each after it, in the order they were sent, and the one that matches a fail-closed entry is denied as with the hub down`, async () => {
  const w = await world({ guard: true });
  const session = newSession(w);
  // With no hub running, deep-hook itself denies the call the entry matches, in the entry's words.
  const down = await throughDeepHook(w, bash(session, GUARD.command));
  expect(deniedInItsWords(down), `BLOCKED: with no hub running, deep-hook was to deny \`${GUARD.command}\` on the fail-closed entry ${GUARD.name} with its reason and next step, so the same can be asked while the hub rebuilds: exit ${down.code}, ${tidy(down.said, w)}`).toBe(true);

  const start = startHub(w, { [FOLD]: SLOW });
  await Promise.race([start.until((line) => countsOf(line.text) !== undefined, START_BOUND), start.ended(START_BOUND)]);
  const before = await healthOf(w.root);
  expect(rebuildingOf(before.health), `while the record replays, the hub's health says it is rebuilding, so hooks can be sent during the replay: deep hub start ${exitOf(start, start.done)} printing\n${shown(start, w, 6)}\nand hub.health said ${tidy(before.said, w)}\n${hubLog(w)}`).toBeDefined();

  // Twenty hooks of one session, one after another: nineteen as deep-hook sends a request, each with the ID minted
  // here and the hub's acknowledgement read; the eighth, the call the fail-closed entry matches, through deep-hook.
  const sent: Sent[] = [];
  let through: { code: number | null; said: string } | undefined;
  for (let n = 1; n <= 20; n++) {
    if (n === 8) through = await throughDeepHook(w, bash(session, GUARD.command));
    else sent.push(await sendHook(w.root, hookRequest(bash(session, `echo dhr-hook-${String(n).padStart(2, '0')}`))));
  }
  const after = await healthOf(w.root);
  expect(rebuildingOf(after.health), `BLOCKED: the replay had ended before the twentieth hook was sent, so not all twenty were sent during it: hub.health said ${tidy(after.said, w)}`).toBeDefined();
  expect(sent.filter((s) => !s.ack).map((s) => `${s.request.id}: ${s.why}`), 'the hub acknowledges each of the nineteen hooks sent while it rebuilds').toEqual([]);
  expect(deniedInItsWords(through!), `the call that matches the fail-closed entry ${GUARD.name}, sent through deep-hook while the hub rebuilds, is denied as it is with the hub down, with exit 2 and the entry's reason and next step: exit ${through!.code}, ${tidy(through!.said, w)}`).toBe(true);

  const ended = await start.ended(START_BOUND);
  start.end();
  expect(ended?.code ?? 'still running', `deep hub start exits 0 once the replay has ended and the core answers: it ${exitOf(start, ended)} printing\n${shown(start, w)}`).toBe(0);
  // One more hook, sent after the replay: once the record holds it, it holds every hook acknowledged before it.
  const marker = await sendHook(w.root, hookRequest(bash(session, 'echo dhr-after-the-replay')));
  expect(marker.ack, `BLOCKED: the hub didn't acknowledge a hook sent after the replay: ${marker.why}`).toBeDefined();
  const missed = await recorded(w.root, EVENTS, marker.request.id, 60_000);
  expect(missed, `BLOCKED: the hook sent after the replay never came on the hub's stream of the log, so the record can't be read as settled: ${missed}\n${hubLog(w)}`).toBeUndefined();

  const log = eventsAfter(w.ledger, EVENTS);
  const end = log.find((e) => e.id === marker.request.id)?.log_pos ?? Number.MAX_SAFE_INTEGER;
  const places: number[] = [];
  for (const [i, s] of sent.entries()) {
    const command = String((s.request.payload.tool_input as Obj).command);
    const byId = log.filter((e) => e.id === s.request.id);
    expect(byId.length, `the hub acknowledged hook ${s.request.id} while it rebuilt, number ${i + 1} of the nineteen sent then (\`${command}\`), and after the replay the record holds ${byId.length} events with that ID, not one. A hub that drops what it acknowledged holds none.`).toBe(1);
    const byCall = log.filter((e) => e.command === command);
    expect(byCall.map((e) => e.id), `the record holds the call of hook ${s.request.id} (\`${command}\`) once, under that ID`).toEqual([s.request.id]);
    places.push(byId[0]!.log_pos);
  }
  expect(places, `the nineteen hooks are in the record in the order they were sent: their log positions, in that order, are ${places.join(', ')}`).toEqual([...places].sort((a, b) => a - b));
  expect(places.every((at) => at > EVENTS && at < end), `the nineteen hooks are recorded when the replay ends, after its ${EVENTS} events and before the hook sent after it (log position ${end}): ${places.join(', ')}`).toBe(true);
}, 300_000);

it(`${AC.reading} after the replay the hub's health holds one reading with the table that was stale, the events replayed and the milliseconds taken, and a second open of the same record rebuilds nothing and adds no reading`, async () => {
  const w = await world();
  const first = startHub(w, { [FOLD]: SLOW });
  const ended = await first.ended(START_BOUND);
  first.end();
  expect(ended?.code ?? 'still running', `deep hub start on the planted record exits 0 once its replay ended: it ${exitOf(first, ended)} printing\n${shown(first, w)}\n${hubLog(w)}`).toBe(0);
  const after = await healthOf(w.root);
  expect(after.health !== undefined && !('rebuilding' in after.health), `once deep hub start exited 0 the hub's health answers, with no rebuilding: it said ${tidy(after.said, w)}`).toBe(true);
  const readings = (after.health as Obj).rebuilds as Obj[] | undefined;
  expect(Array.isArray(readings) ? readings.length : `${JSON.stringify(readings)}, no list`, `after the replay the hub's health holds one reading of it, in rebuilds: hub.health holds the fields ${Object.keys(after.health as Obj).join(', ')}`).toBe(1);
  const reading = readings![0]!;
  expect({ table: reading.table, events: reading.events }, `the reading names the table whose columns differed and the events replayed: it reads ${JSON.stringify(reading)}`).toEqual({ table: TABLE, events: EVENTS });
  expect(Number.isInteger(reading.ms), `the reading's ms is the time the rebuild took, a whole number of milliseconds: it reads ${JSON.stringify(reading)}`).toBe(true);
  // The planted fold held each of the ten pages a second, and the whole replay ran inside the start command's own run.
  const ran = (ended as Ended).at - first.began;
  expect(reading.ms as number, `the reading's ms covers the replay, whose ${PAGES} pages the planted fold held ${HOLD_MS} ms each: it reads ${JSON.stringify(reading)}`).toBeGreaterThanOrEqual(PAGES * HOLD_MS);
  expect(reading.ms as number, `the reading's ms is no longer than deep hub start itself ran, ${ran} ms: it reads ${JSON.stringify(reading)}`).toBeLessThanOrEqual(ran);
  const columns = columnsOf(w.ledger, TABLE);
  expect(columns.includes('created') && !columns.includes(PLANTED), `the table the reading names was the stale one, and the replay remade it with this build's columns: the record's file holds ${TABLE}(${columns.join(', ')})`).toBe(true);

  // A second open of the same record, by the same build, with the same fold: nothing differs, so nothing replays.
  await stopHub(w);
  const second = startHub(w, { [FOLD]: SLOW });
  const again = await second.ended(START_BOUND);
  second.end();
  expect(again?.code ?? 'still running', `a second deep hub start on the same record exits 0: it ${exitOf(second, again)} printing\n${shown(second, w)}\n${hubLog(w)}`).toBe(0);
  expect(sentences(second).map((s) => tidy(s.text, w)), 'a second open of the same record rebuilds nothing, so deep hub start prints no rebuild sentence').toEqual([]);
  const later = await healthOf(w.root);
  expect(later.health !== undefined && !('rebuilding' in later.health), `after the second open the hub's health answers, with no rebuilding: it said ${tidy(later.said, w)}`).toBe(true);
  expect((later.health as Obj).rebuilds, `a second open of the same record adds no reading: the hub's health still holds the one reading of the first, unchanged (${JSON.stringify(reading)})`).toEqual(readings);
}, 420_000);
