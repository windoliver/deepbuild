// #2359: public Cargo.lock and Cargo's resolver, not an implementation API or a #2298 advisory scanner.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCK = join(ROOT, 'Cargo.lock');
const AC1 = 'AC1 #2359.74e0b9bf';
const RULES = [
  { crate: 'rsa', old: '0.10.0-rc.18', floor: '0.10.0', advisories: ['RUSTSEC-2023-0071'],
    roots: ['deep-app', 'deep-panel-host'], via: ['gpui-shell', 'quickjs-jit-stdlib', 'llrt_crypto', 'rsa'] },
  { crate: 'quick-xml', old: '0.38.4', floor: '0.41.0', advisories: ['RUSTSEC-2026-0194', 'RUSTSEC-2026-0195'],
    roots: ['deep-typeset'], via: ['citationberg', 'quick-xml'] },
  { crate: 'rkyv', old: '0.7.46', floor: '0.8.17', advisories: ['RUSTSEC-2026-0235'],
    roots: ['deep-typeset'], via: ['mitex-spec', 'rkyv'] },
];

// Read only Cargo's generated package records, not arbitrary TOML. Cargo metadata below independently
// validates the complete lock/manifests/features. IDs are array indices, including distinct sources.
function lockGraph(text) {
  const packages = text.split(/^\[\[package\]\]\s*$/m).slice(1).map((block) => {
    const field = (name) => {
      const value = block.match(new RegExp(`^${name} = (".*")$`, 'm'))?.[1];
      return value === undefined ? undefined : JSON.parse(value);
    };
    const deps = block.match(/^dependencies = \[([\s\S]*?)\]/m)?.[1] ?? '';
    const strings = [...deps.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(([value]) => JSON.parse(value));
    assert.equal(deps.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/[\s,]/g, ''), '', 'unreadable Cargo.lock dependencies');
    const p = { name: field('name'), version: field('version'), source: field('source'), refs: strings };
    assert.ok(p.name && p.version, 'Cargo.lock package missing name/version');
    return p;
  });
  assert.ok(packages.length, 'Cargo.lock has no packages');
  return packages.map((p) => ({ ...p, deps: p.refs.map((ref) => {
    const match = ref.match(/^(\S+)(?: ([^\s(]+))?(?: \((.+)\))?$/);
    assert.ok(match, `unreadable Cargo.lock edge: ${ref}`);
    const [, name, version, source] = match;
    const ids = packages.flatMap((q, id) => q.name === name && (!version || q.version === version)
      && (!source || q.source === source) ? [id] : []);
    assert.equal(ids.length, 1, `Cargo.lock edge ${p.name} -> ${ref} must resolve unambiguously`);
    return ids[0];
  }) }));
}

function metadataGraph(metadata) {
  assert.ok(metadata.resolve?.nodes?.length, 'BLOCKED: Cargo returned no dependency resolution');
  const ids = new Map(metadata.packages.map((p, id) => [p.id, id]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  return metadata.packages.map((p) => {
    const node = nodes.get(p.id);
    assert.ok(node, `Cargo omitted resolve node for ${p.name}`);
    // Dev-only edges do not establish a shipped dependency path; build edges do (MiTeX's spec).
    const deps = node.deps.filter((d) => d.dep_kinds.some((k) => k.kind !== 'dev')).map((d) => {
      assert.ok(ids.has(d.pkg), `Cargo omitted dependency ${d.name}`);
      return ids.get(d.pkg);
    });
    return { name: p.name, version: p.version, deps };
  });
}

// Match the issue's ordered waypoints, allowing intermediates (e.g. Typst -> hayagriva -> citationberg).
// Visit every package identity, not just the first/newest copy of a crate. Starting at
// deep-typeset also covers its direct mitex-spec-gen branch, not only the mitex parser branch.
function paths(graph, names) {
  const queue = graph.flatMap((p, id) => p.name === names[0] ? [{ id, next: 0, path: [] }] : []);
  const seen = new Set(), found = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { id, next, path } = queue[cursor];
    const key = `${id}:${next}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = graph[id], route = [...path, id];
    const step = next + Number(p.name === names[next]);
    if (step === names.length) { found.push(route); continue; }
    for (const dep of p.deps) queue.push({ id: dep, next: step, path: route });
  }
  return found;
}

function atLeast(version, floor) {
  const actual = version.match(/^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  assert.ok(actual, `unreadable Cargo version: ${version}`);
  const want = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (Number(actual[i + 1]) !== want[i]) return Number(actual[i + 1]) > want[i];
  }
  return !actual[4]; // 0.10.0-rc.18 is NOT 0.10.0; build metadata does not change precedence.
}

const label = (rule) => `${rule.crate}: ${rule.advisories.join(', ')}`;
const routeLabel = (graph, route) => route.map((id) => `${graph[id].name}@${graph[id].version}`).join(' -> ');
function problems(graph, rules = RULES) {
  const errors = [];
  for (const rule of rules) for (const root of rule.roots) {
    const routes = paths(graph, [root, ...rule.via]);
    if (!routes.length) errors.push(`${label(rule)}: missing affected path ${[root, ...rule.via].join(' -> ')}`);
    for (const route of routes) {
      const p = graph[route.at(-1)];
      if (!atLeast(p.version, rule.floor)) errors.push(`${label(rule)}: locked ${p.version}, requires >= ${rule.floor}; ${routeLabel(graph, route)}`);
    }
  }
  return errors;
}
const assertFixed = (graph, rules = RULES) => assert.deepEqual(problems(graph, rules), [], 'affected dependency paths must use the fixed releases');

for (const rule of RULES) {
  test(`${AC1}: locked ${rule.crate} on its affected path`, () => {
    assertFixed(lockGraph(readFileSync(LOCK, 'utf8')), [rule]);
  });

  test(`${AC1}: planted ${rule.crate}@${rule.old} fails with crate/advisory diagnostics`, (t) => {
    // In-memory copies of the real lock graph, NOT fabricated claims of successful Cargo resolution.
    // Isolate each held dependency: promote all affected nodes for the positive control, then retain
    // just this old version. A disconnected fixed-version decoy must not mask the affected path.
    const clean = lockGraph(readFileSync(LOCK, 'utf8'));
    for (const r of RULES) for (const root of r.roots) {
      const routes = paths(clean, [root, ...r.via]);
      assert.ok(routes.length, `cannot plant ${label(r)} without its actual affected path`);
      for (const route of routes) clean[route.at(-1)].version = r.floor;
    }
    assertFixed(clean);
    const planted = structuredClone(clean);
    for (const root of rule.roots) for (const route of paths(planted, [root, ...rule.via])) {
      planted[route.at(-1)].version = rule.old;
    }
    planted.push({ name: rule.crate, version: rule.floor, deps: [] });
    const errors = problems(planted);
    assert.ok(errors.length > 0, `${label(rule)}: old-version copy was incorrectly accepted`);
    for (const error of errors) {
      assert.ok(error.startsWith(`${label(rule)}: locked ${rule.old}, requires >= ${rule.floor};`), error);
    }
    assert.throws(() => assertFixed(planted), { code: 'ERR_ASSERTION' });
    t.diagnostic(errors.join('\n'));
  });
}

test(`${AC1}: Cargo resolves offline and locked, with fixed versions on the resolved paths`, (t) => {
  const before = readFileSync(LOCK);
  const result = spawnSync('cargo', ['metadata', '--format-version', '1', '--locked', '--offline'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_NET_OFFLINE: 'true', RUSTUP_AUTO_INSTALL: '0' },
  });
  assert.deepEqual(readFileSync(LOCK), before, 'locked resolution must not rewrite Cargo.lock');
  const redact = (s) => String(s).replaceAll(ROOT.replace(/\/$/, ''), '<repo>').replaceAll(homedir(), '<home>');
  assert.ifError(result.error && new Error(`BLOCKED: cargo metadata could not run (${result.error.code ?? 'unknown'})`));
  assert.equal(result.status, 0, `FAIL/BLOCKED: offline locked resolution failed; no resolver proof\n${redact(result.stderr)}`);
  const graph = metadataGraph(JSON.parse(result.stdout));
  assertFixed(graph);
  for (const rule of RULES) for (const root of rule.roots) {
    for (const route of paths(graph, [root, ...rule.via])) t.diagnostic(routeLabel(graph, route));
  }
});

test('AC3 #2359.4f887837 (suppression-config portion only): no stale ignores or RSA workaround', (t) => {
  // Public conventional Cargo audit/deny configuration only. Absence is NOT an advisory-lane PASS.
  // Comments may document an old ignore; an active advisory ID in these suppression files may not.
  const configs = ['.cargo/audit.toml', '.cargo/deny.toml', 'audit.toml', 'deny.toml', '.deny.toml', '.config/deny.toml'];
  const present = configs.filter((file) => existsSync(join(ROOT, file)));
  for (const file of present) {
    const active = readFileSync(join(ROOT, file), 'utf8')
      .replace(/"(?:[^"\\]|\\.)*"|'[^']*'|#[^\n]*/g, (token) => token.startsWith('#') ? '' : token);
    for (const rule of RULES) for (const advisory of rule.advisories) {
      assert.ok(!active.includes(advisory), `${file}: remove suppression for ${rule.crate} ${advisory}; resolve the dependency, do not ignore it`);
    }
  }
  t.diagnostic(`Suppression configs inspected: ${present.join(', ') || 'none present'}. #2298 advisory result is NOT covered; see README.md.`);
});
