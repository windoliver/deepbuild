// The work a setting or machine check does on a host (#1943), in a process of its own so the runner's deadline can end
// it, and its ssh with it. It reads {kind, spec, config, restart} as JSON on stdin and writes one line of JSON:
// {outcome, testsRun, failures, read}. The host is reached only through the host link: one `ssh -F <config>` call to a
// host that config names, read at each run. A failure at the check's assertion is the host not holding what the
// definition requires; anything that stops the work itself (a host the config doesn't name, a link that fails, a file
// or unit that isn't there) leaves this process with its error on stderr, which the runner keeps as the crash's output.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

const { kind, spec, config, restart } = JSON.parse(readFileSync(0, 'utf8'));
/** How long a restarted service must stay up, in seconds. */
const SETTLE = 2;
const failures = [];
const at = (test, file, line, message) => failures.push({ test, file, line, stack: null, assertion: true, message });
const done = (testsRun, outcome) => {
  process.stdout.write(`${JSON.stringify({ outcome: outcome ?? (failures.length ? 'failed' : 'passed'), testsRun, failures, read: [] })}\n`);
  process.exit(0);
};
const crash = (message) => {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
};
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The hosts an SSH config names: each name a Host line gives that is no pattern, through its Include lines. */
function named(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const names = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\w+)\s*(?:=\s*|\s)(.*)$/.exec(line);
    if (!m) continue;
    const values = (m[2].match(/"[^"]*"|\S+/g) ?? []).map((v) => v.replace(/^"(.*)"$/, '$1')).filter(Boolean);
    const key = m[1].toLowerCase();
    if (key === 'host') names.push(...values.filter((v) => !/[*?!]/.test(v)));
    if (key === 'include') for (const v of values) names.push(...named(v.startsWith('~/') ? join(homedir(), v.slice(2)) : isAbsolute(v) ? v : join(dirname(file), v), seen));
  }
  return names;
}

/** One call over the host link: `script` run by `sh -s` on the host with `args`. A host the config doesn't name is never contacted. */
function onHost(script, args) {
  if (!named(config).includes(spec.host)) crash(`${spec.host} isn't a host your SSH config (${config}) names, so the ${kind} check won't contact it`);
  const r = spawnSync('ssh', ['-F', config, '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=30', '--', spec.host, ['sh', '-s', '--', ...args].map(q).join(' ')], { input: `{\n${script}\n}\n`, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) crash(`ssh to ${spec.host} didn't run: ${r.error.message}`);
  if (r.status === 255) crash(`the link to ${spec.host} failed: ${r.stderr.trim().slice(-400)}`);
  return r;
}

// ---- Setting: the file read from the host now; each required setting holds its value, and a failure names the one that doesn't.

function setting() {
  const required = Object.entries(spec.settings ?? {});
  if (!required.length) done(0, 'ran_nothing');
  const r = onHost('cat -- "$1"', [spec.file]);
  if (r.status !== 0) crash(`couldn't read ${spec.file} on ${spec.host}: ${r.stderr.trim().slice(-400)}`);
  const found = new Map();
  r.stdout.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq < 0) return;
    found.set(line.slice(0, eq).trim(), { value: line.slice(eq + 1).trim(), line: i + 1 });
  });
  const where = `${spec.host}:${spec.file}`;
  for (const [name, want] of required) {
    const got = found.get(name);
    if (!got) at(`setting: ${name}`, where, 1, `${name} isn't set in ${spec.file} on ${spec.host}; the definition requires ${name} = ${want}`);
    else if (got.value !== String(want)) at(`setting: ${name}`, where, got.line, `${name} is ${got.value} in ${spec.file} on ${spec.host}, not the ${want} the definition requires`);
  }
  done(required.length);
}

// ---- Machine: the service enabled, restarted and still up SETTLE s later; what listens; the disk's free space. One call.

