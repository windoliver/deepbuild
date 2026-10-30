// #21 AC4: process start for a native no-op binary, Node, Bun and Python, measured on the reference Mac with
// hyperfine, warm-up runs first and no shell, recorded as readings with the method, the versions and the date, and
// cited by the design's Hook overhead row. The measurement is `node docs/spikes/21/measure.mjs`, which prints the
// readings as one JSON object; docs/spikes/21/record.json's `processStart` is its run on a reference Mac, as
// docs/spikes/573/record.json holds week 1's other readings (README: Readings). Before any recorded number counts,
// the script is shown to measure what the criterion says: run here with a `hyperfine` first on PATH that writes down
// its arguments and runs the real one, it must time all four no-op programs with `-N` (no shell) and warm-up runs.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import { AC4, cleanup, hyperfinePath, isReferenceMachine, NODE, REPO, run, shownRan, tempDir, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const SCRIPT = join(REPO, 'docs/spikes/21/measure.mjs');
const RECORD = join(REPO, 'docs/spikes/21/record.json');
const DESIGN = join(REPO, 'docs/technical-design.md');
const KINDS = ['native', 'node', 'bun', 'python'] as const;
type Kind = (typeof KINDS)[number];

/** hyperfine's own splitting of a command under -N (shell words: quotes and backslashes, no shell). */
function shellWords(command: string): string[] {
  const out: string[] = [];
  let word = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (c === '\\' && i + 1 < command.length) { word += command[++i]; has = true; }
    else if (/\s/.test(c)) { if (has || word) out.push(word); word = ''; has = false; }
    else { word += c; has = true; }
  }
  if (has || word) out.push(word);
  return out;
}
/** Option names of hyperfine 1.x that take a value, so the arguments left are the commands it times. */
const VALUED = new Set(['-r', '--runs', '-m', '--min-runs', '-M', '--max-runs', '-w', '--warmup', '-p', '--prepare', '-c', '--cleanup', '-s', '--setup', '-S', '--shell', '--export-json', '--export-csv', '--export-markdown', '--export-asciidoc', '--export-orgmode', '-n', '--command-name', '--input', '--output', '--style', '-u', '--time-unit', '-L', '--parameter-list', '-P', '--parameter-scan', '-D', '--parameter-step-size', '--sort', '--reference', '--conclude']);
function commandsOf(argv: string[]): string[] {
  const commands: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--reference') { commands.push(argv[++i] ?? ''); continue; }
    if (a.startsWith('--reference=')) { commands.push(a.slice('--reference='.length)); continue; }
    if (a.startsWith('-')) { if (VALUED.has(a)) i++; if (a === '-P' || a === '--parameter-scan') i += 2; continue; }
    commands.push(a);
  }
  return commands;
}
const noShell = (argv: string[]) => argv.some((a, i) => a === '-N' || a === '--shell=none' || ((a === '--shell' || a === '-S') && argv[i + 1] === 'none'));
function warmups(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--warmup' || a === '-w') return Number(argv[i + 1]);
    if (a.startsWith('--warmup=')) return Number(a.slice('--warmup='.length));
    if (/^-w\d+$/.test(a)) return Number(a.slice(2));
  }
  return 0;
}
const isMachO = (path: string): boolean => {
  try {
    return [0xcffaedfe, 0xcefaedfe, 0xcafebabe, 0x7f454c46].includes(readFileSync(path).subarray(0, 4).readUInt32BE(0));
  } catch {
    return false;
  }
};
const resolveWord = (word: string): string => (word.includes('/') ? word : spawnSync('/bin/sh', ['-c', 'command -v "$0"', word], { encoding: 'utf8' }).stdout.trim());
/** Which of the four programs a command runs, by its program: node, bun, python, or a native binary that isn't deep-hook. */
function kindOf(command: string): Kind | undefined {
  const [word] = shellWords(command);
  if (!word) return undefined;
  const path = resolveWord(word);
  const name = basename(path || word);
  if (name === 'node') return 'node';
  if (name === 'bun') return 'bun';
  if (/^python(3(\.\d+)?)?$/.test(name)) return 'python';
  return path && isMachO(path) && !/deep-hook/.test(name) ? 'native' : undefined;
}
/** The command runs as hyperfine -N runs it (no shell), exits 0 and prints nothing: a no-op. */
function isNoop(command: string): boolean {
  const [program, ...args] = shellWords(command);
  if (!program) return false;
  const r = spawnSync(program, args, { encoding: 'utf8', input: '', timeout: 30_000 });
  return r.status === 0 && r.stdout === '' && r.stderr === '';
}

