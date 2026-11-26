// AC2 #999.4257f07c: a host whose deep-hook is a version older than the hub's, within the contract version, keeps
// recording; one outside it says so on its row and in `deep doctor`, naming both versions.
//
// The host gets its deep-hook from `deep host add` on a hub of this checkout, and a session there records. Then the hub
// is updated under it (README, Version skew): it stops, by its PID, and starts again on the same home as a planted hub
// whose hello names a newer contract, while the session's own process on the host runs on. One minor ahead
// (`contract-minor-ahead`, this suite's), the host's deep-hook is older and within the contract: the session's next
// call is recorded under the host's name. One major ahead (`contract-major-ahead`, #1334's), it is outside: a row of
// `deep status` and an item of `deep doctor` name the host and both contract versions, the host deep-hook's and the hub's.
import { afterEach, describe, expect, test } from 'vitest';
import { AC, cleanup, cut, deep, hostAdd, hostOf, HostSession, LIMIT, openWorld, parseObject, PROMPT, proof, restartHub, shown, statusRows, type Line, type World } from './helpers.ts';

afterEach(cleanup, 900_000);

/** Whether `text` names the version `v` as a version: not as part of a longer number. */
const names = (text: string, v: string): boolean => new RegExp(`(^|[^0-9.])${v.replace('.', '\\.')}([^0-9.]|$)`).test(text);

/** A host with a session that has recorded on a hub of this checkout: the session, and the contract both sides speak. */
async function recording(w: World): Promise<{ s: HostSession; major: number; minor: number }> {
  await hostAdd(w);
  const own = /^(\d+)\.(\d+)$/.exec(String(w.log.hello.contract));
  if (!own) throw Error(`BLOCKED: the hub's hello names no contract as major.minor: ${cut(JSON.stringify(w.log.hello), 400)}`);
  const s = await HostSession.open(w);
  await s.start();
  await s.typed(PROMPT);
  const before = await s.bash('echo before the update');
  expect(before.after, `before the update, the session's call on ${w.alias} is let through and recorded: ${w.redact(shown(before.before))}`).not.toBeNull();
  return { s, major: Number(own[1]), minor: Number(own[2]) };
}

describe(AC[2], () => {
  test('after the hub is updated one contract minor ahead, the session on the host keeps recording under the host\'s name', async () => {
    const w = await openWorld();
    const { s, major, minor } = await recording(w);
    await restartHub(w, 'contract-minor-ahead');
    expect(w.log.hello.contract, `the planted hub contract-minor-ahead speaks the contract one minor ahead of ${major}.${minor}, so the host's deep-hook is the older side, within it`).toBe(`${major}.${minor + 1}`);
    // Fired until the record holds it: six tries with none recorded fail, naming the hook's own output.
    const kept = await s.bash('echo after the update');
    const events = w.log.events.filter((e) => e.session === s.id && (e.kind === 'tool.before' || e.kind === 'tool.after') && e.data.call === kept.id);
    proof(w, 'ac2-within.json', { host: w.alias, hub_contract: w.log.hello.contract, host_deep_hook_contract: `${major}.${minor}`, events: events.map((e) => ({ kind: e.kind, log_pos: e.log_pos, host: hostOf(e) ?? null })) });
    expect(kept.after, `the older deep-hook on ${w.alias} still lets the session's call through: ${w.redact(shown(kept.before))}`).not.toBeNull();
    expect(events.map((e) => e.kind), 'the call\'s two hooks are in the updated hub\'s record').toEqual(['tool.before', 'tool.after']);
    expect(events.filter((e) => hostOf(e) !== w.alias).map((e) => e.kind), `each carries the host's name, ${w.alias}`).toEqual([]);
  }, LIMIT);

  test('after the hub is updated one contract major ahead, a row of deep status and an item of deep doctor say the host\'s deep-hook is outside the contract, naming both versions', async () => {
    const w = await openWorld();
    const { s, major, minor } = await recording(w);
    const [older, newer] = [`${major}.${minor}`, `${major + 1}.0`];
    await restartHub(w, 'contract-major-ahead');
    expect(w.log.hello.contract, `the planted hub contract-major-ahead (#1334's) speaks ${newer}, so the host's deep-hook, which speaks ${older}, is outside its contract`).toBe(newer);
    const says = (text: string): boolean => text.includes(w.alias) && names(text, older) && names(text, newer);
    // One hook of the session reaches for the updated hub; then the row is waited for as the record sets it.
    const tried = await s.bash('echo after the update', false);
    await w.log.until((events) => events.some((e) => e.kind === 'row.set' && says(JSON.stringify(e.data))), 120_000);
    const rows = await statusRows(w);
    const doctor = await deep(w, ['doctor', '--json'], 600_000);
    const items = doctor.stdout.split('\n').map((l) => parseObject(l)).filter((i): i is Line => i !== undefined && typeof i.code === 'string');
    proof(w, 'ac2-outside.json', { host: w.alias, hub_contract: newer, host_deep_hook_contract: older, hook: { before: tried.before.code, stderr: cut(tried.before.stderr, 600) }, rows: rows.filter((r) => JSON.stringify(r).includes(w.alias)), doctor: items.filter((i) => JSON.stringify(i).includes(w.alias)) });
    expect.soft(rows.filter((r) => says(JSON.stringify(r))).length, `a row of deep status names ${w.alias} and both versions, its deep-hook's ${older} and the hub's ${newer}; the rows that name the host: ${cut(JSON.stringify(rows.filter((r) => JSON.stringify(r).includes(w.alias))), 1500)}`).toBeGreaterThan(0);
    expect.soft(items.length, `deep doctor --json prints its items: ${w.redact(shown(doctor))}`).toBeGreaterThan(0);
    expect.soft(items.filter((i) => i.level !== 'ok' && says(JSON.stringify(i))).length, `an item of deep doctor that isn't ok names ${w.alias} and both versions, ${older} and ${newer}; the items that name the host: ${cut(w.redact(JSON.stringify(items.filter((i) => JSON.stringify(i).includes(w.alias)))), 1500)}`).toBeGreaterThan(0);
  }, LIMIT);
});
