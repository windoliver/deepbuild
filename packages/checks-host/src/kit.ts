// check.kind@1's kit for each host kind (#1943), run by the conformance package's one runner on a test host. Every case
// is made over the host link in a folder of its own under the kit's folder there, its user units named after that
// folder, and taken down when it ends (units stopped, disabled, unlinked and reset; the folder removed). Each kind's
// fixed part holds work that holds, the work with a planted fault (ids starting `planted-`), a run that crashes and a
// run past its deadline; its seeded part draws the work's values. Each rule has one planted runner that breaks it
// alone: the reference with one fault.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename } from 'node:path';
import { fail, Finding } from '@deepbuild/conformance/findings';
import type { CheckContext, CheckResult, Fixture, PlantedFill, Random, RunOutcome, SlotCase, SlotKitImpl, SlotRule } from '@deepbuild/conformance';
import { runHost } from './run.js';
import type { HostFill, HostKind, HostSpec, Listener, TestHost } from './types.js';

const SLOT = 'check.kind@1';
/** Far past any case's run: an SSH call and a restart's settle under load. */
const LONG = 120_000;
/** The deadline cases: work that takes SLOW_S seconds against a DEADLINE ms deadline. */
const DEADLINE = 2000;
const SLOW_S = 10;
const OUTCOMES: readonly RunOutcome[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];

const RULES = {
  work: { id: 'outcome-from-host', rule: 'The outcome is the host\'s: what doesn\'t hold there fails at the check\'s assertion, naming the setting or service, and what holds passes, read again at each run.', message: 'reported a run other than what the host shows', code: 'host_outcome' },
  deadline: { id: 'deadline-holds', rule: 'A run still going at its deadline is overran; a result that arrives after the deadline is never passed or failed.', message: 'reported a result after the deadline instead of overran', code: 'reported_after_deadline' },
  crash: { id: 'crash-output-kept', rule: 'A run that stops on an error before its assertion is failed, its error kept as a failure that isn\'t the check\'s assertion.', message: 'dropped a crashed run\'s output', code: 'crash_output_dropped' },
} as const;
type Rule = keyof typeof RULES;
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

/**
 * A user unit a case makes, `{unit}-<name>.service`: a script that marks itself up and runs while the case's folder
 * exists. `lock` is the exit code of a start that finds the lock its first start took (it doesn't survive a restart);
 * `slow` starts take SLOW_S seconds.
 */
interface Unit { name: string; enabled: boolean; lock?: number; slow?: boolean; every?: number }
/**
 * A case's work. `{host}`, `{dir}` (the case's folder on the host) and `{unit}` (its units' prefix) are filled in when
 * the case is made. `files` are written under `{dir}`; `slow` is a pipe there whose text arrives SLOW_S seconds in;
 * `drift` files are written after a first run, whose outcome is the expected `first`; `listening_now` fills the spec's
 * `listening` with what listens on the host as the case is made.
 */
interface Work { spec: HostSpec; deadline: number; files?: Record<string, string>; units?: Unit[]; slow?: { file: string; text: string }; drift?: Record<string, string>; listening_now?: boolean }
/** What the run must come to: its outcome, a failure at the assertion holding `assertion` and none holding `not`, a crash's failure holding `crash`. */
interface Expected { outcome: RunOutcome; first?: RunOutcome; assertion?: string; not?: string; crash?: string }

const base = { inputs: [] as string[], depth: 'integration', oracle: 'code' as const, contract: null };
const work = (id: string, w: Work, expected: Expected): Fixture => ({ id, input: w as unknown as Fixture['input'], expected: expected as unknown as Fixture['expected'] });

// ---- The fixed parts, one per kind.

const conf = (max: string, more = 'max_connections'): Record<string, string> => ({ 'service.conf': ['# a service\'s settings', 'listen_address = 127.0.0.1', `${more} = ${max}`, 'log_level = info', ''].join('\n') });
const setting = (more: Partial<Work> = {}, spec: Partial<HostSpec> = {}): Work => ({
  deadline: LONG, files: conf('100'), ...more,
  spec: { ...base, kind: 'setting', runner: 'ssh', host: '{host}', file: '{dir}/service.conf', settings: { listen_address: '127.0.0.1', max_connections: '100' }, ...spec } as HostSpec,
});
const machine = (units: Unit[], spec: Partial<HostSpec>, more: Partial<Work> = {}): Work =>
  ({ deadline: LONG, units, ...more, spec: { ...base, kind: 'machine', runner: 'ssh', host: '{host}', ...spec } as HostSpec });