/** Every way a processStart reading falls short (README: The readings' shape); `fresh` also holds it to this machine and today. */
function readingProblems(p: Line | undefined, fresh: { invocations: string[][]; hyperfine: string } | null): string[] {
  const out: string[] = [];
  if (!p || typeof p !== 'object') return ['there is no processStart reading'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) out.push(`date ${JSON.stringify(p.date)} is not YYYY-MM-DD`);
  else if (Date.parse(`${p.date}T00:00:00Z`) > Date.now()) out.push(`date ${p.date} is in the future`);
  const m = p.machine as Line | undefined;
  if (!m || typeof m.model !== 'string' || typeof m.chip !== 'string' || !Number.isFinite(m.memoryBytes)) out.push(`machine ${JSON.stringify(m)} lacks its model, chip and memory`);
  if (typeof m?.macosBuild !== 'string' || !m.macosBuild) out.push('machine lacks its macOS build');
  if (!/hyperfine/i.test(String(p.method ?? ''))) out.push(`method ${JSON.stringify(p.method)} doesn't say it is hyperfine`);
  const hv = String(p.hyperfine?.version ?? '');
  if (!/hyperfine \d+\.\d+\.\d+/.test(hv)) out.push(`hyperfine.version ${JSON.stringify(hv)} isn't hyperfine's own --version line`);
  const argv = (Array.isArray(p.hyperfine?.argv) ? p.hyperfine.argv : []) as string[][];
  if (!argv.length || argv.some((a) => !Array.isArray(a))) out.push(`hyperfine.argv ${JSON.stringify(p.hyperfine?.argv)} is not the list of hyperfine's argument lists`);
  for (const kind of KINDS) {
    const prog = (p.programs as Line | undefined)?.[kind] as Line | undefined;
    if (!prog) { out.push(`programs.${kind} is missing`); continue; }
    const command = String(prog.command ?? '');
    if (kindOf(command) !== kind) out.push(`programs.${kind}.command ${JSON.stringify(command)} doesn't run ${kind === 'native' ? 'a native binary' : kind}`);
    const timedBy = argv.find((a) => commandsOf(a).includes(command));
    if (!timedBy) out.push(`programs.${kind}.command ${JSON.stringify(command)} isn't a command of any recorded hyperfine run`);
    else {
      if (!noShell(timedBy)) out.push(`the hyperfine run of ${kind} ran a shell: ${JSON.stringify(timedBy)} has no -N`);
      if (!(warmups(timedBy) >= 1)) out.push(`the hyperfine run of ${kind} had no warm-up runs first: ${JSON.stringify(timedBy)}`);
    }
    if (!/\d/.test(String(prog.version ?? ''))) out.push(`programs.${kind}.version ${JSON.stringify(prog.version)} names no version`);
    const times = prog.timesMs as number[] | undefined;
    if (!Array.isArray(times) || times.length < 20 || times.some((t) => !Number.isFinite(t) || t <= 0)) out.push(`programs.${kind}.timesMs holds ${Array.isArray(times) ? times.length : 'no'} readings, not 20 or more`);
    else {
      if (prog.runs !== times.length) out.push(`programs.${kind}.runs ${prog.runs} isn't the ${times.length} readings it holds`);
      const sorted = [...times].sort((a, b) => a - b);
      const lo = sorted[Math.floor((sorted.length - 1) / 2)]!;
      const hi = sorted[Math.ceil((sorted.length - 1) / 2)]!;
      if (!(prog.medianMs >= lo - 1e-6 && prog.medianMs <= hi + 1e-6)) out.push(`programs.${kind}.medianMs ${prog.medianMs} isn't the median of its readings (${lo} to ${hi})`);
      if (!(prog.p95Ms >= prog.medianMs && prog.p95Ms <= sorted.at(-1)! + 1e-6)) out.push(`programs.${kind}.p95Ms ${prog.p95Ms} isn't a p95 of its readings`);
    }
  }
  if (fresh) {
    const today = new Date();
    const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (p.date !== local) out.push(`date ${p.date} isn't today, ${local}`);
    const sys = (k: string) => execFileSync('sysctl', ['-n', k], { encoding: 'utf8' }).trim();
    if (m?.model !== sys('hw.model') || m?.chip !== sys('machdep.cpu.brand_string') || m?.memoryBytes !== Number(sys('hw.memsize'))) out.push(`machine ${JSON.stringify(m)} isn't this machine`);
    if (JSON.stringify(argv) !== JSON.stringify(fresh.invocations)) out.push(`hyperfine.argv ${JSON.stringify(argv)} isn't what hyperfine was run with: ${JSON.stringify(fresh.invocations)}`);
    if (!hv.includes(fresh.hyperfine)) out.push(`hyperfine.version ${JSON.stringify(hv)} isn't this hyperfine's, ${fresh.hyperfine}`);
    for (const kind of ['node', 'bun', 'python'] as const) {
      const prog = (p.programs as Line | undefined)?.[kind] as Line | undefined;
      const [word] = shellWords(String(prog?.command ?? ''));
      if (!word) continue;
      const r = spawnSync(word, ['--version'], { encoding: 'utf8', timeout: 30_000 });
      const said = `${r.stdout}${r.stderr}`.trim();
      if (!said || !String(prog?.version ?? '').includes(said)) out.push(`programs.${kind}.version ${JSON.stringify(prog?.version)} isn't what ${word} --version says, ${JSON.stringify(said)}`);
    }
  }
  return out;
}

