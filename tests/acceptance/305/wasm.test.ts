import { rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOC, PROGRAM_SHA256, SHOW_NAME, arr, board, check, logicItem, moduleMissing, moduleMissingFailures, obj, plantProgramFifo, requireFifo, requires, scenario,
  show, start, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const CORE: Build = { set: 'core' };
const builds = useBuilds([CORE]);
const evidence = useEvidence();

/** A document that names a WebAssembly program by hash and declares the logic module its kind needs. */
const LOGIC = board('Logic', [logicItem('prog-1', PROGRAM_SHA256)], requires({ logic: '^1' }));
/** How long an honest run gets before the FIFO's reader is taken as blocked on it. */
const HONEST_MS = 30_000;
/** How long the planted reader gets before it is killed. */
const PLANTED_MS = 10_000;

// deep_show is alpha's, on DOC.a; `deep show --check` is your shell's, another writer, on DOC.b. Each
// test runs one process on one fresh evidence store, so no layer is shared between them.

/** One `deep-show run` that must finish: a process that opened the program's FIFO blocks and is killed at `ms`. */
function finishes(bin: string, sc: JsonObject, ms: number, what: string): JsonObject[] {
  const s = start(bin, ['run'], [sc], ms);
  expect(s.timedOut, `${what} finished: a process that never finishes within ${ms / 1000} s has opened the program's FIFO, so it read the program's bytes, which must never be read`).toBe(false);
  expect(s.status, `${what} exited 0; stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  const out = obj(s.lines[0], `${what}: the answer`);
  expect(out['ok'], `${what} ran the scenario: ${JSON.stringify(out).slice(0, 2000)}`).toBe(true);
  return arr(out['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
}

describe('#305.c18cbd77 a document that names a WebAssembly program, in a build without the logic module, is refused with module_missing naming the logic module, and the program\'s bytes are never read', () => {
  it('#305.c18cbd77 deep_show in the core build refuses the document with module_missing naming logic, with no snapshot, and finishes with the program\'s FIFO unread', () => {
    requireFifo();
    plantProgramFifo(evidence());
    const [reply] = finishes(builds.bin(CORE), scenario(evidence(), [show(LOGIC, { pixels: true })]), HONEST_MS, `${SHOW_NAME} run with the program as a FIFO`);
    expect(moduleMissingFailures(reply!, 'logic', false, 'the deep_show reply'), 'the document is refused with module_missing naming the logic module, no snapshot').toEqual([]);
    expect(moduleMissing(reply!, 'logic').every((i) => i.severity === 'error'), 'as an error').toBe(true);
  }, HONEST_MS + 30_000);

  it('#305.c18cbd77 `deep show --check` of the same document is BLOCKED, naming logic, and finishes with the FIFO unread', () => {
    requireFifo();
    plantProgramFifo(evidence());
    const [reply] = finishes(builds.bin(CORE), scenario(evidence(), [check(LOGIC, { doc: DOC.b })]), HONEST_MS, `${SHOW_NAME} run with --check and the program as a FIFO`);
    expect(moduleMissingFailures(reply!, 'logic', true, 'the check result'), 'the check is BLOCKED, with module_missing naming the logic module').toEqual([]);
  }, HONEST_MS + 30_000);

  it('#305.c18cbd77 a planted check that reads the program\'s bytes before refusing never finishes on the FIFO and is killed, so it fails this; with an ordinary file in the FIFO\'s place it finishes with the same refusal, so the hang is the read', () => {
    requireFifo();
    const bin = builds.bin(CORE);
    const path = plantProgramFifo(evidence());
    const onFifo = start(bin, ['run'], [scenario(evidence(), [show(LOGIC, { pixels: true })], 'reads_wasm_bytes')], PLANTED_MS);
    expect(onFifo.timedOut, `the planted check that reads the program's bytes blocks on the FIFO and is killed at ${PLANTED_MS / 1000} s: the honest test's "finishes" fails on it`).toBe(true);

    rmSync(path);
    writeFileSync(path, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    const [twin] = finishes(bin, scenario(evidence(), [show(LOGIC, { pixels: true })], 'reads_wasm_bytes'), PLANTED_MS, 'the planted twin with an ordinary file where the FIFO was');
    expect(moduleMissingFailures(twin!, 'logic', false, 'the planted twin\'s reply'), 'the twin refuses the document the same way: what hung the first run was the read').toEqual([]);
  }, PLANTED_MS * 2 + 30_000);
});
