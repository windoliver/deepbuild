// #3539's scripts, each the scheduler's `Scenario` as data (a check's `run` replaced by `took_ms`, the time one run of
// it takes): sessions as scripted turns, a prompt and the green stop that ends it. Every time is drafted, as the issue
// says of its checks. The cadence is this spike's choice (README, The scripts), seeded so a script is the same
// wherever it is made. analyze.mjs keeps each as JSON under scripts/, and every reading is taken from that file.
const MIN = 60_000;
export const OTHERS = [1, 3, 6];
export const POOLS = [2, 4, 9];
export const PERSON = 'person';
/** The slow checks every stop queues, as the issue drafts them; each takes the time it was drafted at, and passes. */
const checks = (fix) => [['check-1m', MIN], ['check-5m', 5 * MIN], ['check-20m', 20 * MIN]]
  .map(([id, ms]) => ({ id, on_base: id === fix ? 'fails' : 'passes', inputs: ['src/**'], expected_ms: ms, took_ms: ms }));
/** How long the table's sessions go on opening turns. */
const SPAN_MS = 16 * 60 * MIN;
const SEED = 3539;

/** A seeded generator: mulberry32, as scripts/lifecycle-sim.mjs has it. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** One turn: the prompt that opens it, and the stop that ends it on a snapshot of its own. */
const turn = (id, n, origin, promptAt, stopAt) => [
  { at: promptAt, kind: 'prompt', origin },
  { at: stopAt, kind: 'stop', snapshot: `${id}-${String(n).padStart(2, '0')}`, changed: [`src/${id}.ts`] },
];
/**
 * A session's turns over the span: a prompt, `work` minutes of the agent working to its green stop, then `pause`
 * minutes before the next prompt, each drawn evenly from its range, to the second. Its first prompt comes within the
 * width of its pause, so the sessions don't all stop at once.
 */
function session(id, origin, rand, work, pause) {
  const draw = ([low, high]) => Math.round((low + rand() * (high - low)) * 60) * 1000;
  const events = [];
  for (let at = draw([0, pause[1] - pause[0]]), n = 1; at < SPAN_MS; n++) {
    const stop = at + draw(work);
    events.push(...turn(id, n, origin, at, stop));
    at = stop + draw(pause);
  }
  return { id, agent: 'claude', checks: checks(), events };
}
/** The session a person is at: a prompt the person typed, 3 to 12 minutes of work, then 25 to 45 minutes before the next. */
const person = () => session(PERSON, 'human', random(SEED), [3, 12], [25, 45]);
/** A session nobody is typing in: a prompt a schedule sent, 5 to 25 minutes of work, then 25 to 45 minutes before the next. */
const other = (k) => session(`other-${k}`, 'scheduled', random(SEED * 1000 + k), [5, 25], [25, 45]);

/** A script of the table: the person's session alone (`others` 0) or beside that many sessions nobody types in, on a pool. */
export const tableScript = (others, pool) => ({ config: { slots: pool }, sessions: [person(), ...Array.from({ length: others }, (_, k) => other(k + 1))] });
export const tableName = (others, pool) => (others ? `beside-${others}-pool-${pool}` : `alone-pool-${pool}`);

/** The same six sessions on two slots, but the person opens one turn and never stops: no place is ever the person's. */
export function neverStopsScript() {
  const script = tableScript(6, 2);
  script.sessions[0].events = script.sessions[0].events.slice(0, 1);
  return script;
}

/**
 * The one script for the hub's order and the package's (README, The hub's order and the package's): four slots and
 * four sessions in their first minutes, so that each rule the two differ by is met once. `other-1` fills three slots.
 * The person stops, and stops again while the first stop's checks still wait. `other-3` goes on by itself, a
 * continuation, and lists its checks longest first. `other-2` works on a fix, so its 5-minute check fails on the
 * base, and it stops when others' checks already wait.
 */
export function ordersScript() {
  const of = (id, origin, turns, { fix, longestFirst } = {}) => ({
    id, agent: 'claude', checks: longestFirst ? checks(fix).reverse() : checks(fix),
    events: turns.flatMap(([prompt, stop], n) => turn(id, n + 1, origin, prompt * 1000, stop * 1000)),
  });
  return {
    config: { slots: 4 },
    sessions: [
      of(PERSON, 'human', [[0, 45], [120, 200]]),
      of('other-1', 'scheduled', [[0, 5]]),
      of('other-2', 'scheduled', [[0, 60]], { fix: 'check-5m' }),
      of('other-3', 'continuation', [[0, 50]], { longestFirst: true }),
    ],
  };
}