const FIXED: Record<HostKind, Fixture[]> = {
  setting: [
    work('holds', setting(), { outcome: 'passed' }),
    work('planted-drift', setting({ drift: conf('500') }), { first: 'passed', outcome: 'failed', assertion: 'max_connections is 500 in {dir}/service.conf on {host}', not: 'listen_address' }),
    work('planted-unset', setting({ files: conf('100', 'max_clients') }), { outcome: 'failed', assertion: 'max_connections isn\'t set', not: 'listen_address' }),
    work('crashed-no-file', setting({}, { file: '{dir}/absent.conf' } as Partial<HostSpec>), { outcome: 'failed', crash: 'No such file' }),
    work('crashed-unnamed-host', setting({}, { host: 'deep-unnamed-host' }), { outcome: 'failed', crash: 'isn\'t a host your SSH config' }),
    work('past-deadline', { ...setting({ files: {}, slow: { file: 'service.conf', text: conf('100')['service.conf']! } }), deadline: DEADLINE }, { outcome: 'overran' }),
  ],
  machine: [
    work('survives-restart', machine([{ name: 'steady', enabled: true }], { service: '{unit}-steady.service' }), { outcome: 'passed' }),
    work('holds-listening-and-disk', machine([], { disk: { path: '{dir}', free_bytes: 1 } }, { listening_now: true }), { outcome: 'passed' }),
    work('planted-stale-lock', machine([{ name: 'stale', enabled: true, lock: 1 }], { service: '{unit}-stale.service' }), { outcome: 'failed', assertion: '{unit}-stale.service on {host} didn\'t survive a restart' }),
    work('planted-not-enabled', machine([{ name: 'loose', enabled: false }], { service: '{unit}-loose.service' }), { outcome: 'failed', assertion: '{unit}-loose.service on {host} isn\'t enabled' }),
    work('planted-listens-wider', machine([], { listening: [] }), { outcome: 'failed', assertion: 'beyond what was asked' }),
    work('planted-disk-short', machine([], { disk: { path: '{dir}', free_bytes: 2 ** 62 } }), { outcome: 'failed', assertion: '{dir} on {host} has' }),
    work('crashed-no-unit', machine([], { service: '{unit}-absent.service' }), { outcome: 'failed', crash: 'no unit {unit}-absent.service' }),
    work('past-deadline', { ...machine([{ name: 'slow', enabled: true, slow: true }], { service: '{unit}-slow.service' }), deadline: DEADLINE }, { outcome: 'overran' }),
  ],
};

// ---- The seeded parts: the work's values drawn, once holding and once with one value off.

const word = (random: Random): string => Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[random.int(0, 25)]).join('');

function generate(kind: HostKind, random: Random): SlotCase[] {
  const seeded = (i: number, w: Work, expected: Expected): SlotCase => ({ id: `seeded-${i}`, part: 'seeded', input: w as unknown as SlotCase['input'], expected: expected as unknown as SlotCase['expected'] });
  if (kind === 'setting') {
    const names = Array.from({ length: random.int(2, 5) }, (_, i) => `${word(random)}${i}`);
    const values = names.map(() => (random.int(0, 1) ? String(random.int(0, 100_000)) : word(random)));
    const forms = names.map(() => random.int(0, 2));
    const required = random.int(1, names.length);
    const off = random.int(0, required - 1);
    const line = (i: number, v: string): string => [`${names[i]} = ${v}`, `${names[i]}=${v}`, `  ${names[i]} =${v}  `][forms[i]!]!;
    const file = (bump: boolean): Record<string, string> => ({ 's.conf': ['# seeded settings', ...names.map((_, i) => line(i, bump && i === off ? `${values[i]}x` : values[i]!)), ''].join('\n') });
    const settings = Object.fromEntries(names.slice(0, required).map((n, i) => [n, values[i]!]));
    const spec = { ...base, kind: 'setting', runner: 'ssh', host: '{host}', file: '{dir}/s.conf', settings } as HostSpec;
    const other = names.slice(0, required).find((_, i) => i !== off);
    return [
      seeded(1, { deadline: LONG, files: file(false), spec }, { outcome: 'passed' }),
      seeded(2, { deadline: LONG, files: file(true), spec }, { outcome: 'failed', assertion: `${names[off]} is ${values[off]}x`, ...(other ? { not: other } : {}) }),
    ];
  }
  const name = word(random);
  return [
    seeded(1, machine([{ name, enabled: true, every: random.int(1, 3) }], { service: `{unit}-${name}.service` }), { outcome: 'passed' }),
    seeded(2, machine([{ name, enabled: true, lock: random.int(1, 9) }], { service: `{unit}-${name}.service` }), { outcome: 'failed', assertion: `{unit}-${name}.service on {host} didn't survive a restart` }),
  ];
}

