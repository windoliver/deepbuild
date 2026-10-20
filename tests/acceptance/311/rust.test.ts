import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalize, catalogue, decode, encode, fixtures, generateRust, registry } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { deleteAt, DESIGN_KINDS, fixture, fixtureSet, firstDifference, KERNEL, REPO, setAt, sha256, utf8 } from './helpers.ts';
import type { NodeFixture } from './helpers.ts';

const BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-contracts.exe' : 'deep-contracts');
const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function cargo(args: string[], cwd: string, env: Record<string, string> = {}): void {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`cargo ${args.join(' ')} failed:\n${run.stderr}`);
}
/** Runs a binary over JSON lines on stdin; resolves to its output lines, or its stderr when it fails. */
function lines(bin: string, args: string[], input: string[]): { ok: true; out: string[] } | { ok: false; error: string } {
  const run = spawnSync(bin, args, { input: `${input.join('\n')}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) return { ok: false, error: run.stderr || `exit ${run.status}` };
  return { ok: true, out: run.stdout.split('\n').filter((l, i, all) => l !== '' || i < all.length - 1) };
}

/** Compares Rust's bytes with the canonical bytes, naming the schema and the first field that differs. */
function expectSameBytes(schema: string, got: string | undefined, want: string): void {
  if (got === want) return;
  let where = '(not JSON)';
  try { where = firstDifference(JSON.parse(got ?? 'null') as JsonValue, JSON.parse(want) as JsonValue) ?? '(same value, other bytes)'; } catch { /* keep */ }
  expect(got, `${schema}: Rust's bytes differ at ${where}`).toBe(want);
}

beforeAll(() => {
  cargo(['build', '--locked', '-p', 'deep-contracts', '--bin', 'deep-contracts'], REPO);
}, 600_000);

/** The schemas deep-hook and the app read in Rust: the hook request, acknowledgement and reply, and every event kind (asks among them). */
function rustSchemas(): { name: string; values: JsonValue[] }[] {
  const hook = [
    { name: 'hook.request@1', values: [fixture('hook', 'request.json'), ...fixtures('hook.request@1')] },
    { name: 'hook.ack@1', values: [fixture('hook', 'ack-null.json'), fixture('hook', 'ack-ms.json'), ...fixtures('hook.ack@1')] },
    { name: 'hook.reply@1', values: [fixture('hook', 'reply-allow.json'), fixture('hook', 'reply-deny.json'), ...fixtures('hook.reply@1')] },
  ];
  const seqs = ['0', '9007199254740993', '9223372036854775807'].map((seq) => ({ ...(fixture('hook', 'request.json') as Record<string, JsonValue>), seq }));
  hook[0]!.values.push(...seqs);
  const kinds = DESIGN_KINDS.map((kind) => catalogue().find((e) => e.kind === kind)!.schema);
  return [...hook, ...[...new Set(kinds)].map((name) => ({ name, values: fixtures(name) }))];
}

describe('AC18 deep-hook\'s and the app\'s types are generated in Rust from the same schemas', () => {
  it('AC18 every fixture of each schema round-trips through the Rust and TypeScript types to identical bytes', () => {
    for (const { name, values } of rustSchemas()) {
      expect(values.length, `${name} has fixtures`).toBeGreaterThan(0);
      const input = values.map((v) => JSON.stringify(v));
      const want = values.map((v) => utf8(canonicalize(v)));
      const rust = lines(BIN, ['roundtrip', name], input);
      // A hand-written Rust request type without `matched` fails here, naming hook.request@1 and /matched.
      expect(rust.ok ? '' : rust.error, `${name}: Rust refused a valid fixture`).toBe('');
      if (!rust.ok) continue;
      expect(rust.out, name).toHaveLength(values.length);
      values.forEach((_, i) => {
        expectSameBytes(name, rust.out[i], want[i]!);
        expect(encode(name, decode(name, input[i]!)), `${name}: TypeScript's bytes`).toBe(want[i]);
      });
    }
  }, 120_000);

  it('AC18 the Rust request type refuses a request without matched, a seq sent as a JSON number, and a field it does not list', () => {
    const request = fixture('hook', 'request.json');
    for (const bad of [deleteAt(request, '/matched'), setAt(request, '/seq', 1760013451123456789), setAt(request, '/f_test', true)]) {
      const rust = lines(BIN, ['roundtrip', 'hook.request@1'], [JSON.stringify(bad)]);
      expect(rust.ok, `Rust takes ${JSON.stringify(bad).slice(0, 80)}`).toBe(false);
    }
  });
});

describe('AC19 the Rust encoder gives the kernel fixture\'s RFC 8785 bytes', () => {
  it.each(KERNEL.map((r) => [r.kind, r] as const))('AC19 %s', (kind, r) => {
    const rust = lines(BIN, ['jcs'], [JSON.stringify(JSON.parse(r.input))]);
    expect(rust.ok ? '' : rust.error).toBe('');
    if (!rust.ok) return;
    // An encoder that sorts keys by code point fails the package envelope, whose keys are U+E000 and U+1F600.
    expect(rust.out[0], `${kind}: Rust's RFC 8785 bytes`).toBe(r.canonical);
    expect(sha256(rust.out[0]!), `${kind}: SHA-256`).toBe(r.sha256);
  });

  it('AC19 numbers: the Rust encoder reads the fixture\'s own text, -0 and exponents included', () => {
    const numbers = KERNEL.find((r) => r.kind.startsWith('numbers'))!;
    const rust = lines(BIN, ['jcs'], [numbers.input.replace(/\n/g, ' ')]);
    expect(rust.ok && rust.out[0]).toBe(numbers.canonical);
  });
});

describe('AC22 one fixture schema per node type generates Rust types whose fixtures round-trip to identical bytes', () => {
  const NODES = fixtureSet<NodeFixture>('nodes');
  let bin = '';

  beforeAll(() => {
    // A throwaway crate outside the workspace holding only the generated module, built offline against
    // the dependencies the workspace build above already fetched.
    const dir = mkdtempSync(join(tmpdir(), 'deep-311-nodes-'));
    scratch.push(dir);
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'Cargo.toml'), [
      '[package]', 'name = "nodes-roundtrip"', 'version = "0.0.0"', 'edition = "2021"', 'publish = false', '',
      '[dependencies]', `deep-contracts = { path = ${JSON.stringify(join(REPO, 'crates', 'deep-contracts'))} }`, '', '[workspace]', '',
    ].join('\n'));
    copyFileSync(join(REPO, 'Cargo.lock'), join(dir, 'Cargo.lock'));
    writeFileSync(join(dir, 'src', 'generated.rs'), generateRust(NODES.map((n) => ({ name: n.name, schema: n.schema }))));
    writeFileSync(join(dir, 'src', 'main.rs'), `mod generated;
use std::io::{BufRead, Write};
fn main() {
    let schema = std::env::args().nth(1).expect("schema name");
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.expect("stdin");
        match generated::roundtrip(&schema, &line) {
            Ok(text) => writeln!(out, "{text}").expect("stdout"),
            Err(error) => { eprintln!("{schema}: {error}"); std::process::exit(1); }
        }
    }
}
`);
    cargo(['build', '--offline', '--quiet'], dir, { CARGO_TARGET_DIR: join(dir, 'target') });
    bin = join(dir, 'target', 'debug', process.platform === 'win32' ? 'nodes-roundtrip.exe' : 'nodes-roundtrip');
  }, 600_000);

  it('AC22 each node type\'s fixtures round-trip through Rust and TypeScript to identical bytes', () => {
    const reg = registry(NODES.map((n) => ({ name: n.name, schema: n.schema })));
    expect(NODES).toHaveLength(14);
    for (const node of NODES) {
      const input = node.instances.map((v) => JSON.stringify(v));
      const want = node.instances.map((v) => utf8(canonicalize(v)));
      const rust = lines(bin, [node.name], input);
      expect(rust.ok ? '' : rust.error, `${node.name} (${node.node})`).toBe('');
      if (!rust.ok) continue;
      node.instances.forEach((_, i) => {
        expectSameBytes(node.name, rust.out[i], want[i]!);
        expect(reg.encode(node.name, reg.decode(node.name, input[i]!)), `${node.name}: TypeScript`).toBe(want[i]);
      });
    }
  });
});
