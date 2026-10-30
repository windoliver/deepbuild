// The wiki's build at setup (#356), through a real hub on a temp home: what the setup learns from tool calls (how stacks
// were started when a check passed, which credential each step needed, by name only), the memory files, the choices
// drafted once into config.json, and the answer to an unclear merge. Nothing is mocked; the sessions are files where
// the agents keep them, and no job reads free text (no message here states something worth a reading).
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { call } from '../src/client.js';
import { withHub } from './hub.js';

type Obj = Record<string, unknown>;
const uuid = (n: number): string => `0000${n.toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const git = (cwd: string, ...args: string[]): void => { spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' }); };
/** A repo folder with a commit, and a folder that isn't one. */
function repo(path: string, files: Record<string, string> = {}): string {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  writeFileSync(join(path, 'README.md'), 'x\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(path, name), text);
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'one');
  return path;
}

/** One Claude Code session: its user turns and the tool calls the agent made, each with its result. */
class Claude {
  private lines: Obj[] = [];
  private n = 0;
  constructor(readonly home: string, readonly cwd: string, readonly id: string) {}
  user(text: string): this { this.lines.push({ type: 'user', uuid: `u${++this.n}`, message: { role: 'user', content: text } }); return this; }
  /** The agent runs `command`; `result` is what came back, `error` when the tool reported one. */
  bash(command: string, result: string, error = false): this {
    const call = `toolu_${++this.n}`;
    this.lines.push({ type: 'assistant', uuid: `a${this.n}`, message: { role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'Bash', input: { command } }] } });
    this.lines.push({ type: 'user', uuid: `r${this.n}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: result, is_error: error }] } });
    return this;
  }
  write(): void {
    const dir = join(this.home, '.claude', 'projects', this.cwd.replace(/[^0-9A-Za-z]/g, '-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${this.id}.jsonl`), `${this.lines.map((l) => JSON.stringify({ cwd: this.cwd, sessionId: this.id, ...l })).join('\n')}\n`);
  }
}
/** One Codex session, with function calls and their outputs. */
class Codex {
  private lines: Obj[] = [];
  private n = 0;
  constructor(readonly home: string, readonly cwd: string, readonly id: string) {}
  user(text: string): this { this.lines.push({ type: 'response_item', payload: { type: 'message', id: `msg_u${++this.n}`, role: 'user', content: [{ type: 'input_text', text }] } }); return this; }
  exec(cmd: string, output: string, code = 0): this {
    const call_id = `call_${++this.n}`;
    this.lines.push({ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd }), call_id } });
    this.lines.push({ type: 'response_item', payload: { type: 'function_call_output', call_id, output: `Process exited with code ${code}\nOutput:\n${output}` } });
    return this;
  }
  write(): void {
    const dir = join(this.home, '.codex', 'sessions', '2026', '10', '01');
    mkdirSync(dir, { recursive: true });
    const head = { type: 'session_meta', payload: { session_id: this.id, id: this.id, timestamp: '2026-10-01T09:00:00.000Z', cwd: this.cwd, originator: 'codex_exec', cli_version: '0.144.0', source: 'exec' } };
    writeFileSync(join(dir, `rollout-2026-10-01T09-00-00-${this.id}.jsonl`), `${[head, ...this.lines].map((l, i) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 9, 1, 9, 0, i)).toISOString(), ...l })).join('\n')}\n`);
  }
}