// ---- Making a case on the host, over the link, and taking it down.

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const b64 = (s: string): string => Buffer.from(s).toString('base64');
const put = (path: string, text: string): string => `mkdir -p "$(dirname ${q(path)})" && printf %s ${q(b64(text))} | base64 -d > ${q(path)}`;
const LISTENING = String.raw`if command -v ss >/dev/null; then ss -Hltn | awk '{ printf "listening\t%s\n", $4 }'
else awk 'NR > 1 && $4 == "0A" { split($2, a, ":"); print a[2] }' /proc/net/tcp /proc/net/tcp6 | while read -r p; do printf 'listening\t:%d\n' "0x$p"; done; fi`;

interface Ran { code: number | null; stdout: string; stderr: string }
/** One script on the test host through the kit's link; never rejects. */
function onHost(at: TestHost, script: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn('ssh', ['-F', at.config, '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=30', '--', at.host, 'sh -s'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(`{\n${script}\n}\n`);
  });
}

function unitText(dir: string, prefix: string, u: Unit): { file: string; script: string } {
  const lock = u.lock === undefined ? [] : [`mkdir ${q(`${dir}/${u.name}.lock`)} 2>/dev/null || { echo 'a lock its last start took is in the way' >&2; exit ${u.lock}; }`];
  return {
    script: ['#!/bin/sh', ...lock, 'touch "$0.up"', `while [ -d ${q(dir)} ]; do sleep ${u.every ?? 2}; done`, ''].join('\n'),
    file: ['[Unit]', `Description=deep host kit case ${prefix} (${u.name})`, '', '[Service]', ...(u.slow ? [`ExecStartPre=/bin/sleep ${SLOW_S}`] : []), `ExecStart=/bin/sh ${dir}/${u.name}.sh`, '', '[Install]', 'WantedBy=default.target', ''].join('\n'),
  };
}

/** The case's files, units and slow pipe made on the host: what listens there, read as the case is made; a failure is BLOCKED. */
async function make(at: TestHost, w: Work, dir: string, prefix: string): Promise<Listener[] | Finding> {
  const lines = ['set -e', `mkdir -p ${q(dir)}`, ...Object.entries(w.files ?? {}).map(([path, text]) => put(`${dir}/${path}`, text))];
  for (const u of w.units ?? []) {
    const unit = `${prefix}-${u.name}.service`;
    const { script, file } = unitText(dir, prefix, u);
    lines.push(put(`${dir}/${u.name}.sh`, script), put(`${dir}/${unit}`, file), `systemctl --user link ${q(`${dir}/${unit}`)} >/dev/null`);
    if (u.enabled) lines.push(`systemctl --user enable ${q(unit)} 2>/dev/null`);
    lines.push(`systemctl --user start ${u.slow ? '--no-block ' : ''}${q(unit)}`);
    if (!u.slow) lines.push(`i=0; until [ -e ${q(`${dir}/${u.name}.sh.up`)} ]; do i=$((i + 1)); [ "$i" -le 100 ] || { echo '${unit} never came up' >&2; exit 1; }; sleep 0.1; done`);
  }
  if (w.slow) {
    const pipe = `${dir}/${w.slow.file}`;
    lines.push(`mkfifo ${q(pipe)}`, put(`${dir}/.slow`, w.slow.text), put(`${dir}/writer.sh`, `sleep ${SLOW_S}; exec timeout 30 sh -c 'cat "$1" > "$2"' sh ${q(`${dir}/.slow`)} ${q(pipe)}\n`));
    lines.push(`systemd-run --user --quiet --collect --unit=${q(`${prefix}-writer`)} /bin/sh ${q(`${dir}/writer.sh`)}`);
  }
  if (w.listening_now) lines.push(LISTENING);
  const r = await onHost(at, lines.join('\n'));
  if (r.code !== 0) return new Finding('BLOCKED', `the kit couldn't make its case on ${at.host}: exit ${r.code}, ${r.stderr.trim().slice(-400)}`, []);
  return r.stdout.split('\n').filter((l) => l.startsWith('listening\t')).map((l) => {
    const a = l.slice('listening\t'.length);
    return { address: a.slice(0, a.lastIndexOf(':')), port: Number(a.slice(a.lastIndexOf(':') + 1)) };
  });
}

