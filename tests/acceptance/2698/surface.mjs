// The one place this suite says what issue #2698 leaves unnamed (README: Assumptions): where the reader lives, how it
// is called, what a reading looks like, and what the tasks' last lines call their readings. The real reader and each
// planted one are called through `reader()` below, so every assertion runs on both through the same code, and a task's
// last line is read only through `idleLine()` and `commandLine()`.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A1. The reader is this module, from the repository's root, and the benchmarks import it from there. */
export const READER_MODULE = 'benchmarks/process-reader.mjs';
/** A2. It exports this function: `startReading(pid)` gives, or resolves to, `{ stop() }`, and the span is from one to the other. */
export const READER_START = 'startReading';
/** A3. The four readings, by name: counts, milliseconds of user and system CPU time, and bytes at the span's end. */
export const READINGS = ['instructions', 'cpuMs', 'wakeups', 'footprintBytes'];

const shown = (value) => JSON.stringify(value)?.slice(0, 600) ?? String(value);

/** A4. A reading that can't be taken is null (or left out), never 0; anything else is a number that isn't negative. */
function four(raw, where, names = READINGS) {
  assert.ok(raw && typeof raw === 'object' && !Array.isArray(raw), `${where} is ${shown(raw)}, not an object of readings (README: Assumptions)`);
  return Object.fromEntries(names.map((name) => {
    const value = raw[name] ?? null;
    assert.ok(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0), `${where}.${name} is ${shown(raw[name])}: a reading is a number, or null where it can't be taken`);
    return [name, value];
  }));
}

/**
 * A3. What `stop()` gives, or resolves to: `{ spanMs, processes: [{ pid, ...four }], total: { ...four } }`. `processes`
 * holds the process read and each child it keeps, and `total` their sum.
 */
export function reading(raw, name) {
  assert.ok(raw && typeof raw === 'object', `${name}: stop() gave ${shown(raw)}, not a reading (README: Assumptions)`);
  assert.ok(typeof raw.spanMs === 'number' && Number.isFinite(raw.spanMs) && raw.spanMs >= 0, `${name}: the reading states no span: spanMs is ${shown(raw.spanMs)}`);
  assert.ok(Array.isArray(raw.processes), `${name}: processes is ${shown(raw.processes)}, not a list`);
  const processes = raw.processes.map((process, index) => {
    assert.ok(Number.isSafeInteger(process?.pid) && process.pid > 0, `${name}: processes[${index}].pid is ${shown(process?.pid)}, not a PID`);
    return { pid: process.pid, ...four(process, `${name}: processes[${index}]`) };
  });
  return { spanMs: raw.spanMs, processes, total: four(raw.total ?? {}, `${name}: total`) };
}

/** A reader behind the one way this suite calls any of them: the module at `url`, the real one's or a planted one's. */
export async function reader(url, name) {
  const start = (await import(url))[READER_START];
  assert.equal(typeof start, 'function', `${name}: ${url} exports no ${READER_START}() (README: Assumptions)`);
  return {
    name,
    async start(pid) {
      const handle = await start(pid);
      assert.equal(typeof handle?.stop, 'function', `${name}: ${READER_START}(${pid}) gave ${shown(handle)}, with no stop() (README: Assumptions)`);
      return { stop: async () => reading(await handle.stop(), name) };
    },
  };
}

export const readerFile = () => fileURLToPath(new URL('../../../benchmarks/process-reader.mjs', import.meta.url));

/** The reader under test. The base has none, and each test that needs it fails here, saying so. */
export async function realReader() {
  if (!existsSync(readerFile())) assert.fail(`no reader: ${READER_MODULE} does not exist, so nothing gives a live process's instructions, CPU time, wakeups and footprint (#2698 scope: "One reader, used by the benchmarks"; README: Assumptions)`);
  return reader(pathToFileURL(readerFile()).href, 'the reader');
}

/** A5. A task that can't take a reading it needs says so in its last line as benchmarks/hub.mjs start-to-ready does today. */
const verdict = (line) => ({ status: line.status ?? null, reason: typeof line.reason === 'string' ? line.reason : '' });
export const INCONCLUSIVE = 'INCONCLUSIVE';

/** A6. hub-idle's readings of one process, and the words a reason names each by. */
export const IDLE_READINGS = ['wakeups', 'instructionsPerSecond', 'cpuMsPerSecond', 'footprintBytes'];
export const IDLE_WORDS = { wakeups: /wakeups?/i, instructionsPerSecond: /instructions/i, cpuMsPerSecond: /cpu/i, footprintBytes: /footprint/i };

/**
 * A6. hub-idle's last line, beside what it reports today: `spanMs`, the span it read over; `hub`, the hub's own
 * `{ pid, wakeups, instructionsPerSecond, cpuMsPerSecond, footprintBytes }`; and `children`, the same for each child the
 * hub keeps.
 */
export function idleLine(line) {
  assert.ok(line.hub && typeof line.hub === 'object', `hub-idle's last line reports no reading for the hub (\`hub\`): ${shown(line)}`);
  assert.ok(Array.isArray(line.children), `hub-idle's last line reports no list of the hub's children (\`children\`): ${shown(line)}`);
  const one = (raw, where) => ({ pid: Number.isSafeInteger(raw?.pid) && raw.pid > 0 ? raw.pid : null, ...four(raw, where, IDLE_READINGS) });
  return {
    ...verdict(line),
    spanMs: typeof line.spanMs === 'number' && Number.isFinite(line.spanMs) ? line.spanMs : null,
    today: { bench: line.bench, mode: line.mode, idleCpuPercent: line.idleCpuPercent, rssBytes: line.rssBytes },
    hub: one(line.hub, 'hub-idle: hub'),
    children: line.children.map((child, index) => one(child, `hub-idle: children[${index}]`)),
  };
}

/**
 * A7. A command task's last line, beside what it reports today: `instructions`, the command's own count for each
 * round; `emptyInstructions`, an empty Node program's count for each of the same rounds, in the same order;
 * `peakFootprintBytes`, the command's peak, one number or one per round; and `modules`, a name for each module the
 * command loaded.
 */
export function commandLine(task, line) {
  const counts = (name) => {
    const value = line[name];
    assert.ok(Array.isArray(value) && value.length > 0, `${task}'s last line reports no \`${name}\`, one count for each round: ${shown(line)}`);
    return value.map((count) => count ?? null);
  };
  assert.ok(line.peakFootprintBytes !== undefined, `${task}'s last line reports no peak (\`peakFootprintBytes\`): ${shown(line)}`);
  assert.ok(Array.isArray(line.modules), `${task}'s last line reports no list of the modules the command loaded (\`modules\`): ${shown(line)}`);
  return {
    ...verdict(line),
    instructions: counts('instructions'),
    emptyInstructions: counts('emptyInstructions'),
    peaks: [line.peakFootprintBytes].flat().map((peak) => peak ?? null),
    modules: line.modules,
  };
}
