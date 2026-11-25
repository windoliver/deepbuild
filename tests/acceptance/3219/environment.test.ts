// AC4 #3219.a0eeff4a: "A process that sets the environment as a leased command's would be, with no lease in the table,
// is not taken as holding one: it asks and waits like any other. A planted deep-show that trusts the environment draws
// beside an exclusive holder and fails, naming the holder"
//
// A test's own hub and two scripted Claude Code sessions. The kit's session first runs `deep lease gpu:shared --
// /usr/bin/env` and keeps every variable that command was given beyond its own environment (README: The environment of
// a leased command): the environment a leased command gets, whose lease has since been released. The holder's session
// then runs `deep lease gpu:exclusive -- holder ac4`, a stand-in that holds the gpu lease exclusive until the test lets
// it go. With the holder holding, the kit's session runs `deep-show run` (`test.kit.gpu` on the GPU backend) as a plain
// shell command, not under `deep lease`, with that environment on top of its own: no lease in the table is its. The
// holder is let go once the kit says it waits (a wait line on its stderr) or has ended, or after 120 s. The kit must not have ended while the holder held the lease,
// must hold a gpu lease of its own in the table, granted only after the holder's was released, and must draw. The
// planted deep-show (`planted: "trusts_leased_env"`, chosen) takes that environment as holding the lease and draws at
// once; the same judge must fail naming the holder. At the base, deep-show never asks the hub, so it draws beside the
// holder whatever its environment.
import { describe, expect, it } from 'vitest';
import {
  AC, bound, deepShow, ended, gpuRows, kitOf, kitScenario, loadNow, mustFail, none, Session, showIn, shownRows, Table, World,
  type Ended, type LeaseRow, type ShowEnd,
} from './helpers.ts';

const PLANT = 'trusts_leased_env';
/** The longest the holder holds once the kit runs, if the kit neither says it waits nor ends first. */
const HOLD_MS = 120_000;
/** Variables the shell sets for itself, not `deep lease`. */
const SHELL_SET = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);

interface Seen { holder: string; holderSession: string; kitHolder: string; env: Record<string, string>; hold: LeaseRow | undefined; letGo: number; kit: ShowEnd; rows: LeaseRow[]; plant?: string }

/** The environment `deep lease gpu:shared` gives its command beyond the session's own, once that command and its lease have ended. */
async function leasedEnvironment(s: Session, table: Table): Promise<Record<string, string>> {
  const run = s.run('deep lease gpu:shared -- /usr/bin/env');
  const done = await Promise.race([run.done, bound(600_000).then(() => undefined)]) as Ended | undefined;
  if (!done || done.code !== 0) expect.fail(`BLOCKED: \`deep lease gpu:shared -- /usr/bin/env\` didn't run to its end in the kit's session: ${done ? `exit ${done.code}: ${done.output.slice(-1500)}` : 'still running after 600 s'}`);
  const own = s.env();
  const given = Object.fromEntries(done!.output.split('\n').map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1]!, m[2]!]));
  const env = Object.fromEntries(Object.entries(given).filter(([k, v]) => !SHELL_SET.has(k) && own[k] !== v));
  if (!Object.keys(env).length) expect.fail(`BLOCKED: \`deep lease gpu:shared -- /usr/bin/env\` gave its command no variable beyond the session's own: ${done!.output.slice(0, 1500)}`);
  const released = await table.until((rows) => { const mine = gpuRows(rows).filter((r) => r.holder === s.holder); return mine.length > 0 && mine.every((r) => r.released !== undefined); }, 60_000);
  if (!released) expect.fail(`BLOCKED: the gpu lease of \`deep lease gpu:shared -- /usr/bin/env\` wasn't recorded and released: ${shownRows(gpuRows(await table.read()))}`);
  return env;
}