/** Stops, disables, unlinks and resets every user unit the case made, then removes its folder. */
const takeDown = (at: TestHost, dir: string, prefix: string): Promise<Ran> => onHost(at, [
  `p=${q(`${prefix}-`)}`,
  'units() { systemctl --user list-units --all --plain --no-legend --no-pager 2>/dev/null | awk \'{print $1}\' | grep -F -- "$p"; }',
  'for u in $(units); do systemctl --user stop -- "$u"; done',
  'for u in $(systemctl --user list-unit-files --no-legend --no-pager 2>/dev/null | awk \'{print $1}\' | grep -F -- "$p"); do systemctl --user disable -- "$u" 2>/dev/null; done',
  'find "$HOME/.config/systemd/user" -name "$p*" \\( -type l -o -type f \\) -delete 2>/dev/null',
  'systemctl --user daemon-reload',
  'for u in $(units); do systemctl --user reset-failed -- "$u" 2>/dev/null; done',
  `rm -rf -- ${q(dir)}`,
  'true',
].join('\n'));

// ---- The judge.

const grace = (deadline: number): number => Math.max(100, deadline);
const broke = (rule: Rule, detail: string): Finding => fail(RULES[rule].message, [RULES[rule].code], detail);

function hold(answer: unknown, ex: Expected, deadline: number, elapsed: number): void {
  if (answer instanceof Finding) throw answer;
  if (typeof answer !== 'object' || answer === null) throw new Finding('FAIL', 'the result is not an object', ['type']);
  const r = answer as Record<string, unknown>;
  if ('verdict' in r) throw new Finding('FAIL', 'the result carries a verdict; a runner reports a run outcome and the core matches it to a verdict', ['unlisted_field']);
  if (!OUTCOMES.includes(r.outcome as RunOutcome)) throw new Finding('FAIL', `outcome ${JSON.stringify(r.outcome)} is not one of the run outcomes`, ['enum']);
  if (!Number.isInteger(r.testsRun) || (r.testsRun as number) < 0 || !Array.isArray(r.failures) || !Array.isArray(r.read)) throw new Finding('FAIL', 'the result lacks its testsRun, failures or read', ['type']);
  const failures = r.failures as CheckResult['failures'];
  const outcome = r.outcome as RunOutcome;
  const shown = failures.map((f) => `${f.assertion ? '(assertion) ' : ''}${f.message}`).join(' | ') || 'no failures';
  if (elapsed > deadline + grace(deadline) && outcome !== 'overran') throw broke('deadline', `reported ${outcome} ${elapsed} ms in, past the ${deadline} ms deadline`);
  if (outcome !== ex.outcome) throw broke('work', `reported ${outcome}; the host's run is ${ex.outcome} (${shown})`);
  if (ex.assertion && !failures.some((f) => f.assertion && f.message.includes(ex.assertion!))) throw broke('work', `no failure at the check's assertion names "${ex.assertion}" (${shown})`);
  if (ex.not && failures.some((f) => f.message.includes(ex.not!))) throw broke('work', `a failure names ${ex.not}, which holds (${shown})`);
  if (ex.crash && !failures.some((f) => !f.assertion && f.message.includes(ex.crash!))) throw broke('crash', `the run stopped on "${ex.crash}", and no failure keeps it (${shown})`);
}

