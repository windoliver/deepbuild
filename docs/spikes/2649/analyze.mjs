// Builds docs/spikes/2649/record.json and the table in README.md from what measure.mjs kept in out/: the perf lane's
// child counter logs, the sites logs that name each start's code, the latency samples and the cuts' rounds. Every count
// and instruction total comes from the kept files; what this file adds is the reading of each start's code site (use,
// verdict, what holds or would replace it), written once per site below. Run from the repo root:
//   node docs/spikes/2649/analyze.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(HERE, 'out');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const read = (file) => readFileSync(join(HERE, file));
const json = (file) => JSON.parse(read(file).toString('utf8').trim().split('\n').at(-1));

// ---- What each start is for, by code site. A site is the program and the supervisor code that started it.
const SITES = {
  leash: {
    label: '`watchDenials`: `helper leash /usr/bin/log stream`', verdict: 'needed',
    use: 'The system log stream that turns a sandbox refusal into a sandbox.denied event, kept for the supervisor\'s life.',
  },
  'leash-again': {
    label: '`watchDenials` again, on the next filter, after the canary never showed', verdict: 'replaceable',
    use: 'A second log stream, on the kernel-process filter, because the subsystem filter never showed the canary\'s report on this macOS.',
    replacement: 'A kept answer: the filter that last showed the canary on this macOS build, started first; the warm-up then confirms it with one probe.',
    change: 'The first sandboxed run after a hub start begins up to 10 s sooner on a macOS whose reports lack the subsystem; a test sees one leash start instead of two. After an OS update the kept answer is for another build and the walk runs once, as today.',
  },
  canary: {
    label: '`warm`: `sandbox-exec … helper probe` (the canary)', verdict: 'replaceable',
    use: 'A refused write in a canary sandbox, every ~320 ms, until its report shows through the stream\'s filter or 10 s pass; the first run waits for it. One probe that shows is needed; the rest are the filter walk. A launch more than WARM_MS (60 s) after the last report seen also warms again for up to 2 s, more probes per such run, which these subjects (one run each, warm from the open) never reach.',
    replacement: 'The same kept answer: with the filter that works on this build started first, the canary shows on the first probe.',
    change: 'On this Mac 32 of the 33 probes go and the first sandboxed run starts about 10 s sooner. A denial is seen as soon as now; the reports-other-subsystem plant in supervisor.test.ts must still pass, since a build with no kept answer walks the filters as today.',
  },
  run: {
    label: '`launch`: `sandbox-exec -p <profile> <program>` (the run itself)', verdict: 'needed',
    use: 'The run\'s own process, in its sandbox.',
  },
  'start-time': {
    label: '`launch` → `table([pid])`: `ps -p <pid> -o lstart=`', verdict: 'needed',
    use: 'The run\'s first process\'s start time, for its process.tracked event: the identity a PID is matched by from then on.',
  },
  'scan-beat': {
    label: '`scanOnce` (timed, every 100 ms) → `helper scan <marker>`', verdict: 'replaceable',
    use: 'Every process the run\'s sandbox holds, with its memory: how a fork is found and tracked, and a memory_mb limit read.',
    replacement: 'A kernel event: the helper\'s `watch` (kqueue NOTE_FORK and NOTE_EXIT, built for file limits) extended to print each fork it attaches to (today it prints only exits and syncs), following every sandboxed run from its first process; the marker scan stays as a slower backstop for a process the watch misses (one reparented, or gone, before it was attached).',
    change: 'process.tracked would come sooner after a fork than the p50 and p95 below (how much sooner is not measured); an exit is seen at once; a process that escapes the watch is found by the backstop later than today\'s 100 ms. A memory_mb limit is read at the backstop\'s pace unless the watch reads it.',
  },
  'beat-ps': {
    label: '`scanOnce` → `table(held)`: `ps -p <held pids> -o pid=,ppid=,pgid=,lstart=`', verdict: 'replaceable',
    use: 'The start time of each process the scan just found, to tell a new process from one already tracked under the same PID.',
    replacement: 'A kept answer of the scan itself: `helper scan` reads each process\'s proc_bsdinfo already, and prints its start time, formatted as ps does (strftime %c), on the same line (cut A). As tried, only the macOS helper does: native/helper-linux.c\'s scan prints no start, so on Linux the patched scanOnce would track nothing; Linux needs the same field or a fall back to table().',
    change: 'Nothing in the record: process.tracked carries the same start text. Each beat starts one process instead of two, so an idle sandboxed run costs 10 starts a second instead of 20.',
  },
  token: {
    label: '`scanOnce` → `tokenOf`: `ps -E -ww -o command= -p <pid>`', verdict: 'needed',
    use: 'A newly found process\'s run token, read once when it is first tracked.',
  },
  'scan-cleanup': {
    label: '`cleanupOnce` and `leftovers` → `scanOnce` → `helper scan <marker>`', verdict: 'repeated',
    use: 'Cleanup\'s scans: before each signal round, after it, and in leftovers\' rescan, so a process forked while the others stop is found.',
    heldBy: 'The timed scans that began after the run\'s first process exited and found its sandbox empty. A sandbox gains processes only by a fork inside it; but one scan is not an atomic view (helper scan lists the PIDs once, then checks each in turn), so a member can fork and exit between the list and its check and leave an empty answer while its child lives. Two empty scans in a row, the second begun after the first ended, hold it: the child is in the second scan\'s list.',
    replacement: 'A kept answer: a run whose first process has exited and whose sandbox two scans in a row found empty is no longer scanned (cut B as tried stops after one, which has the race above).',
    change: 'Cleanup of a run that is already over starts no helper (its 3 cleanup scans here, and the beats between its exit and its cleanup); run.cleaned and process.ended are recorded as now. A run that leaves a process behind is scanned as today.',
  },
  watcher: {
    label: 'the leash\'s own watcher, forked beside `log`', verdict: 'needed',
    use: 'Ends the log stream once the supervisor\'s process is gone, however it ends.',
  },
};
function siteOf(start) {
  const program = basename(start.file);
  const frames = start.frames.join(' ');
  if (program === 'helper' && start.args[0] === 'leash') return frames.includes('LocalSupervisor.open') ? 'leash' : 'leash-again';
  if (program === 'sandbox-exec') return start.args.includes('probe') && frames.includes('warm') ? 'canary' : 'run';
  if (program === 'ps' && start.args[0] === '-E') return 'token';
  if (program === 'ps' && frames.includes('LocalSupervisor.launch')) return 'start-time';
  if (program === 'ps') return 'beat-ps';
  if (program === 'helper' && start.args[0] === 'scan') return start.phase === 'cleanup' ? 'scan-cleanup' : 'scan-beat';
  throw Error(`no site for ${program} ${start.args.slice(0, 3).join(' ')} from ${frames}`);
}