const confirmFile = join('/tmp', `deep-wiki-356-confirm-${process.pid}`);
/** Rows of the ledger, read on their own connection. */
function rows<T>(root: string, sql: string): T[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
}
const socket = (root: string): string => join(root, 'hub.sock');
const token = (root: string): string => readFileSync(join(root, 'control.token'), 'utf8').trim();
async function build(root: string): Promise<{ changed: string[] }> {
  const reply = await call(socket(root), token(root), 'wiki.build', {});
  if ('error' in reply) throw new Error(JSON.stringify(reply.error));
  return reply.result as { changed: string[] };
}
const pages = (root: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.md')) out.set(join(dir, e.name).slice(join(root, 'wiki').length + 1), readFileSync(join(dir, e.name), 'utf8'));
    }
  };
  walk(join(root, 'wiki'));
  return out;
};
interface Claim { page: string; text: string; known: string; state?: string; sources: { at?: string; path?: string; quote: string }[] }
/** The claims in force on the pages; a superseded one stays on its page, marked, and is counted only with `all`. */
const claims = (root: string, all = false): Claim[] => [...pages(root)].filter(([name]) => !/^(index|log)\.md$|^questions\//.test(name)).flatMap(([page, text]) => text.split('\n').flatMap((line) => {
  const m = /^- (.*?) <!-- deep:claim (\{.*\}) -->$/.exec(line);
  if (!m) return [];
  const record = JSON.parse(m[2]!.replace(/\\u003e/g, '>')) as { known: string; state?: string; sources: Claim['sources'] };
  if (!all && record.state === 'superseded') return [];
  return [{ page: page.replace(/\.md$/, ''), text: m[1]!, known: record.known, sources: record.sources, ...(record.state ? { state: record.state } : {}) }];
}));

describe('what setup learns from the tool calls in your history', () => {
  it('writes how a stack was started when a check passed after it, citing the command and the check\'s result', async () => {
    await withHub(async (root, home) => {
      const work = join(home, 'work');
      const claude = repo(join(work, 'claudeapp'));
      const codex = repo(join(work, 'codexapp'));
      const failing = repo(join(work, 'failing'));
      const alone = repo(join(work, 'alone'));
      const codexFailing = repo(join(work, 'codexfailing'));
      new Claude(home, claude, uuid(1)).user('bring the stack up').bash('cd web && npm run dev &', 'ready on port 3000').bash('curl -fs http://localhost:3000/health', '{"ok":true}').write();
      new Codex(home, codex, uuid(2)).user('bring the stack up').exec('docker compose up -d', 'Container api  Started').exec('curl -fs http://localhost:8080/healthz', 'ok').write();
      new Claude(home, failing, uuid(3)).user('bring the stack up').bash('make serve', 'serving').bash('curl -fs http://localhost:9000/health', 'connection refused', true).write();
      new Codex(home, codexFailing, uuid(5)).user('bring the stack up').exec('make serve', 'serving').exec('curl -fs http://localhost:9001/health', 'connection refused', 7).write();
      new Claude(home, alone, uuid(4)).user('bring the stack up').bash('npm run start', 'listening').write();
      await build(root);
      const found = claims(root).filter((c) => /starts/.test(c.text));
      expect(found.map((c) => c.text).sort()).toEqual([
        'starts with `docker compose up -d`; a check passed after it: `curl -fs http://localhost:8080/healthz`.',
        'starts with `npm run dev`; a check passed after it: `curl -fs http://localhost:3000/health`.',
      ]);
      const first = found.find((c) => /npm run dev/.test(c.text))!;
      expect(first.page).toMatch(/^repos\/claudeapp[0-9a-f]{8}$/);
      // Its own word never makes it yours, and one source is a tool's result: first-hand, not the agent's turn.
      expect(first.known).toBe('inferred');
      expect(first.sources.map((s) => s.quote)).toContain('{"ok":true}');
      expect(first.sources.map((s) => s.quote)).toContain('npm run dev');
      expect(found.find((c) => /docker compose/.test(c.text))!.page).toMatch(/^repos\/codexapp[0-9a-f]{8}$/);
    });
  }, 120_000);

  it('names the credential a step needed and where it is loaded from, never its value', async () => {
    await withHub(async (root, home) => {
      const app = repo(join(home, 'work', 'credapp'));
      // Made up at runtime: the canaries are the values the sweep looks for.
      const canary = (tag: string): string => `${tag}${Buffer.from(`canary-${tag}-${process.pid}-${Date.now()}`).toString('hex').slice(0, 30)}`;
      const values = { secret: canary('s'), url: canary('u'), exported: canary('e') };
      new Claude(home, app, uuid(10)).user('release it')
        .bash('GITHUB_TOKEN=$(gh auth token) npm run release:dry', 'dry run complete')
        .bash('REDIS_URL=$(cat redis.url) npm run cache', 'cache warm')
        .bash(`export SESSION_SECRET=${values.exported} && npm run seed`, 'seeded 3 rows')
        .bash('set -a; . .env.local; set +a; npm test -- --reporter dot $STRIPE_API_KEY', '12 passed')
        .bash(`DATABASE_URL=postgres://app:${values.url}@localhost:5432/app npm run migrate`, 'migrated')
        .bash(`echo ${values.secret}`, values.secret)
        .write();
      await build(root);
      const text = [...pages(root).values()].join('\n');
      // The archived copy hides a secret-named assignment's whole value, `$(gh auth token)` too: the name is all it keeps.
      expect(text).toContain('`GITHUB_TOKEN` is set on the command line');
      expect(text).toContain('`REDIS_URL` is loaded from `cat redis.url`');
      expect(text).toContain('`SESSION_SECRET` is exported: `export SESSION_SECRET`');
      expect(text).toContain('`STRIPE_API_KEY` is loaded from `.env.local`');
      expect(text).toContain('`DATABASE_URL` is set on the command line');
      expect(claims(root).filter((c) => /GITHUB_TOKEN|SESSION_SECRET|STRIPE_API_KEY|DATABASE_URL|REDIS_URL/.test(c.text))).toHaveLength(5);
      // No value anywhere under the root: raw, base64 or URL-encoded, in pages, log, index, ledger or its WAL.
      const files: string[] = [];
      const walk = (dir: string): void => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (statSync(p).isFile()) files.push(p); } };
      walk(root);
      const forms = Object.values(values).flatMap((v) => [v, Buffer.from(v).toString('base64').replace(/=+$/, ''), encodeURIComponent(v)]);
      const leaks = files.filter((f) => f.startsWith(join(root, 'wiki')) || /ledger\.db/.test(f)).filter((f) => { const bytes = readFileSync(f); return forms.some((v) => bytes.includes(v)); });
      expect(leaks, 'a page, log, index or the ledger holds a value').toEqual([]);
    });
  }, 120_000);
});

