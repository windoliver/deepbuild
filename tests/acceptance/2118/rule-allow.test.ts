// AC7: a standing rule's yes reaches the agent as an allow whether or not an extension handles tool.before (README).
//
// #23's permissions world, on the real hub, deep-hook and CLI, with one thing more: before the hub starts, an outside
// package that handles tool.before is installed under the hub's root through the extension host's public entry, as
// packages/hub/test/extensions.test.ts installs one, so the hub loads it at its start. Its handler denies nothing: it
// adds one context block to every call. A plain call's reply must carry that block, or the scene never happened.
//
// Your standing rule: a first session's `npm install left-pad` is asked, you say yes through `deep inbox answer`, and
// the answer is saved as a decision. A new Claude Code session then runs `npm install is-odd`. Its PreToolUse reply
// must say permissionDecision allow, and what the agent reads in it (the decision's reason, or the added context)
// must cite the rule that answered, decision:<id>. On the base the extensions' reply takes the gate's place, so the
// reply has the block and neither of those.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openExtensionHost, openTrust, packageDigest } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import {
  allEvents, answer, bash, cleanup, decisionsSince, handleOf, Inconclusive, lastPos, lateHook, makeWorld, newSession, parseObject, preTool, preToolUse, sessionStart, shown, startHub, stopHub, T0, verdict, waitAsk,
  type Call, type Hub, type Line, type Ran, type Session, type World,
} from '../23/permissions/helpers.ts';
import { eventually, loadReading, standInAgents, undecided } from './helpers.ts';

const AC7 = 'AC7 #2118.8efe3220';
const EXTENSION = 'acme/open-notes';
const BLOCK = '3 notes are open';
const MANIFEST = {
  id: EXTENSION, version: '1.0.0', digest: 'd1:0000000000000000000000000000000000000000000000000000000000000000',
  access: { words: ['record'] }, requires: { preview: ['deep.on'] },
  templates: [{ name: 'open', hook: 'tool.before', text: '{count} notes are open', fields: { count: { type: 'number' } } }],
};
/** The package's code: a tool.before handler that denies nothing and adds one templated block to every call. */
const CODE = `export default function (deep: any): void {
  deep.on('tool.before', async () => ({ context: { template: 'open', values: { count: 3 } } }));
}
`;

afterEach(cleanup, 120_000);

/** Installs and checks the package under the hub's root, through the host's public entry, with no hub running. */
async function install(w: World): Promise<void> {
  const from = join(w.tmp, 'open-notes');
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, 'index.ts'), CODE);
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...MANIFEST, digest: packageDigest(from) }));
  const evidence = await openEvidenceStore({ root: join(w.tmp, 'pre', 'evidence') });
  const record = await openRecord({ path: join(w.tmp, 'pre', 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, supervisor: sup, trust, home: w.root, release: [], now: Date.now });
  try {
    await host.ready();
    const pkg = await host.install({ from, builtBy: null, grant: { record: ['tool.before'] } });
    const checked = await host.check(pkg);
    if (!checked.passed) throw Error(`BLOCKED: ${AC7} the test package ${EXTENSION} must pass its conformance: ${checked.reasons.join('; ')}`);
  } finally {
    await host.close();
    await sup.close();
    await record.close();
  }
}

/** A PreToolUse reply's hookSpecificOutput, as Claude Code reads it. */
const output = (r: Ran): Line => (parseObject(r.stdout.trim())?.hookSpecificOutput ?? {}) as Line;
/** One call of the scene's setup: its PreToolUse; a reply the hub may never have decided, the machine being loaded, is INCONCLUSIVE (#23's reading of a late hook). */
async function called(hub: Hub, s: Session, call: Call): Promise<Ran> {
  const { id, r } = await preToolUse(s, call);
  if (await lateHook(hub, s.id, 'PreToolUse', r, id)) throw new Inconclusive(`${AC7} deep-hook's acknowledgement for \`${String(call.tool_input.command)}\` came late, so the hub never decided it (${shown(r)}); read at ${loadReading()}`);
  return r;
}

test(`${AC7} a loaded extension handles tool.before and denies nothing, and a standing rule approves a dependency install: a Claude Code session's npm install gets a hook reply with permissionDecision allow and the rule's words`, async (ctx) => verdict(ctx, async () => {
  const w = makeWorld();
  await install(w);
  const restorePath = standInAgents(w.tmp);
  const hub = await startHub(w, { clock: T0 }).finally(restorePath);
  try {
    // Given: the loaded extension handles tool.before and denies nothing.
    const first = newSession(w);
    await sessionStart(first);
    const plain = await called(hub, first, bash('ls'));
    if (preTool(plain) === 'deny' || !String(output(plain).additionalContext ?? '').includes(BLOCK)) throw Error(`BLOCKED: ${AC7} the hub must have loaded ${EXTENSION}, whose tool.before handler adds "${BLOCK}" to every call and denies none: the reply to \`ls\` was ${shown(plain)}; hub stderr: ${hub.stderr().slice(-600)}`);

    // Given: a standing rule that approves a dependency install. Asked once, you say yes, saved for this repo.
    const since = await lastPos(hub);
    const asked = await called(hub, first, bash('npm install left-pad'));
    const ask = await waitAsk(hub, since, ['left-pad'], 60_000);
    if (preTool(asked) !== 'deny' || !ask) throw Error(`BLOCKED: ${AC7} \`npm install left-pad\`, which no rule covers yet, must be asked: ${shown(asked)}; ask: ${ask ? handleOf(ask) : 'none'}`);
    const yes = await answer(w, ask, 'allow');
    if (yes.code !== 0) throw Error(`BLOCKED: ${AC7} your yes to ${handleOf(ask)} through deep inbox answer must count: ${shown(yes)}`);
    const saved = await eventually(async () => (await decisionsSince(hub, since)).find((e) => e.data?.ask === handleOf(ask)), 60_000);
    if (!saved) throw Error(`BLOCKED: ${AC7} your yes to ${handleOf(ask)} must be saved as a decision (decision.created naming it): ${(await allEvents(hub)).filter((e) => e.log_pos > since).map((e) => e.kind).join(', ')}`);
    const rule = `decision:${saved.id}`;

    // When: a Claude Code session makes a call the rule approves.
    const later = newSession(w);
    await sessionStart(later);
    const { id, r } = await preToolUse(later, bash('npm install is-odd'));
    if (await undecided(() => allEvents(hub), id, r.stderr)) throw new Inconclusive(`${AC7} deep-hook's acknowledgement for \`npm install is-odd\` came late, so the hub never decided it (${shown(r)}); read at ${loadReading()}`);
    const out = output(r);
    const reads = [out.permissionDecisionReason, out.additionalContext].filter((t) => typeof t === 'string').join('\n');
    const seen = `the rule is ${rule}; the PreToolUse reply to \`npm install is-odd\`: ${shown(r)}`;
    expect(out.permissionDecision, `${AC7} your standing rule's yes reaches the agent as Claude Code's explicit allow, with ${EXTENSION} handling tool.before too; ${seen}`).toBe('allow');
    expect(reads, `${AC7} the reply carries the rule's words: what the agent reads cites ${rule}; ${seen}`).toContain(rule);
  } finally {
    await stopHub(hub);
  }
}), 900_000);
