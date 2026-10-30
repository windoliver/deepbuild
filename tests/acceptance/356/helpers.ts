// #356's helpers: #19's setup helpers (copied, setup19.ts) plus the fake agent, history, the wiki on disk and plan
// windows for the runner. Nothing here stands in for DeepBuild.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { COVERED, FIXTURES, NODE, control, deep, makeHome, rootOf, sleep, waitFor, type Home, type Line, type Ran } from './setup19.ts';
import { CANARIES, MEMORY, fixture, writeSession, type Fixture, type Sess } from './history.ts';

export * from './setup19.ts';
export const ACCOUNT = '6363aaaa-1111-4222-8333-444444444444';
export const WINDOW_TOKENS = 20_000_000;
export const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** The fake agent as `claude` on the login PATH (replaces #19's logging stub). */
export function installFake(bin: string): void {
  const text = readFileSync(join(FIXTURES, 'fake-reader.pl'), 'utf8').replace('__VERSION__', COVERED).replace('__PLANTED__', Buffer.from('[]').toString('base64'));
  writeFileSync(join(bin, 'claude'), text, { mode: 0o755 });
  chmodSync(join(bin, 'claude'), 0o755);
}

export interface World { h: Home; fx: Fixture; work: string; wiki: string }
/** A home with the fake agent, a sign-in, memory, repos and the fixture sessions. */
export function world(extra: { sessions?: Sess[] } = {}): World {
  const h = makeHome();
  installFake(h.bin);
  const work = join(h.tmp, 'work');
  const fx = fixture(work);
  for (const [name, dir] of Object.entries(fx.repos)) {
    if (name === 'shopOld') continue; // the old path no longer exists (README, Unclear merge)
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  }
  writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'a@example.invalid' } }));
  mkdirSync(join(h.home, '.claude'), { recursive: true });
  writeFileSync(join(h.home, '.claude', 'CLAUDE.md'), MEMORY);
  writeFileSync(join(fx.repos.api, '.env.local'), `STRIPE_API_KEY=${CANARIES.stripe}\nSESSION_SECRET=${CANARIES.secret}\n`);
  for (const s of [...fx.sessions, ...(extra.sessions ?? [])]) writeSession(h.home, s);
  return { h, fx, work, wiki: join(rootOf(h.home), 'wiki') };
}