// ---- One subject: its counter log, joined to its sites by PID.
const ROOT = '<root>';
function subject(name) {
  const run = json(`out/${name}.json`);
  const logText = read(`out/${name}.counter.log`).toString('utf8');
  if (sha256(logText) !== run.sha256) throw Error(`out/${name}.counter.log is not the log measure.mjs kept`);
  const sitesFile = existsSync(join(OUT, `${name}.sites.jsonl`)) ? `out/${name}.sites.jsonl` : `out/${name}.sites.jsonl.gz`;
  const sitesBytes = read(sitesFile);
  const lines = (sitesFile.endsWith('.gz') ? gunzipSync(sitesBytes) : sitesBytes).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  // PIDs come round again in an hour of 70,000 starts, so every join goes in log order: a start opens a process, and
  // the next reap, unread or exit line naming its PID is its own. A child's exit line can come before its parent logs
  // its start, so an exit with no process open waits for the next start of that PID.
  const siteQueue = new Map();
  for (const l of lines) if (l.kind === 'start') (siteQueue.get(String(l.pid)) ?? siteQueue.set(String(l.pid), []).get(String(l.pid))).push(l);
  const closes = new Map(lines.filter((l) => l.kind === 'close').map((l) => [l.n, l]));
  const open = new Map();
  const early = new Map();
  const procs = [];
  // The counter's own accounting, as benchmark.mjs's countChildren reads it: a process's children's elapsed time
  // (its reap or exit line) is the sum of what it reaped, to the tick, so a parent whose sum falls short started
  // children the counter could not log. The measured command is the one the runner reaped with no start.
  const rootAccounted = new Map();
  const roots = [];
  const accrue = (parentPid, time) => {
    const owner = open.get(parentPid);
    if (owner) owner.accounted += time; else rootAccounted.set(parentPid, (rootAccounted.get(parentPid) ?? 0n) + time);
  };
  for (const [kind, ...f] of logText.split('\n').map((l) => l.split(' '))) {
    if (kind === 'start') {
      const [parent, child, ...path] = f;
      const p = { parent: open.get(parent), child, path: path.join(' '), reap: null, exit: early.get(child)?.instr ?? null, own: early.get(child)?.own ?? null, accounted: 0n };
      early.delete(child);
      open.set(child, p);
      procs.push(p);
    } else if (kind === 'reap' || kind === 'unread') {
      const p = open.get(f[1]);
      accrue(f[0], kind === 'reap' ? BigInt(f[3]) + BigInt(f[4]) : BigInt(f[2])); // a reap's time is the child's and its own children's
      if (p && kind === 'reap') { p.reap = Number(f[2]); p.own = BigInt(f[4]); }
      if (p && kind === 'unread') p.own = null;
      if (!p && kind === 'reap') roots.push({ pid: f[1], own: BigInt(f[4]) });
      open.delete(f[1]);
    } else if (kind === 'exit') {
      const p = open.get(f[0]);
      if (p) { p.exit = Number(f[1]); p.own ??= BigInt(f[2]); } else early.set(f[0], { instr: Number(f[1]), own: BigInt(f[2]) });
    }
  }
  const siteFor = (p) => siteQueue.get(p.child)?.shift();
  const groups = new Map();
  // An answer the last call of the same program and arguments already gave: for a scan its PIDs (its memory figures
  // change every read), for ps all it printed.
  const lastAnswer = new Map();
  for (const p of procs) {
    const caller = p.parent ? basename(p.parent.path) : ROOT;
    const program = basename(p.path);
    const start = caller === ROOT ? siteFor(p) : undefined;
    if (caller === ROOT && !start) throw Error(`${name}: start ${p.child} has no site line`);
    const site = start ? siteOf(start) : caller === 'helper' && program === '(forked)' ? 'watcher' : null;
    if (!site) throw Error(`${name}: no site for ${caller} → ${program}`);
    const instructions = p.reap ?? p.exit ?? null;
    const key = `${caller}\0${program}`;
    const group = groups.get(key) ?? groups.set(key, { caller, program, count: 0, instructions: 0, unread: 0, sites: new Map() }).get(key);
    group.count++;
    if (instructions === null) group.unread++; else group.instructions += instructions;
    const s = group.sites.get(site) ?? group.sites.set(site, { site, count: 0, instructions: 0, unread: 0, sameAnswer: 0, phases: {} }).get(site);
    s.count++;
    if (instructions === null) s.unread++; else s.instructions += instructions;
    if (start) {
      s.phases[start.phase] = (s.phases[start.phase] ?? 0) + 1;
      const close = closes.get(start.n);
      if (close && (site === 'scan-beat' || site === 'scan-cleanup' || site === 'beat-ps')) {
        const asked = `${start.file} ${start.args.join(' ')}`;
        const answer = site === 'beat-ps' ? close.out : close.pids;
        // A scan's question doesn't change; a ps's names its PIDs, so its last answer is the last for the same PIDs.
        // Timed and cleanup scans share one last answer (the key's first four letters, "scan"): both ask the same.
        if (lastAnswer.get(site === 'beat-ps' ? asked : site.slice(0, 4) + asked) === answer) s.sameAnswer++;
        lastAnswer.set(site === 'beat-ps' ? asked : site.slice(0, 4) + asked, answer);
      }
    }
  }
  const OBSERVERS = new Set(['/bin/ps', '/usr/sbin/lsof', '/usr/bin/log']);
  const unlogged = new Map();
  for (const r of roots) if ((rootAccounted.get(r.pid) ?? 0n) !== r.own) unlogged.set(ROOT, { parent: ROOT, caller: null });
  for (const p of procs) {
    if (p.own === null || p.accounted === p.own || OBSERVERS.has(p.path)) continue;
    const gap = { parent: basename(p.path), caller: p.parent ? basename(p.parent.path) : ROOT };
    unlogged.set(`${gap.parent}\0${gap.caller}`, gap);
  }
  return { run, logFile: `out/${name}.counter.log`, sitesFile, groups, unlogged: [...unlogged.values()] };
}

