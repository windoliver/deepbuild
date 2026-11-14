// The routing replay's snapshot (#1980), fetched once from public build history and kept by its hash.
//
//   node packages/routing-replay/make-snapshot.mjs <cache folder outside the repo>
//
// It reads hydra.nixos.org's public pages for the trunk jobset nixpkgs:unstable and a shallow, blobless clone of
// nixpkgs, caching every page under the folder you name, so a second run fetches nothing it already has. The raw
// pages name maintainers by email address; they stay in that folder. Only the snapshot, with every handle replaced by
// a stable placeholder, is written: snapshot/<sha256>.json.gz, the SHA-256 of the JSON inside. It never runs in a
// test or in CI.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const HYDRA = 'https://hydra.nixos.org';
const JOBSET = 'nixpkgs/unstable';
/** The window: the 107 evaluations that ended before this time, then 15 days after its last one. */
const WINDOW_END = Date.UTC(2026, 9, 12);
const WINDOW = 107;
const AFTER = 15 * 86_400_000;
const SYSTEMS = /\.(x86_64-linux|aarch64-linux|x86_64-darwin|aarch64-darwin|i686-linux)$/;
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/;

const cache = process.argv[2];
if (!cache) throw new Error('usage: make-snapshot.mjs <cache folder outside the repo>');
for (const dir of ['lists', 'evals', 'full', 'builds', 'prevjob']) mkdirSync(join(cache, dir), { recursive: true });

// ---- Fetching, cached.
async function get(url, file, accept) {
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (let tries = 0; ; tries++) {
    const r = await fetch(url, { headers: accept ? { accept } : {}, redirect: 'follow', signal: AbortSignal.timeout(600_000) }).catch((e) => e);
    if (r instanceof Response && r.status === 404 && accept) { writeFileSync(file, 'null'); return 'null'; }
    if (r instanceof Response && r.ok) { const text = await r.text(); writeFileSync(file, text); return text; }
    if (tries >= 8) throw new Error(`${url}: ${r instanceof Response ? r.status : r}`);
    await new Promise((ok) => setTimeout(ok, 15_000 * (tries + 1)));
  }
}
async function pool(jobs, width = 4) {
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => { while (next < jobs.length) await jobs[next++](); }));
}