// ---- Plan windows: the status line forwarder's stand-in reports the window used so far (as #63's runReading does).
const limits = (used: number, now: number) => ({
  five_hour: { used_percentage: used, resets_at: Math.floor((now + 3 * 3_600_000) / 1000) },
  seven_day: { used_percentage: 20, resets_at: Math.floor((now + 5 * 86_400_000) / 1000) },
});
export function tokensOf(stdout: string): number {
  const seen = new Set<string>(); let total = 0;
  for (const raw of stdout.split('\n')) {
    let e: Line; try { e = JSON.parse(raw); } catch { continue; }
    if (e.type !== 'assistant' || !e.message?.usage || seen.has(String(e.message.id))) continue;
    seen.add(String(e.message.id));
    const u = e.message.usage as Line;
    total += Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.output_tokens ?? 0);
  }
  return total;
}
export interface Windows { stop(): Promise<{ tokens: number }>; }
/** Reports the window to the hub as soon as it answers, then every 250 ms: `startPct` plus what runner jobs spent. */
export function windows(home: string, startPct = 5): Windows {
  let done = false; let tokens = 0;
  const loop = (async () => {
    while (!done) {
      try {
        await control(home, async (c) => {
          const jobs = (await c.call('job.list')).jobs as { job: string }[];
          tokens = 0;
          for (const j of jobs) tokens += tokensOf(String((await c.call('job.output', { job: j.job })).stdout ?? ''));
          const used = Math.round((startPct + (100 * tokens) / WINDOW_TOKENS) * 100) / 100;
          await c.call('windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: limits(used, Date.now()) });
        });
      } catch { /* the hub isn't up yet */ }
      await sleep(250);
    }
  })();
  return { stop: async () => { done = true; await loop; return { tokens }; } };
}

// ---- The wiki on disk.
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
export const snapshot = (dir: string): Map<string, string> => new Map(walk(dir).map((f) => [relative(dir, f), readFileSync(f, 'utf8')]));
export interface Claim { page: string; line: string; text: string; json: Line }
const CLAIM = /^- (.*) <!-- deep:claim (\{.*\}) -->\s*$/;
export function claims(wiki: string): Claim[] {
  const out: Claim[] = [];
  for (const [page, text] of snapshot(wiki)) {
    if (!page.endsWith('.md') || page === 'index.md' || page === 'log.md') continue;
    for (const line of text.split('\n')) {
      const m = CLAIM.exec(line);
      if (m) { try { out.push({ page, line, text: m[1]!, json: JSON.parse(m[2]!) as Line }); } catch { /* not a claim */ } }
    }
  }
  return out;
}
/** Claims whose quote (any source) holds `needle`. */
export const claimsQuoting = (wiki: string, needle: string): Claim[] =>
  claims(wiki).filter((c) => ((c.json.sources ?? []) as { quote?: string }[]).some((s) => String(s.quote ?? '').includes(needle)));

// ---- Setup, and waiting for the reading jobs it started.
export async function setupWithWindows(w: World, o: { env?: Record<string, string | undefined>; startPct?: number } = {}): Promise<{ run: Ran; tokens: number }> {
  await (await import('./setup19.ts')).cargoBuild();
  const win = windows(w.h.home, o.startPct);
  try {
    const run = await deep(w.h.home, ['setup'], { env: o.env, timeoutMs: 300_000 });
    await readsDone(w.h.home);
    return { run, tokens: (await win.stop()).tokens };
  } catch (e) { await win.stop(); throw e; }
}
/** Every runner job of kind read has ended and every reading.finished is in (bound 300 s). */
export async function readsDone(home: string, timeoutMs = 300_000): Promise<void> {
  await waitFor(async () => control(home, async (c) => {
    const jobs = (await c.call('job.list')).jobs as { state?: string; status?: string }[];
    return jobs.every((j) => !['running', 'waiting', 'queued'].includes(String(j.state ?? j.status))) || undefined;
  }), timeoutMs, 'every reading job to end');
}
export async function eventsOf(home: string, kinds?: string[]): Promise<{ kind: string; data: Line; log_pos: number }[]> {
  return control(home, async (c) => {
    const out: { kind: string; data: Line; log_pos: number }[] = [];
    for (let after = 0; ;) {
      const page = (await c.call('events.read', { after, limit: 1000, ...(kinds ? { kinds } : {}) })).events as typeof out;
      if (!page.length) return out;
      out.push(...page); after = page[page.length - 1]!.log_pos;
    }
  });
}
/** Every prompt and tool result every runner job's fake reported, as one text. */
export async function deliveredText(home: string): Promise<string> {
  return control(home, async (c) => {
    const jobs = (await c.call('job.list')).jobs as { job: string }[];
    let t = '';
    for (const j of jobs) t += String((await c.call('job.output', { job: j.job })).stdout ?? '');
    return t;
  });
}
/** Where the user is shown what changed: the stdout lines naming a wiki page by its relative path. */
export const changedPages = (stdout: string): string[] => stdout.split('\n').flatMap((l) => { const m = /(?:^|\s)((?:repos\/)?[A-Za-z0-9._-]+\.md)\b/.exec(l); return m && !/^(index|log)\.md$/.test(m[1]!) ? [m[1]!] : []; });
export const NODE_BIN = NODE;
export { execFileSync, rmSync, statSync };

// ---- The Set up click, headless (#326): `deep-app --set-up`, in a folder outside every repo.
import { join as pjoin, dirname as pdirname } from 'node:path';
import { REPO, childEnv, cargoBuild, run } from './setup19.ts';
export const APP = pjoin(REPO, 'target/debug/deep-app');
let appBuild: Promise<Ran> | undefined;
export async function click(home: string, env?: Record<string, string | undefined>): Promise<Ran> {
  await cargoBuild();
  appBuild ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-app', '--bin', 'deep-app'], { cwd: REPO, timeoutMs: 1_200_000 });
  const b = await appBuild;
  if (b.code !== 0) throw Error(`BLOCKED: cargo build -p deep-app failed: ${b.stderr.slice(-2000)}`);
  return run(APP, ['--set-up'], { env: childEnv(home, env), cwd: pdirname(home), timeoutMs: 300_000 });
}
