// The extension host's kit (#348): planted extensions, each a case the host must handle. Its package tries to
// record decisions itself, appending a verdict.made and a decision.created through deep.record.append; each must be
// refused at the record, naming the kind, with nothing appended, whether the package loads in the hub as a
// first-party package or in the platform sandbox.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from '@deepbuild/contracts';
import type { CheckSpec } from '@deepbuild/conformance';
import { ulid, type RecordStore } from '@deepbuild/record';
import { packageDigest } from './digest.js';
import type { ExtensionHost, ReleaseEntry } from './host.js';

export interface HostKitCase { id: string; rule: string; firstParty: boolean; extension: string }
export interface HostKit { cases: HostKitCase[] }
export interface HostKitReport { verdict: 'PASS' | 'FAIL'; cases: { id: string; outcome: 'PASS' | 'FAIL'; message: string }[] }

const PACKAGE = fileURLToPath(new URL('../kit/decision-kinds/', import.meta.url));
const KINDS = ['verdict.made', 'decision.created'];
const REPORT = 'ext.decisionkinds.report';
const SPEC: CheckSpec = { kind: REPORT, runner: 'report', inputs: [], depth: 'unit', oracle: 'code', contract: null };

export function hostKit(): HostKit {
  const rule = (where: string) => `An extension ${where} that appends verdict.made or decision.created is refused at the record, naming the kind, and nothing is appended`;
  return {
    cases: [
      { id: 'first-party-decision-kinds', rule: rule('inside the signed release, in the hub'), firstParty: true, extension: PACKAGE },
      { id: 'sandboxed-decision-kinds', rule: rule('from outside the signed release, in the platform sandbox'), firstParty: false, extension: PACKAGE },
    ],
  };
}

/** `open` gives a fresh host whose release lists `release`, and its record. A kit with no case proves nothing and fails. */
export async function runHostKit(kit: HostKit, open: (release: ReleaseEntry[]) => Promise<{ host: ExtensionHost; record: RecordStore }>): Promise<HostKitReport> {
  const cases: HostKitReport['cases'] = [];
  for (const c of kit.cases) {
    const problem = await runCase(c, open).catch((e: unknown) => `the case didn't run: ${String((e as Error)?.message ?? e)}`);
    cases.push({ id: c.id, outcome: problem ? 'FAIL' : 'PASS', message: problem ?? c.rule });
  }
  return { verdict: cases.length && cases.every((c) => c.outcome === 'PASS') ? 'PASS' : 'FAIL', cases };
}

/** One case: the planted package, its events written in, loaded where the case puts it. The problem found, or null. */
async function runCase(c: HostKitCase, open: (release: ReleaseEntry[]) => Promise<{ host: ExtensionHost; record: RecordStore }>): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-kit-'));
  try {
    cpSync(c.extension, dir, { recursive: true });
    const now = Date.now();
    const events = KINDS.map((kind) => {
      const fixture = fixtures(`${kind}@1`)[0] as { v: number; data: unknown };
      return { v: fixture.v, id: ulid(now), kind, ts: now, data: fixture.data };
    });
    writeFileSync(join(dir, 'events.json'), JSON.stringify(events));
    const manifestPath = join(dir, 'deepbuild.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { id: string; version: string; digest: string };
    manifest.digest = packageDigest(dir);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const { host, record } = await open(c.firstParty ? [{ id: manifest.id, version: manifest.version, digest: manifest.digest }] : []);
    const pkg = await host.install({ from: dir, builtBy: null });
    const conformance = await host.check(pkg);
    if (!conformance.passed) return `its package failed conformance: ${conformance.reasons.join('; ')}`;
    const load = await host.load(pkg);
    const place = c.firstParty ? 'hub' : 'sandbox';
    if (load.status !== 'loaded') return `its package didn't load: ${load.reason}`;
    if (load.place !== place) return `its package loaded in the ${load.place}, not the ${place}`;
    const report = await host.runCheck(REPORT, SPEC, { checkout: dir, deadline: 30_000 });
    const seen = JSON.parse(report.failures[0]?.message ?? '{}') as Record<string, { appended: boolean; error: string | null } | undefined>;
    const problems: string[] = [];
    for (const kind of KINDS) {
      const tried = seen[kind];
      if (!tried) problems.push(`the package never tried ${kind}`);
      else if (tried.appended) problems.push(`the record took ${kind} from the package`);
      else if (!(tried.error ?? '').includes(kind)) problems.push(`the refusal of ${kind} doesn't name it: ${tried.error}`);
    }
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      for (const e of page) if (KINDS.includes(e.kind)) problems.push(`the record holds a ${e.kind} written by ${e.writer}`);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return problems.length ? problems.join('; ') : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