// ---- Hydra's pages.
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const TABS = { 'Aborted / Timed out Jobs': 'aborted', 'Newly Failing Jobs': 'now-fail', 'Newly Succeeding Jobs': 'now-succeed', 'New Jobs': 'new', 'Removed Jobs': 'removed' };
function tabRows(page, name) {
  const at = page.indexOf(`id="tabs-${name}"`);
  if (at < 0) return [];
  const end = page.indexOf('id="tabs-', at + 10);
  const rows = [];
  for (const [, r] of page.slice(at, end < 0 ? page.length : end).matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const links = [...r.matchAll(/\/build\/(\d+)">([^<]+)<\/a>/g)];
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    if (links.length >= 2) rows.push({ build: Number(links[0][1]), job: links[1][2].trim(), status: r.match(/title="([^"]+)" alt=/)?.[1] ?? null, nixname: tds[4] ? text(tds[4][1]) : '' });
    else if (name === 'removed' && tds.length) rows.push({ job: text(tds[0][1]) });
  }
  return rows;
}
function evalPage(page) {
  const counts = {};
  for (const [, a] of page.matchAll(/<a [^>]*data-toggle="tab"[^>]*>([\s\S]*?)<\/a>/g)) {
    const m = text(a).match(/^(.*) \((\d+)\)$/);
    if (m && TABS[m[1]]) counts[TABS[m[1]]] = Number(m[2]);
  }
  const change = page.match(/nixpkgs\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})/);
  const tabs = Object.fromEntries(Object.values(TABS).map((n) => [n, tabRows(page, n)]));
  return { counts, change: change ? { from: change[1], to: change[2] } : null, rev: page.match(/copyToClipboard\('([0-9a-f]{40})'/)?.[1] ?? null, tabs };
}
function buildPage(page) {
  const at = page.indexOf('Maintainer(s)');
  const listed = at < 0 ? '' : text(page.slice(at, page.indexOf('</tr>', at))).replace(/^Maintainer\(s\):?\s*/, '');
  return {
    maintainers: !listed || /^not given$/i.test(listed) ? [] : listed.split(/,\s*/).filter(Boolean),
    propagated_from: [...new Set([...page.matchAll(/propagated from <a href="[^"]*\/build\/(\d+)">/g)].map((m) => Number(m[1])))],
    // A dependency that failed in one of this build's own steps: the builds that need it name this one.
    failed_here: page.includes('Failed build steps') && !page.includes('propagated from'),
  };
}

// ---- The evaluations: the jobset's list, newest first, until the window's start.
const seen = new Map();
for (let n = 1; ; n++) {
  const page = await get(`${HYDRA}/jobset/${JOBSET}/evals?page=${n}`, join(cache, 'lists', `${n}.html`));
  for (const [, r] of page.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const id = r.match(/\/eval\/(\d+)/)?.[1], ts = r.match(/data-timestamp="(\d+)"/)?.[1];
    if (id && ts) seen.set(Number(id), Number(ts) * 1000);
  }
  if ([...seen.values()].filter((at) => at < WINDOW_END).length > WINDOW) break;
}
const listed = [...seen].map(([id, at]) => ({ id, at })).sort((a, b) => a.id - b.id);
const before = listed.filter((e) => e.at < WINDOW_END);
const window = before.slice(-WINDOW - 1); // the window, with the evaluation before it to compare against
const last = window.at(-1).at;
const after = listed.filter((e) => e.at >= WINDOW_END && e.at <= last + AFTER);
const pageOf = async (id) => {
  const short = await get(`${HYDRA}/eval/${id}`, join(cache, 'evals', `${id}.html`));
  const e = evalPage(short);
  const cut = ['now-fail', 'now-succeed'].some((t) => (e.counts[t] ?? 0) > e.tabs[t].length);
  return cut ? evalPage(await get(`${HYDRA}/eval/${id}?full=1`, join(cache, 'full', `${id}.html`))) : e;
};
const pages = new Map();
for (const { id } of [...window, ...after]) pages.set(id, await pageOf(id));

// ---- Each window failure's build record, and for a timed-out build the job's status in the evaluation before.
const work = [];
for (let i = 1; i < window.length; i++) {
  const e = pages.get(window[i].id), prev = window[i - 1].id;
  const abortedBefore = new Set(pages.get(prev).tabs.aborted.map((r) => r.job));
  e.timedOut = e.tabs.aborted.filter((r) => r.status === 'Timed out' && !abortedBefore.has(r.job));
  for (const r of e.tabs['now-fail']) if (r.status === 'Failed' || r.status === 'Dependency failed') work.push(() => get(`${HYDRA}/build/${r.build}`, join(cache, 'builds', `${r.build}.html`)));
  for (const r of e.timedOut) {
    work.push(async () => {
      r.before = JSON.parse(await get(`${HYDRA}/eval/${prev}/job/${encodeURIComponent(r.job)}`, join(cache, 'prevjob', `${prev}-${r.job}.json`), 'application/json'))?.buildstatus;
      if (r.before === 0) await get(`${HYDRA}/build/${r.build}`, join(cache, 'builds', `${r.build}.html`));
    });
  }
}
await pool(work);

// ---- The merges each change brought, from a shallow, blobless clone of nixpkgs.
const clone = join(cache, 'nixpkgs');
if (!existsSync(clone)) execFileSync('git', ['clone', '-q', '--filter=blob:none', '--no-checkout', '--shallow-since=2026-08-20', '--single-branch', '--branch', 'master', 'https://github.com/NixOS/nixpkgs.git', clone]);
function merges(change) {
  const out = execFileSync('git', ['-C', clone, 'log', '--first-parent', '--diff-merges=first-parent', '--name-only', '--format=@%H%x09%ae%x09%s', `${change.from}..${change.to}`], { maxBuffer: 2 ** 30 }).toString();
  const list = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('@')) { const [commit, author, subject] = line.slice(1).split('\t'); list.push({ commit, author, subject, files: [] }); }
    else if (line.trim()) list.at(-1).files.push(line.trim());
  }
  return list;
}

// ---- The snapshot, with every handle a placeholder.
const placeholders = new Map();
const placeholder = (handle) => {
  const key = handle.toLowerCase();
  if (!placeholders.has(key)) placeholders.set(key, `maintainer-${placeholders.size + 1}`);
  return placeholders.get(key);
};
const names = (row) => new Set([row.job.replace(SYSTEMS, '').split('.').at(-1), row.nixname.replace(/^python3\.\d+-/, '').replace(/-[0-9][^-]*(-.*)?$/, '')].filter((n) => n && n.length > 2));
const ownJobs = new Set();
const evaluations = [];
for (let i = 1; i < window.length; i++) {
  const { id, at } = window[i];
  const e = pages.get(id);
  const brought = merges(e.change);
  const byCommit = new Map(brought.map((m) => [m.commit, m]));
  const staging = brought.find((m) => /^staging-next \d{4}-\d{2}-\d{2}/.test(m.subject));
  const mergeOf = (row) => {
    if (staging) return staging;
    const want = names(row);
    const hits = brought.filter((m) => m.files.some((f) => f.split('/').some((seg) => want.has(seg.replace(/\.nix$/, '')))));
    return hits.sort((a, b) => a.files.length - b.files.length)[0] ?? byCommit.get(e.change.to);
  };
  const failures = [];
  for (const row of [...e.tabs['now-fail'].filter((r) => r.status === 'Failed'), ...e.timedOut.filter((r) => r.before === 0)]) {
    const b = buildPage(readFileSync(join(cache, 'builds', `${row.build}.html`), 'utf8'));
    const m = mergeOf(row);
    failures.push({ build: row.build, job: row.job, status: row.status === 'Failed' ? 'failed' : 'timed out', maintainers: b.maintainers.map(placeholder), merge: { commit: m.commit, owner: placeholder(m.author) }, inherited_from: null });
    ownJobs.add(row.job);
  }
  for (const row of e.tabs['now-fail'].filter((r) => r.status === 'Dependency failed')) {
    const b = buildPage(readFileSync(join(cache, 'builds', `${row.build}.html`), 'utf8'));
    const from = b.propagated_from[0] ?? (b.failed_here ? row.build : undefined);
    if (from === undefined) throw new Error(`build ${row.build}: a dependency failure that names no build it came from`);
    failures.push({ build: row.build, job: row.job, status: 'dependency failed', maintainers: b.maintainers.map(placeholder), merge: null, inherited_from: from });
  }
  failures.sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : a.build - b.build));
  evaluations.push({ id, at, window: true, revision: e.rev, change: e.change, failures });
}
for (const { id, at } of after) evaluations.push({ id, at, window: false, revision: pages.get(id).rev, change: pages.get(id).change, failures: [] });
for (const ev of evaluations) {
  const e = pages.get(ev.id);
  ev.fixed = [...new Set([...e.tabs['now-succeed'], ...e.tabs.removed].map((r) => r.job).filter((j) => ownJobs.has(j)))].sort();
}
const snapshot = {
  about: 'Recorded failures of the nixpkgs trunk jobset (nixpkgs:unstable) on hydra.nixos.org, fetched once from public build history for the routing replay (#1980). Every maintainer and merge author is a stable placeholder.',
  jobset: 'nixpkgs:unstable',
  evaluations,
};
const json = JSON.stringify(snapshot);
if (EMAIL.test(json)) throw new Error('the snapshot still holds an email address');
const hash = createHash('sha256').update(json).digest('hex');
writeFileSync(new URL(`snapshot/${hash}.json.gz`, import.meta.url), gzipSync(json, { level: 9 }));
const gcc = new Map();
for (const f of evaluations.flatMap((ev) => ev.failures)) if (f.merge) gcc.set(f.merge.commit, (gcc.get(f.merge.commit) ?? 0) + 1);
console.log(`snapshot ${hash}: ${evaluations.filter((ev) => ev.window).length} evaluations in the window, ${evaluations.length} in all, ${evaluations.flatMap((ev) => ev.failures).length} failures, ${placeholders.size} placeholders; largest merge ${Math.max(...gcc.values())} jobs`);
