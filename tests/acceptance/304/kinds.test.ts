// #304 AC5: a call the Claude Code adapter records with tool kind `unknown` (a tool its facts don't list) counts as
// change, so a block test entry whose match is any change (`counts:change`) denies it with the hub up, while the same
// entry allows a call of kind `read` (Read). The kinds are read back from the record (tool.before's data.kind), so the
// test knows the calls are the ones the criterion names. A deep-hook that matches classes only for the tools it lists
// itself (cargo feature plant-listed-kinds-only) lets the unknown call through and fails this test, naming the entry.
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC5, befores, buildDeepHook, cleanup, decision, failureOf, guardAdd, guardFile, holds, hook, makeHome, must,
  newSession, preToolUse, readRules, seedDefaults, shown, startHub, stopHub, testEntry, type Call, type Ev, type Ran,
  type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const NAME = 't-change';
const UNKNOWN_TOOL = 'FrobnicateWidgets';

interface Seen { guard: ReturnType<typeof testEntry>; added: Ran; rules: Rules | undefined; unknown: Ran; read: Ran; kinds: { unknown?: Ev; read?: Ev } }

async function observe(binary: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  const s = newSession(home);
  const unknownCall: Call = { tool_name: UNKNOWN_TOOL, tool_input: { target: 'widgets', count: 3 } };
  const readCall: Call = { tool_name: 'Read', tool_input: { file_path: join(s.cwd, 'notes.txt') } };
  const guard = testEntry(NAME, { match: 'counts:change', mode: 'block', fail_closed: false });
  const hub = await startHub(home);
  try {
    const added = await guardAdd(home, guardFile({ [NAME]: { guard, planted: unknownCall, twin: readCall } }));
    const rules = readRules(home);
    const u = preToolUse(s, unknownCall);
    const r = preToolUse(s, readCall);
    const unknown = await hook(home, u, { binary });
    const read = await hook(home, r, { binary });
    const found = await befores(hub, [u.tool_use_id, r.tool_use_id]);
    return { guard, added, rules, unknown, read, kinds: { ...(found.get(u.tool_use_id) ? { unknown: found.get(u.tool_use_id)! } : {}), ...(found.get(r.tool_use_id) ? { read: found.get(r.tool_use_id)! } : {}) } };
  } finally {
    await stopHub(hub);
  }
}

function judgeAC5(o: Seen): void {
  must(o.added.code === 0, `${NAME}: \`deep guard add\` must install the entry whose match is any change, exit 0: ${shown(o.added)}`);
  must(holds(o.rules, NAME, o.guard), `${NAME}: the entry must be in rules.json with its mode: ${JSON.stringify(o.rules?.entries[NAME])}`);
  must(o.kinds.unknown?.data.kind === 'unknown', `${NAME}: the ${UNKNOWN_TOOL} call must be recorded with tool kind unknown: ${JSON.stringify(o.kinds.unknown?.data)}`);
  must(o.kinds.read?.data.kind === 'read', `${NAME}: the Read call must be recorded with tool kind read: ${JSON.stringify(o.kinds.read?.data)}`);
  must(decision(o.unknown) === 'deny', `${NAME}: the ${UNKNOWN_TOOL} call, kind unknown, counts as change and must be denied: ${shown(o.unknown)}`);
  must(decision(o.read) === 'allow', `${NAME}: the Read call, kind read, must be allowed by the same entry: ${shown(o.read)}`);
}

describe(`AC5 ${AC5} a call of tool kind unknown counts as change and meets an entry whose match is any change`, () => {
  it(`AC5 ${NAME} (counts:change, block) denies the ${UNKNOWN_TOOL} call recorded as kind unknown and allows the Read call recorded as kind read`, async () => {
    judgeAC5(await observe(BIN));
  }, 900_000);

  it('AC5 (wrong program) an engine that matches only the listed kinds (plant-listed-kinds-only) lets the unknown call through and fails this test, naming the entry', async () => {
    const plant = await buildDeepHook({ features: ['plant-listed-kinds-only'] });
    const seen = await observe(plant);
    const failure = await failureOf(() => judgeAC5(seen));
    expect(failure, 'the engine that matches only listed kinds must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the entry').toContain(NAME);
    expect(decision(seen.unknown), `the plant lets the unknown call through: ${shown(seen.unknown)}`).toBe('allow');
  }, 900_000);
});