/** Each case's own folder and unit prefix under the kit's folder. */
let made = 0;
/** `{host}`, `{dir}` and `{unit}` filled in throughout. */
const filled = <T>(value: T, at: TestHost, dir: string, prefix: string): T =>
  JSON.parse(JSON.stringify(value).replaceAll('{host}', at.host).replaceAll('{dir}', dir).replaceAll('{unit}', prefix)) as T;
/** A fill's run as a step that never throws, so the case is always taken down: a throw comes back as the fill's finding. */
const ran = (fill: HostFill, spec: HostSpec, ctx: CheckContext) => (): Promise<unknown> =>
  Promise.resolve().then(() => fill.run(spec, ctx)).catch((error: unknown) => new Finding('FAIL', `the fill threw: ${String(error)}`, ['type']));

const judgeOn = (at: TestHost) => function* judge(fill: HostFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const prefix = `${basename(at.folder)}-k${++made}`;
  const dir = `${at.folder}/${prefix}`;
  const w = filled(c.input as unknown as Work, at, dir, prefix);
  const ex = filled(c.expected as unknown as Expected, at, dir, prefix);
  const ctx: CheckContext = { checkout: tmpdir(), deadline: w.deadline, now: () => Date.now() };
  try {
    const listening = (yield () => make(at, w, dir, prefix)) as Listener[] | Finding;
    if (listening instanceof Finding) throw listening;
    const spec = w.listening_now && w.spec.kind === 'machine' ? { ...w.spec, listening } : w.spec;
    let started = Date.now();
    let answer = yield ran(fill, spec, ctx);
    if (w.drift) {
      hold(answer, { outcome: ex.first! }, w.deadline, Date.now() - started);
      const r = (yield () => onHost(at, Object.entries(w.drift!).map(([path, text]) => put(`${dir}/${path}`, text)).join('\n'))) as Ran;
      if (r.code !== 0) throw new Finding('BLOCKED', `the kit couldn't write its drift on ${at.host}: ${r.stderr.trim().slice(-400)}`, []);
      started = Date.now();
      answer = yield ran(fill, spec, ctx);
    }
    hold(answer, ex, w.deadline, Date.now() - started);
  } finally {
    yield () => takeDown(at, dir, prefix);
  }
};

// ---- The planted runners.

function planted(kind: HostKind, reference: HostFill, at: TestHost): PlantedFill<HostFill>[] {
  const plant = (name: string, breaks: Rule, run: HostFill['run']): PlantedFill<HostFill> =>
    ({ name, message: RULES[breaks].message, codes: [RULES[breaks].code], breaks: RULES[breaks].id, fill: { ...reference, run } });
  // The kind's own wrong program: a setting runner that keeps its first reading of a file, a machine runner that never restarts.
  const first = new Map<string, CheckResult>();
  const own = kind === 'setting'
    ? plant('misses-the-drift', 'work', async (spec, ctx) => {
      const key = `${spec.host}\0${spec.kind === 'setting' ? spec.file : ''}`;
      const kept = first.get(key);
      if (kept) return kept;
      const r = await reference.run(spec, ctx);
      first.set(key, r);
      return r;
    })
    : plant('never-restarts', 'work', (spec, ctx) => runHost('machine', spec, ctx, at, false));
  return [
    own,
    plant('past-deadline', 'deadline', (spec, ctx) => reference.run(spec, { ...ctx, deadline: LONG })),
    plant('dropped-output', 'crash', async (spec, ctx) => {
      const r = await reference.run(spec, ctx);
      return { ...r, failures: r.failures.filter((f) => f.assertion), evidence: [] };
    }),
  ];
}

/** check.kind@1's kit for one host kind, its cases made on `at`. */
export function kitFor(kind: HostKind, at: TestHost, reference: () => HostFill): SlotKitImpl<HostFill> {
  return {
    slot: SLOT, fills: 'one', revision: 1, rules, fixtures: FIXED[kind], planted: planted(kind, reference(), at), clean: () => [reference()],
    generate: (random) => generate(kind, random), judge: judgeOn(at),
  };
}