const sides = { 'command-check': subject('command-check'), 'idle-hour': subject('idle-hour') };
const rows = [];
for (const [name, { groups }] of Object.entries(sides)) {
  for (const group of groups.values()) {
    const sites = [...group.sites.values()].sort((a, b) => b.count - a.count);
    // The row's verdict is its largest site's; every site's own is listed beside it.
    const lead = SITES[sites[0].site];
    rows.push({
      subject: name, caller: group.caller, program: group.program, count: group.count, instructions: group.instructions, unread: group.unread,
      verdict: lead.verdict, use: sites.map((s) => `${SITES[s.site].label}: ${SITES[s.site].use}`).join(' '),
      ...(lead.heldBy ? { heldBy: lead.heldBy } : {}), ...(lead.replacement ? { replacement: lead.replacement } : {}), ...(lead.change ? { change: lead.change } : {}),
      sites: sites.map((s) => ({ ...s, ...SITES[s.site], label: undefined })),
    });
  }
}

// ---- The latency samples and the cuts.
// The main commit measured: the checkout ran at main plus the acceptance tests' commit, which adds tests/acceptance/2649
// only, and this folder; every package, benchmark and script is main's bytes.
const MAIN = 'b4a2049e808c05a4ad0f727bb09c422b545cbb36';
const latencyRun = json('out/latency.json');
const samplesText = read('out/latency.samples.jsonl').toString('utf8');
const samples = samplesText.trim().split('\n').map((l) => JSON.parse(l));
const deltas = samples.filter((s) => s.trackedAtMs !== null).map((s) => s.trackedAtMs - s.forkedAtMs).sort((a, b) => a - b);
const rank = (p) => deltas[Math.max(0, Math.ceil((p / 100) * deltas.length) - 1)];
// Each cut as a commit on main: its patch applied to main's tree in a temporary index (git read-tree, apply --cached,
// write-tree, commit-tree), kept on the branch named, never merged.
const CUT_COMMITS = {
  A: { commit: '82bff4e8c56e5e4245b47b389525a87af49ce364', tree: 'b6102eef52c23c1ec9eb3c6e6e0dbfded8bfcd2e' },
  B: { commit: '1c4dc9f043bd976d6972bb051c1161e0ab10cd51', tree: '499afc7bda7aeed73ef8a741974e55bd9bcbe5e8' },
};
const cuts = ['B', 'A'].filter((id) => existsSync(join(OUT, `cut-${id}.json`))).map((id) => {
  const kept = JSON.parse(read(`out/cut-${id}.json`));
  const patch = `cut-${id}.patch`;
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return {
    id, mergeBase: MAIN, patch, patchSha256: sha256(read(patch)), measured: kept.date,
    description: id === 'B' ? SITES['scan-cleanup'].replacement : SITES['beat-ps'].replacement,
    change: CUT_COMMITS[id].commit, tree: CUT_COMMITS[id].tree, branch: `spike/2649-cut-${id}`,
    seen: id === 'B' ? SITES['scan-cleanup'].change : SITES['beat-ps'].change,
    measurements: Object.fromEntries(Object.entries(kept.measurements).map(([task, m]) => {
      const ratio = median(m.rounds.map((r) => r.change / r.base));
      return [task, { ...m, medianBase: median(m.rounds.map((r) => r.base)), medianChange: median(m.rounds.map((r) => r.change)), medianRatio: Number(ratio.toFixed(4)) }];
    })),
  };
});