describe('the memory files', () => {
  it('reads Claude Code\'s per-project memory as rules, and cites a repo\'s own AGENTS.md instead of copying it', async () => {
    await withHub(async (root, home) => {
      const app = repo(join(home, 'work', 'memapp'), { 'AGENTS.md': '# Rules\n\n- memapp starts with `npm run dev`.\n- Never print a token.\n' });
      new Claude(home, app, uuid(20)).user('remember: memapp starts with `npm run dev`.').write();
      const memory = join(home, '.claude', 'projects', app.replace(/[^0-9A-Za-z]/g, '-'), 'memory');
      mkdirSync(memory, { recursive: true });
      writeFileSync(join(memory, 'MEMORY.md'), '- [Port](port.md) — memapp serves on port 4100\n');
      writeFileSync(join(memory, 'port.md'), '---\nname: port\n---\n\nmemapp serves on port 4100.\n');
      await build(root);
      const all = claims(root);
      // The project's memory is the repo's page; each line is cited at its file.
      expect(all.filter((c) => /port 4100/.test(c.text)).map((c) => c.page).every((p) => /^repos\/memapp[0-9a-f]{8}$/.test(p))).toBe(true);
      expect(all.some((c) => /port 4100/.test(c.text))).toBe(true);
      // A repo's own file is read from the file: no line of it becomes a claim of its own...
      expect(all.some((c) => /Never print a token/.test(c.text))).toBe(false);
      // ...and a claim of yours that it states too cites it, at the file and commit, so trust decides what it is.
      const start = all.find((c) => /npm run dev/.test(c.text))!;
      expect(start.sources.some((s) => s.path === 'AGENTS.md' && /npm run dev/.test(s.quote))).toBe(true);
    });
  }, 120_000);
});

