// Test-side tools for #3233 (README). Every reading comes from the real program: the conformance package through its
// public entry, the suite's Rust half built and run by cargo (app/probe.rs), the guide and its own drift check, and
// `deep-app panel-bench` with the panel host. A process is run to its end or stopped by the PID it was started with;
// nothing leaves the machine but cargo's own fetches (--locked); no model is called. The judges are in judges.ts.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchRun, Drive, LookFills, Probed } from './judges.ts';
import { lookFills } from './judges.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Each criterion's ID: `#3233.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed. */
export const AC1 = '#3233.0404c3df';
export const AC2 = '#3233.c6c7b61c';
export const AC3 = '#3233.dd2321b3';
export const AC4 = '#3233.5531067a';
export const AC5 = '#3233.e6784a2a';
export const AC6 = '#3233.58c6f0e7';
export const AC7 = '#3233.640994cd';

export const BUILD_MS = 60 * 60_000;
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

export interface Ran { code: number | null; stdout: string; stderr: string }
export const show = (r: Ran): string => `exit ${String(r.code)}\n--- stdout\n${r.stdout.slice(-4000)}\n--- stderr\n${r.stderr.slice(-4000)}`;

export function cargo(args: string[], env: NodeJS.ProcessEnv = CARGO_ENV): Ran {
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: BUILD_MS });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}

// ---- The kit, through the conformance package's public entry (as #349's suite reaches it).

const CONFORMANCE_ENTRY = '../../../packages/conformance/src/index.ts';
export const conformance = () => import(new URL(CONFORMANCE_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/conformance/src/index.ts')>;
export const PANEL = 'panel@1';

// ---- The shipped look's fills, from its own file.

export const LOOK = 'crates/deep-canvas-marks/looks/clean.json';
export const shippedFills = (): LookFills => lookFills(JSON.parse(readFileSync(join(REPO, LOOK), 'utf8')));

// ---- The Rust half (app/probe.rs), built and run once by cargo.

export const RUST_TARGET = 'acceptance_3233';
export interface Report { probes: Record<string, Probed & Drive> }
/**
 * Everything app/probe.rs found, or why it found nothing: the target isn't registered in crates/deep-replica/Cargo.toml,
 * it doesn't build, or it wrote no report. A probe that didn't run is BLOCKED, never a pass.
 */
export function probe(): { report: Report | null; why: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-3233-probe-'));
  const out = join(dir, 'report.json');
  try {
    const r = cargo(['test', '--locked', '-p', 'deep-replica', '--test', RUST_TARGET, '--', '--out', out]);
    let text: string;
    try { text = readFileSync(out, 'utf8'); } catch {
      const why = /no test target named/.test(r.stderr) ? `crates/deep-replica/Cargo.toml registers no [[test]] ${RUST_TARGET} (README, What the implementer adds)`
        : /could not compile|error(\[E\d+\])?:/.test(r.stderr) ? 'the Rust half does not build' : 'the Rust half wrote no report';
      return { report: null, why: `BLOCKED: ${why}\n${show(r)}` };
    }
    return { report: JSON.parse(text) as Report, why: '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** One probe's findings from a report; with no report, the reason it is missing, thrown. */
export function probed(found: { report: Report | null; why: string }, name: string): (Probed & Drive) | undefined {
  if (!found.report) throw Error(found.why);
  return found.report.probes[name];
}

// ---- The guide.

export const GUIDE = 'docs/extension-guide.md';
export const readGuide = (): string => readFileSync(join(REPO, GUIDE), 'utf8');
/** `node scripts/guide.mjs --check` from the repo root, the guide's own drift check. */
export function guideCheck(): Ran {
  const r = spawnSync(process.execPath, ['scripts/guide.mjs', '--check'], { cwd: REPO, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 1 << 26 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}

// ---- The budget: a 500-node update through `deep-app panel-bench` and the panel host (as #358's suite builds them).

/**
 * #358's build (docs/spikes/358/record.json) in the dev profile, which the preflight's budgets are read off, with
 * cargo's messages, which say what it built. `panel-bench` is behind deep-app's `panel-check` feature, so this build
 * is the test's own and no proof run's `DEEP_BIN_DIR` stands in for it.
 */
export const BENCH_BUILD = ['build', '--locked', '-p', 'deep-panel-host', '-p', 'deep-app', '--features', 'deep-app/panel-check'];
interface Artifact { reason?: string; target?: { name?: string; kind?: string[] }; executable?: string | null }
/** The dev `deep-app` (with `panel-check`) and `deep-panel-host`; a build that fails is BLOCKED. */
export function benchBinaries(): { app: string; host: string } {
  const r = cargo([...BENCH_BUILD, '--message-format=json']);
  if (r.code !== 0) throw Error(`BLOCKED: cargo ${BENCH_BUILD.join(' ')} failed\n${r.stderr.slice(-4000)}`);
  const messages = r.stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as Artifact);
  const bin = (name: string): string => {
    const artifact = messages.find((m) => m.reason === 'compiler-artifact' && m.target?.name === name && m.target.kind?.includes('bin'));
    if (!artifact?.executable) throw Error(`BLOCKED: cargo built no binary ${name}`);
    return artifact.executable;
  };
  return { app: bin('deep-app'), host: bin('deep-panel-host') };
}

/** The rows of the 500-node panel: with the root and one bare div, 249 rows of a div and its text make 500 nodes. */
export const BENCH_ROWS = 249;
export const BENCH_NODES = 500;
/**
 * A panel whose every update is a tree of 500 nodes that passes revision 2 and gives each rule its most work: 249 rows,
 * each a div that takes a press, takes focus, holds its own text and sets that text's color, #595959, on the root's
 * bg of #ffffff.
 */
export const BENCH_PANEL = `import { View, div, v_flex } from "@deepbuild/panel";

const ROWS = ${BENCH_ROWS};

export default class Rows extends View {
  init(_props, cx) {
    this.pressed = 0;
    this.handles = [];
    for (let i = 0; i < ROWS; i += 1) this.handles.push(cx.focus_handle());
  }

  render() {
    let rows = v_flex().size_full().bg("#ffffff").child(div());
    for (let i = 0; i < ROWS; i += 1) {
      rows = rows.child(
        div()
          .track_focus(this.handles[i])
          .text_color("#595959")
          .on_click((_event, cx) => {
            this.pressed += 1;
            cx.notify();
          })
          .child(\`Row \${i + 1}\`),
      );
    }
    return rows;
  }
}
`;
export interface Bench { runs?: BenchRun[]; tree?: unknown }
/**
 * `deep-app panel-bench` on the 500-node panel: `runs` fresh hosts, each warmed up and then timed for `updates`
 * updates. Its report, or the reason it gave none, thrown as BLOCKED.
 */
export function bench(bins: { app: string; host: string }, runs: number, updates: number): Bench {
  const dir = mkdtempSync(join(tmpdir(), 'deep-3233-bench-'));
  try {
    writeFileSync(join(dir, 'main.js'), BENCH_PANEL);
    const out = join(dir, 'bench.json');
    const args = ['panel-bench', '--host', bins.host, '--panel', dir, '--origin', 'agent_built', '--runs', String(runs), '--updates', String(updates), '--out', out];
    const r = spawnSync(bins.app, args, { cwd: REPO, encoding: 'utf8', timeout: 30 * 60_000, maxBuffer: 1 << 26 });
    let text: string;
    try { text = readFileSync(out, 'utf8'); } catch {
      throw Error(`BLOCKED: deep-app panel-bench wrote no report on the 500-node panel\n${show({ code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') })}`);
    }
    return JSON.parse(text) as Bench;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