const TIMEBASE = (() => {
  const hz = Number(execFileSync('/usr/sbin/sysctl', ['-n', 'hw.tbfrequency'], { encoding: 'utf8' }));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  return { numer: 1e9 / gcd(1e9, hz), denom: hz / gcd(1e9, hz) };
})();
const record = {
  spike: 2649,
  main: MAIN,
  checkout: sides['command-check'].run.main,
  // The Mach timebase the counter's elapsed times are in: 1e9 / hw.tbfrequency ns a tick, 125/3 on Apple silicon.
  counter: { timebase: TIMEBASE, command: sides['command-check'].run.command, source: 'scripts/count-children.c', note: 'ps is setuid, so the kernel denies its count to the counter: its starts are listed as unread, and psCopy gives a non-setuid copy\'s reading for scale.' },
  subjects: Object.fromEntries(Object.entries(sides).map(([name, { run, logFile, sitesFile, unlogged }]) => [name, {
    log: logFile, unlogged, sha256: run.sha256, totalStarts: run.starts, sites: sitesFile, sitesSha256: sha256(read(sitesFile)),
    measured: run.date, load: run.load, wallSeconds: run.wallSeconds, ...(run.durationSeconds ? { durationSeconds: run.durationSeconds } : {}),
    ...(name === 'idle-hour' ? { startsPerSecond: Number((run.starts / run.durationSeconds).toFixed(2)) } : {}),
  }])),
  rows,
  cuts,
  psCpu: { ...json('out/ps.json').ps, measured: json('out/ps.json').date, load: json('out/ps.json').load },
  recommendation: JSON.parse(read('recommendation.json')),
  latency: { main: MAIN, checkout: latencyRun.main, command: 'node docs/spikes/2649/measure.mjs latency 200', unit: 'ms', samplesFile: 'out/latency.samples.jsonl', samplesSha256: sha256(samplesText), samples: samples.length, p50: rank(50), p95: rank(95), measured: latencyRun.date, load: latencyRun.latency.load },
};
export { record };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(HERE, 'record.json'), `${JSON.stringify(record, null, 1)}\n`);
  // The table, between its markers in README.md.
  const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} G` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : String(n));
  const table = ['| Subject | Caller | Program | Starts | Instructions retired | Unread | Site | Site starts | Same answer as the last | Verdict |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const row of rows) {
    const exact = (n) => n.toLocaleString('en-US');
    row.sites.forEach((s, i) => table.push(`| ${i ? '' : row.subject} | ${i ? '' : `\`${row.caller}\``} | ${i ? '' : `\`${row.program}\``} | ${i ? '' : row.count} | ${i ? '' : exact(row.instructions)} | ${i ? '' : row.unread} | ${SITES[s.site].label} | ${s.count} | ${['scan-beat', 'scan-cleanup', 'beat-ps'].includes(s.site) ? s.sameAnswer : '–'} | ${s.verdict} |`));
  }
  // The parents whose children's time the counter's own accounting can't fully account for: starts it could not log.
  for (const [name, { unlogged }] of Object.entries(record.subjects)) for (const g of unlogged) {
    table.push(g.caller === null
      ? `\n- ${name}: unlogged starts under the measured command \`${g.parent}\` (children whose time its reap counts but no line logs).`
      : `${table.at(-1).startsWith('|') ? '\n' : ''}- ${name}: unlogged starts under \`${g.parent}\`, started by \`${g.caller}\` (its reap counts children's time that no line logs).`);
  }
  const cutTable = ['| Cut | Task | Median instructions, main | Median, cut | Median of the 15 rounds\' cut ÷ main | Starts in one task run, median, main → cut |', '|---|---|---|---|---|---|'];
  for (const c of cuts) for (const [task, m] of Object.entries(c.measurements)) {
    const starts = (key) => [...m.rounds.map((r) => r[key])].sort((a, b) => a - b)[7];
    cutTable.push(`| ${c.id} | \`${task}\` | ${fmt(m.medianBase)} | ${fmt(m.medianChange)} | ${m.medianRatio} | ${starts('baseStarts')} → ${starts('changeStarts')} |`);
  }
  const between = (text, name, body) => {
    const [before, rest] = text.split(`<!-- ${name} -->`);
    const [, after] = rest.split(`<!-- /${name} -->`);
    return `${before}<!-- ${name} -->\n${body}\n<!-- /${name} -->${after}`;
  };
  const readme = readFileSync(join(HERE, 'README.md'), 'utf8');
  const ps = Object.entries(record.psCpu).filter(([, v]) => v?.cpuMsPerStart !== undefined).map(([k, v]) => `\`${k}\` ${v.cpuMsPerStart} ms`).join('; ');
  const idle = record.subjects['idle-hour'];
  const latency = [
    `${record.latency.samples} forks, every one tracked: **p50 ${record.latency.p50} ms, p95 ${record.latency.p95} ms** from the fork's \`spawn\` to its`,
    `\`process.tracked\` event's \`ts\` (nearest rank; \`out/latency.samples.jsonl\`, read on main by \`${record.latency.command}\`, load`,
    `${record.latency.load.before.map((x) => x.toFixed(1)).join(', ')} before). A fork waits for the next beat (0 to 100 ms), then for the scan, the \`ps -p\`, the`,
    `\`ps -E\` for its token and the record's append. The idle hour: ${idle.totalStarts} starts in ${idle.durationSeconds} s, **${idle.startsPerSecond} a second**.`,
  ].join('\n');
  const rec = record.recommendation.cuts.map((c, i) => `${i + 1}. **${c.cut}.** ${c.why}\n\n   Drafted criterion: ${c.criterion}`).join('\n\n');
  writeFileSync(join(HERE, 'README.md'), [['table', table.join('\n')], ['cuts', cutTable.join('\n')], ['ps', `  ${ps}.`], ['latency', latency], ['recommendation', rec]].reduce((text, [name, body]) => between(text, name, body), readme));
  console.log(JSON.stringify({ rows: rows.length, cuts: cuts.length, latency: { p50: record.latency.p50, p95: record.latency.p95 } }));
}
