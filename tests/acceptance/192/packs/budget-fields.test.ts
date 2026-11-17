// #192.e1a673a1 (criterion 13): a provider that states `memory: 1` and grows its memory to 2 MiB traps on memory,
// naming the provider; one that states `memory: -1` and one that states `stack: 5,000,000,000` are each refused at
// check, naming the field, with no run. On the merge base the first runs under the 64 MiB default with no trap, the
// third gets no refusal, and this test fails, naming `memory`.
//
// The packs (README: Packs): test/memoryone (provider grows, memory_2mib.wat, budget {memory: 1}), test/memoryneg
// (negative, quad.wat, budget {memory: -1}) and test/stackbig (deep_stack, quad.wat, budget {stack: 5,000,000,000}).
// The same scenario runs on deep-show `full,test-mesh-item` here and at the merge base; `failures` is what this
// criterion requires of it. The pack check runs every provider at 3 fixed seeds (criterion 11's rule), so the memory
// trap shows at install (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  DOC, SANDBOX_COUNTS, SHOW, TIMEOUT, baseShow, deepShow, fresh, hostReady, installPack, installShown, issuesAt, meshBytes, meshDoc, meshProvider,
  nodeRun, prebuild, present, program, provided, providedRow, providerPack, ranTheQuad, runShow, runsOf, scenario, show, trapKind, useTemp,
  type JsonObject, type PackDir,
} from './helpers.ts';

/** Criterion 13's ID: `#192.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#192.e1a673a1';
prebuild(() => { deepShow(SHOW); baseShow(); });
const temp = useTemp();

const STACK = 5_000_000_000;

interface Packs { one: PackDir; neg: PackDir; stack: PackDir }
function packs(root: string): Packs {
  const quad = program('quad');
  const grows = program('memory_2mib');
  return {
    one: providerPack(root, 'memoryone', { grows: meshProvider(grows, { budget: { memory: 1 } }) }, { 'memory_2mib.wasm': grows.bytes }).pack,
    neg: providerPack(root, 'memoryneg', { negative: meshProvider(quad, { budget: { memory: -1 } }) }, { 'quad.wasm': quad.bytes }).pack,
    stack: providerPack(root, 'stackbig', { deep_stack: meshProvider(quad, { budget: { stack: STACK } }) }, { 'quad.wasm': quad.bytes }).pack,
  };
}
/** The calls, in order: the run count around the two packs refused by their fields, the memory: 1 pack, a document naming each provider. */
const calls = (p: Packs): JsonObject[] => [
  SANDBOX_COUNTS, installPack(p.neg), installPack(p.stack), SANDBOX_COUNTS, installPack(p.one),
  present(DOC.a, meshDoc(p.one, 'memoryone.grows')), present(DOC.b, meshDoc(p.neg, 'memoryneg.negative')), present(DOC.c, meshDoc(p.stack, 'stackbig.deep_stack')),
  provided(DOC.a), provided(DOC.b), provided(DOC.c),
];

/** What the criterion requires of one run of the scenario, the memory trap first; each failure names what it misses. */
function failures(r: JsonObject[]): string[] {
  const [before, neg, stack, after, one] = r;
  const out: string[] = [];
  const trapped = issuesAt(one, 'providers/grows', true).filter((i) => trapKind(i) === 'memory');
  if (one?.['outcome'] !== 'refused' || trapped.length === 0) {
    out.push(`test/memoryone@1.0.0's provider grows, which states budget {memory: 1} and holds a 2 MiB memory, doesn't trap on memory at its pack check, naming the provider (an issue at providers/grows whose actual.trap.kind is memory): ${installShown(one)}`);
  }
  if (neg?.['outcome'] !== 'refused' || issuesAt(neg, 'providers/negative/budget/memory').length === 0) {
    out.push(`test/memoryneg@1.0.0, whose provider negative states budget {memory: -1}, isn't refused at check naming the field (an issue at providers/negative/budget/memory): ${installShown(neg)}`);
  }
  if (stack?.['outcome'] !== 'refused' || issuesAt(stack, 'providers/deep_stack/budget/stack').length === 0) {
    out.push(`test/stackbig@1.0.0, whose provider deep_stack states budget {stack: 5,000,000,000}, isn't refused at check naming the field (an issue at providers/deep_stack/budget/stack): ${installShown(stack)}`);
  }
  if (typeof before?.['runs'] !== 'number' || before['runs'] !== after?.['runs']) {
    out.push(`memory -1 and stack 5,000,000,000 are refused with no run, but the sandbox module's runs went from ${show(before?.['runs'])} to ${show(after?.['runs'])} across their installs`);
  }
  return out;
}

describe(`${ID} a provider's memory budget is read from \`memory\` in MiB and binds its run; a negative memory and a stack field are refused at check`, () => {
  it(`${ID} memory 1 with a 2 MiB memory traps on memory naming the provider; memory -1 and stack 5,000,000,000 are refused naming the field with no run; the merge base runs the first under the 64 MiB default with no trap, takes the stack with no refusal, and fails naming memory`, () => {
    hostReady();
    // The fixture as written, in Node's engine: memory_2mib.wat holds 2 MiB, writes its last byte and its quad.
    const grows = nodeRun(program('memory_2mib'));
    expect([grows.trap, grows.memoryBytes, meshBytes(grows).n], 'memory_2mib.wat holds 2 MiB and runs to its quad').toEqual([null, 2 * 1024 * 1024, 4]);

    const dir = fresh(temp(), 'here');
    const here = runShow(deepShow(SHOW), scenario(dir, calls(packs(dir))));
    expect(failures(here), 'this build meets criterion 13').toEqual([]);

    // The merge base, on the same scenario: no refusal at install, the 2 MiB provider runs with no trap under the
    // default, the stack is taken with no refusal at check, and this test's first failure names memory.
    const base = baseShow();
    const baseDir = fresh(temp(), 'base');
    const there = runShow(base.bin, scenario(baseDir, calls(packs(baseDir))));
    const [before, , stack, after, one, , , , providedOne, , providedStack] = there;
    const at = `the merge base ${base.sha.slice(0, 12)}`;
    expect(one?.['outcome'], `${at} installs test/memoryone: ${installShown(one)}`).toBe('installed');
    expect(ranTheQuad(providedRow(providedOne)), `${at} runs memoryone.grows (memory: 1, a 2 MiB memory) at its document's check with no trap, under the 64 MiB default: ${show(providedOne)}`).toBe(true);
    expect(stack?.['outcome'], `${at} takes stack 5,000,000,000 with no refusal at check: ${installShown(stack)}`).toBe('installed');
    expect(ranTheQuad(providedRow(providedStack)), `${at} runs stackbig.deep_stack with no refusal at its document's check: ${show(providedStack)}`).toBe(true);
    expect(runsOf(after, `${at}: sandbox`), `${at} ran nothing at install`).toBe(runsOf(before, `${at}: sandbox`));
    const baseFailures = failures(there);
    expect(baseFailures[0] ?? '', `${at} fails this test first at the memory trap, naming memory: ${show(baseFailures)}`).toContain('trap on memory');
  }, TIMEOUT);
});