describe(`${AC4} Process start for a native no-op binary, Node, Bun and Python, each a no-op, is measured on the reference Mac with hyperfine, warm-up runs first and no shell, and recorded as readings with the method, the versions and the date; the Hook overhead row's reason cites that recorded run`, () => {
  it(`${AC4} node docs/spikes/21/measure.mjs runs hyperfine with -N and warm-up runs over a native no-op, Node, Bun and Python, each a no-op, and prints the readings with the method, the versions and the date`, async (ctx: TestContext) => {
    expect(existsSync(SCRIPT), `the measurement ${SCRIPT} exists`).toBe(true);
    const real = hyperfinePath();
    if (!real) ctx.skip('INCONCLUSIVE: hyperfine is not on PATH, so the measurement can\'t be run');
    const bin = join(tempDir(), 'bin');
    mkdirSync(bin);
    const log = join(bin, 'argv.log');
    writeFileSync(join(bin, 'hyperfine'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done >> '${log}'\nprintf '\\n' >> '${log}'\nexec '${real}' "$@"\n`);
    chmodSync(join(bin, 'hyperfine'), 0o755);
    const r = await run(NODE, [SCRIPT], { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, timeoutMs: 1_200_000 });
    expect(r.code, `node docs/spikes/21/measure.mjs exits 0: ${shownRan(r)}`).toBe(0);
    const invocations = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\0').filter((a) => a.length)) : [];
    // The version check reads the real hyperfine's own line; the wrapper isn't what the readings name.
    const version = spawnSync(real!, ['--version'], { encoding: 'utf8' }).stdout.trim();
    const timed = invocations.filter((a) => commandsOf(a).length);
    expect(timed.length, 'the measurement ran hyperfine').toBeGreaterThan(0);
    for (const kind of KINDS) {
      const by = timed.find((a) => commandsOf(a).some((c) => kindOf(c) === kind && isNoop(c)) && noShell(a) && warmups(a) >= 1);
      expect(by, `hyperfine timed a no-op ${kind === 'native' ? 'native binary' : kind} with -N and at least one warm-up run; it was run with ${JSON.stringify(invocations)}`).toBeDefined();
    }
    let printed: Line | undefined;
    try { printed = JSON.parse(r.stdout) as Line; } catch { printed = undefined; }
    expect(printed, `the measurement prints its readings as one JSON object: ${shownRan(r)}`).toBeDefined();
    expect(readingProblems(printed, { invocations: timed, hyperfine: version })).toEqual([]);
  }, 1_500_000);

  it(`${AC4} docs/spikes/21/record.json's processStart is that measurement's run on a reference Mac, with the method, the versions and the date`, () => {
    expect(existsSync(RECORD), `${RECORD} exists`).toBe(true);
    const p = (JSON.parse(readFileSync(RECORD, 'utf8')) as Line).processStart as Line | undefined;
    expect(readingProblems(p, null)).toEqual([]);
    expect(isReferenceMachine(p!.machine), `the readings were taken on a reference Mac on mains power, Low Power Mode off, thermal state nominal: ${JSON.stringify(p!.machine)}`).toBe(true);
  });

  it(`${AC4} the design's Hook overhead row keeps its target and its reason cites the recorded run, docs/spikes/21/record.json and its date, in place of the unrecorded estimate`, () => {
    const row = readFileSync(DESIGN, 'utf8').split('\n').find((l) => l.startsWith('| Hook overhead |'));
    expect(row, 'docs/technical-design.md has the Hook overhead row').toBeDefined();
    const cells = row!.split('|').map((c) => c.trim());
    expect(cells[2], 'the target is unchanged: a change never moves its own budget').toBe('Under 10 ms at p95 on top of process start, except holds');
    const why = cells.slice(3).join('|');
    expect(why, 'the reason cites the recorded run by its file').toContain('spikes/21/record.json');
    expect(existsSync(RECORD), `${RECORD} exists`).toBe(true);
    const date = String(((JSON.parse(readFileSync(RECORD, 'utf8')) as Line).processStart as Line | undefined)?.date ?? '');
    const [y, mo, d] = date.split('-').map(Number);
    const words = y ? `${new Date(Date.UTC(y, mo! - 1, d)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d}` : '<no date>';
    expect(why.includes(date) || why.includes(words), `the reason gives the recorded run's date, ${date} or ${words}: ${why}`).toBe(true);
    expect(why, 'the reason no longer rests on a method nobody recorded').not.toMatch(/nobody recorded/);
    expect(why, 'process start is no longer an estimate waiting for week 1').not.toMatch(/estimate until week 1/);
  });
});