describe('the one-time choices', () => {
  it('drafts the reading agent, the plan reserve and each account\'s repos once, and a second setup keeps an edited value', async () => {
    await withHub(async (root, home) => {
      const app = repo(join(home, 'work', 'choiceapp'));
      new Claude(home, app, uuid(30)).user('hello').write();
      new Codex(home, app, uuid(31)).user('hello').write();
      const file = join(root, 'config.json');
      await build(root);
      const config = JSON.parse(readFileSync(file, 'utf8')) as { plan: { reserve_pct: number }; reading: { agent: string }; accounts: Record<string, { repos: string[] }> };
      expect(config.plan.reserve_pct).toBe(10);
      expect(config.reading.agent).toBe('claude-code');
      expect(config.accounts['claude-code']!.repos).toEqual([app]);
      expect(config.accounts.codex!.repos).toEqual([app]);
      const edited = { ...config, plan: { reserve_pct: 25 }, reading: { agent: 'codex' }, accounts: { ...config.accounts, 'claude-code': { repos: ['/elsewhere'] } } };
      writeFileSync(file, JSON.stringify(edited));
      new Claude(home, join(home, 'work', 'other'), uuid(32)).user('hello').write();
      await build(root);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(edited);
    });
  }, 120_000);

  it('runs the wiki\'s reading on the agent the choices name', async () => {
    await withHub(async (root, home) => {
      const app = repo(join(home, 'work', 'readapp'));
      new Claude(home, app, uuid(40)).user('the api always needs a token').write();
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'config.json'), JSON.stringify({ reading: { agent: 'codex' } }));
      await build(root);
      const jobs = ((await call(socket(root), token(root), 'job.list', {})) as { result: { jobs: { kind: string; agent: string }[] } }).result.jobs;
      expect(jobs.filter((j) => j.kind === 'read').map((j) => j.agent)).toEqual(['codex']);
    });
  }, 120_000);
});

describe('an unclear merge', () => {
  it('"Same repo" moves the gone folder\'s claims to the live repo\'s page by supersession, and later builds keep them there', async () => {
    await withHub(async (root, home) => {
      const live = repo(join(home, 'new', 'shop'));
      const gone = join(home, 'old', 'shop');
      new Claude(home, gone, uuid(50)).user('remember: shop starts with `docker compose up`.').write();
      new Claude(home, live, uuid(51)).user('remember: shop lints with `npm run lint`.').write();
      await build(root);
      const apart = claims(root).filter((c) => /shop/.test(c.text));
      expect(new Set(apart.map((c) => c.page)).size, 'apart until you say').toBe(2);
      const [ask] = rows<{ id: string; options: string }>(root, "SELECT id, options FROM asks WHERE question LIKE '%shop%'");
      expect(ask, 'the merge is asked').toBeDefined();
      expect((JSON.parse(ask!.options) as { id: string; label: string }[]).map((o) => o.label)).toEqual(['Keep them apart', 'Same repo', 'Not now']);
      writeFileSync(confirmFile, 'confirmed');
      const answered = await call(socket(root), token(root), 'ask.answer', { ask: `ask:${ask!.id}`, option: 'same' });
      expect('error' in answered ? JSON.stringify(answered.error) : '').toBe('');
      await build(root);
      const onePage = claims(root).filter((c) => /shop/.test(c.text));
      expect(new Set(onePage.map((c) => c.page)).size, 'one page after the answer').toBe(1);
      expect(onePage.map((c) => c.text).sort()).toEqual(['shop lints with `npm run lint`', 'shop starts with `docker compose up`']);
      // Superseded, not deleted: the old line is still on its page and in the record, marked so, and the new one cites it.
      expect(claims(root, true).filter((c) => c.state === 'superseded').map((c) => c.text)).toEqual(['shop starts with `docker compose up`']);
      const held = rows<{ page: string; state: string }>(root, "SELECT page, state FROM wiki_claims WHERE text LIKE '%docker compose up%'");
      expect(held.map((r) => r.state).sort()).toEqual(['in force', 'superseded']);
      // A build after that changes nothing.
      expect((await build(root)).changed).toEqual([]);
    }, { DEEP_HUB_TEST_CONFIRM: confirmFile });
  }, 180_000);
});