async function beside(planted?: string): Promise<Seen> {
  const bin = await deepShow();
  const w = new World();
  await w.startHub();
  const s = new Session(w, 'kit');
  const h = new Session(w, 'holder');
  const table = new Table(w.hub!);
  try {
    await Promise.all([s.begin(), h.begin()]);
    const env = await leasedEnvironment(s, table);
    const holding = h.run('deep lease gpu:exclusive -- holder ac4');
    if (!(await holding.said(/holder ac4: holding/, 300_000))) expect.fail(`BLOCKED: the holder (\`deep lease gpu:exclusive -- holder ac4\`) didn't start: ${holding.output().slice(-1500)}`);
    const hold = gpuRows(await table.read()).find((r) => r.holder === h.holder && r.released === undefined);
    if (!hold || hold.mode !== 'exclusive') expect.fail(`BLOCKED: the holder runs without an exclusive gpu lease in the table: ${shownRows(gpuRows(await table.read()))}; ${holding.output().slice(-800)}`);
    const t = Date.now();
    const run = showIn(s, bin, kitScenario(w.folder('evidence'), planted), planted ? `the kit (planted ${planted})` : 'the kit', { env });
    // The holder holds until the kit says it waits (a wait line on its stderr) or ends, HOLD_MS at most.
    await run.said(/wait/i, HOLD_MS);
    const letGo = Date.now();
    w.go('ac4');
    const kit = await ended(run, 1_200_000);
    await Promise.race([holding.done, bound(60_000)]);
    await table.until((rows) => gpuRows(rows).filter((r) => r.id === hold!.id || (r.at >= t && r.holder === s.holder)).every((r) => r.released !== undefined), 30_000);
    const rows = gpuRows(await table.read());
    const held = rows.find((r) => r.id === hold!.id);
    console.log(`AC4 ${planted ? `planted ${planted}` : 'as built'} (${loadNow()}): the leased command's environment ${JSON.stringify(Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.length > 60 ? `${v.slice(0, 60)}...` : v])))}; the holder's lease ${held ? `${held.id} ${held.mode} ${held.at}..${held.released ?? 'held'}` : '-'}, let go at ${letGo}; the kit ran ${kit.t0}..${kit.t1}; the kit session's gpu leases since: ${shownRows(rows.filter((r) => r.holder === s.holder && r.at >= t))}`);
    return { holder: hold!.holder, holderSession: h.id, kitHolder: s.holder, env, hold: held, letGo, kit, rows: rows.filter((r) => r.at >= t), ...(planted ? { planted } : {}) };
  } finally {
    w.go('all');
    table.close();
    s.stop();
    h.stop();
    await w.stopHub();
  }
}

function failures({ holder, holderSession, kitHolder, hold, letGo, kit, rows }: Seen): string[] {
  const f: string[] = [];
  const by = `the exclusive holder ${holder} (\`deep lease gpu:exclusive -- holder ac4\` in session ${holderSession})`;
  const released = hold?.released ?? letGo;
  const k = kitOf(kit);
  if (typeof k === 'string') f.push(`${k} (beside ${by})`);
  else if (!k.drew) f.push(`the kit drew nothing on the GPU once ${by} let go: its GPU cases are ${k.gpu.map((c) => `${c.case} ${c.verdict}`).join(', ') || 'none'}`);
  if (kit.t1 < released) f.push(`the kit, run with a leased command's environment and no lease in the table, ended at ${kit.t1} while ${by} held the gpu lease exclusive (granted ${hold?.at}, released ${hold?.released ?? `after ${letGo}`}): it drew beside the holder instead of waiting`);
  const mine = rows.filter((r) => r.holder === kitHolder).sort((a, b) => a.at - b.at)[0];
  if (!mine) f.push(`the kit took no gpu lease in the table: it didn't ask, as any other kit asks, while ${by} held it`);
  else if (mine.at < released) f.push(`the kit's gpu lease ${mine.id} was granted at ${mine.at}, while ${by} held the gpu lease exclusive until ${released}`);
  return f;
}

describe(`${AC[4]} a process with a leased command's environment and no lease in the table asks and waits like any other`, () => {
  it(`${AC[4]} a kit with a leased command's environment waits for an exclusive holder and then takes its own lease; a planted deep-show that trusts the environment (planted: ${PLANT}) fails, naming the holder`, async () => {
    none(failures(await beside()), 'a kit with a leased command\'s environment, beside an exclusive holder');

    const planted = await beside(PLANT);
    if (typeof kitOf(planted.kit) === 'string') expect.fail(`the planted deep-show (planted: ${PLANT}) must run the kit: ${kitOf(planted.kit) as string}`);
    await mustFail(`planted ${PLANT}`, () => none(failures(planted), `a kit with a leased command's environment, beside an exclusive holder (planted ${PLANT})`), [planted.holder]);
  }, 3_600_000);
});