const LISTENING = String.raw`if command -v ss >/dev/null; then ss -Hltn | awk '{ printf "listening\t%s\n", $4 }'
else awk 'NR > 1 && $4 == "0A" { split($2, a, ":"); print a[2] }' /proc/net/tcp /proc/net/tcp6 | while read -r p; do printf 'listening\t:%d\n' "0x$p"; done; fi`;
const MACHINE = String.raw`u=$1; restart=$2; settle=$3; disk=$4; listen=$5
state() { systemctl --user show -p LoadState -p ActiveState -p SubState -p Result -p InvocationID -p NRestarts -- "$u" | while IFS= read -r l; do printf '%s\t%s\n' "$1" "$l"; done; }
if [ -n "$u" ]; then
  state before
  printf 'enabled\t%s\n' "$(systemctl --user is-enabled -- "$u" 2>&1 | head -n 1)"
  if [ "$restart" = 1 ]; then
    out=$(systemctl --user restart -- "$u" 2>&1); rc=$?
    printf 'restart\t%s\t%s\n' "$rc" "$(printf %s "$out" | tr '\n' ' ')"
    state mid
    sleep "$settle"
  fi
  state after
fi
if [ -n "$disk" ]; then df -Pk -- "$disk" | awk 'NR == 2 { printf "disk\t%s\n", $4 }'; fi
if [ "$listen" = 1 ]; then ${LISTENING}
fi`;

function machine() {
  const parts = [spec.service, spec.listening, spec.disk].filter((p) => p !== undefined && p !== null);
  if (!parts.length) done(0, 'ran_nothing');
  const u = spec.service ?? '';
  const r = onHost(MACHINE, [u, restart ? '1' : '0', String(SETTLE), spec.disk?.path ?? '', spec.listening ? '1' : '0']);
  const lines = r.stdout.split('\n').map((l) => l.split('\t'));
  const state = (when) => Object.fromEntries(lines.filter((l) => l[0] === when).map((l) => [l[1].slice(0, l[1].indexOf('=')), l[1].slice(l[1].indexOf('=') + 1)]));
  const where = (what) => `${spec.host}:${what}`;
  let tests = 0;
  if (u) {
    tests += 2;
    const before = state('before');
    if (!before.LoadState) crash(`couldn't read ${u}'s state on ${spec.host}: ${r.stderr.trim().slice(-400)}`);
    if (before.LoadState === 'not-found') crash(`no unit ${u} on ${spec.host}: its user manager has no unit file for it`);
    const enabled = lines.find((l) => l[0] === 'enabled')?.[1] ?? '';
    if (enabled !== 'enabled') at(`machine: ${u} enabled`, where(u), 1, `${u} on ${spec.host} isn't enabled (is-enabled says ${enabled || 'nothing'}), so it won't start at boot`);
    const after = state('after');
    const shown = `${after.ActiveState} (${after.SubState}${after.Result && after.Result !== 'success' ? `, ${after.Result}` : ''})`;
    if (restart) {
      const [, rc = '', out = ''] = lines.find((l) => l[0] === 'restart') ?? [];
      const mid = state('mid');
      if (rc !== '0') at(`machine: ${u} restart`, where(u), 1, `${u} on ${spec.host} didn't survive a restart: systemctl restart exited ${rc || 'without a code'}${out.trim() ? `: ${out.trim()}` : ''}`);
      else if (after.ActiveState !== 'active') at(`machine: ${u} restart`, where(u), 1, `${u} on ${spec.host} didn't survive a restart: ${SETTLE} s after it, it is ${shown}`);
      else if (after.InvocationID !== mid.InvocationID || after.NRestarts !== mid.NRestarts) at(`machine: ${u} restart`, where(u), 1, `${u} on ${spec.host} didn't stay up after a restart: it started again within ${SETTLE} s`);
    } else if (after.ActiveState !== 'active') at(`machine: ${u} active`, where(u), 1, `${u} on ${spec.host} isn't running: it is ${shown}`);
  }
  if (spec.disk) {
    tests += 1;
    const kb = lines.find((l) => l[0] === 'disk')?.[1];
    if (kb === undefined) crash(`couldn't read the free disk at ${spec.disk.path} on ${spec.host}: ${r.stderr.trim().slice(-400)}`);
    const free = Number(kb) * 1024;
    if (free < spec.disk.free_bytes) at('machine: disk margin', where(spec.disk.path), 1, `${spec.disk.path} on ${spec.host} has ${free} bytes free, under the ${spec.disk.free_bytes} its margin keeps`);
  }
  if (spec.listening) {
    tests += 1;
    const asked = new Set(spec.listening.map((l) => `${l.address}:${l.port}`));
    const seen = new Set();
    for (const [key, at_ = ''] of lines) {
      if (key !== 'listening' || seen.has(at_) || asked.has(at_)) continue;
      seen.add(at_);
      at('machine: listening', where(at_), 1, `${at_} listens on ${spec.host}, beyond what was asked`);
    }
  }
  done(tests);
}

if (kind === 'setting') setting();
else if (kind === 'machine') machine();
else crash(`no host check kind ${kind}`);
