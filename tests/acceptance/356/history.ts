// Fixture history for #356: Claude Code and Codex sessions placed where those agents keep them, shaped like
// adapters/corpus transcripts, with made-up content. Every message carries a unique tag `[q<n>]` so a test can tell
// which message any text came from. Facts are `remember: <fact>.` in your own words (what the fake agent reads), and
// each is also a plain statement a pattern matcher could take (README, Readings).
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Msg { id: string; role: 'user' | 'assistant'; text: string }
export interface Sess { agent: 'claude' | 'codex'; id: string; cwd: string; day: number; messages: Msg[] }
const DAY = 86_400_000;
export const T0 = Date.UTC(2026, 9, 1, 9);

let counter = 0;
/** A message with a unique tag at its start. */
export function msg(role: 'user' | 'assistant', text: string): Msg {
  counter++;
  return { id: `m${counter}`, role, text: `[q${counter}] ${text}` };
}
export const resetTags = (n = 0): void => { counter = n; };
export const tagOf = (m: Msg): string => m.text.slice(0, m.text.indexOf(']') + 1);

const uuid = (n: number): string => `0000${(n >>> 0).toString(16).padStart(4, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const sessionId = (n: number): string => uuid(n);

export function claudeLines(s: Sess): string {
  let parent: string | null = null;
  return s.messages.map((m, i) => {
    const entry = {
      parentUuid: parent, isSidechain: false, userType: 'external', cwd: s.cwd, sessionId: s.id, version: '2.1.304', gitBranch: 'main',
      timestamp: new Date(T0 + s.day * DAY + i * 1000).toISOString(), type: m.role, uuid: m.id,
      message: m.role === 'user' ? { role: 'user', content: m.text } : { model: 'claude-opus-5-5', id: `msg_${m.id}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: m.text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } },
    };
    parent = m.id;
    return JSON.stringify(entry);
  }).join('\n') + '\n';
}
export function codexLines(s: Sess): string {
  const at = (i: number) => new Date(T0 + s.day * DAY + i * 1000).toISOString();
  const head = { timestamp: at(0), type: 'session_meta', payload: { session_id: s.id, id: s.id, timestamp: at(0), cwd: s.cwd, originator: 'codex_exec', cli_version: '0.144.0', source: 'exec', model_provider: 'openai' } };
  const rest = s.messages.map((m, i) => ({
    timestamp: at(i + 1), type: 'response_item',
    payload: { type: 'message', id: `msg_${m.id}`, role: m.role, content: [{ type: m.role === 'user' ? 'input_text' : 'output_text', text: m.text }] },
  }));
  return [head, ...rest].map((l) => JSON.stringify(l)).join('\n') + '\n';
}
export function pathOf(home: string, s: Sess): string {
  if (s.agent === 'claude') return join(home, '.claude', 'projects', s.cwd.replace(/[^0-9A-Za-z]/g, '-'), `${s.id}.jsonl`);
  const d = new Date(T0 + s.day * DAY);
  const p = (n: number) => String(n).padStart(2, '0');
  return join(home, '.codex', 'sessions', String(d.getUTCFullYear()), p(d.getUTCMonth() + 1), p(d.getUTCDate()), `rollout-${d.toISOString().slice(0, 19).replace(/:/g, '-')}-${s.id}.jsonl`);
}
export function writeSession(home: string, s: Sess): string {
  const path = pathOf(home, s);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, s.agent === 'claude' ? claudeLines(s) : codexLines(s));
  const t = (T0 + s.day * DAY) / 1000;
  utimesSync(path, t, t);
  return path;
}

// ---- Made-up canaries (README, Credentials). Shapes: a Stripe-like test key, a GitHub-like token, a password inside
// a connection URL, and a hex secret from a dotfile.
const rnd = (seed: number, n: number, alphabet: string): string => {
  let a = seed >>> 0; let out = '';
  for (let i = 0; i < n; i++) { a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0; out += alphabet[a % alphabet.length]; }
  return out;
};
const AN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const SEED = 356;
export const CANARIES = {
  stripe: `sk_test_${rnd(SEED + 1, 24, AN)}`,
  github: `ghp_${rnd(SEED + 2, 36, AN)}`,
  dbpass: `Zq${rnd(SEED + 3, 14, AN)}x9`,
  secret: rnd(SEED + 4, 32, '0123456789abcdef'),
};
export const DATABASE_URL = `postgres://app:${CANARIES.dbpass}@localhost:5432/app`;
/** Every form a leak could take: raw, base64 and URL-encoded. */
export function forms(value: string): string[] {
  return [...new Set([value, Buffer.from(value).toString('base64').replace(/=+$/, ''), encodeURIComponent(value)])];
}

// ---- The fixture world: repos under `<tmp>/work`, sessions under the agents' folders in `home`.
export interface Facts { [key: string]: { tag: string; fact: string; handle: string } }
export interface Fixture { sessions: Sess[]; facts: Facts; repos: Record<string, string>; byFact(key: string): { session: Sess; msg: Msg } }

export function fixture(work: string): Fixture {
  resetTags(0);
  const repos = { api: join(work, 'api'), web: join(work, 'web'), api2: join(work, 'other', 'api'), shopOld: join(work, 'old', 'shop'), shopNew: join(work, 'new', 'shop') };
  const found = new Map<string, { session: Sess; msg: Msg }>();
  let n = 0;
  const sess = (agent: Sess['agent'], cwd: string, day: number, items: [string | null, 'user' | 'assistant', string][]): Sess => {
    n++;
    const s: Sess = { agent, id: sessionId(n), cwd, day, messages: [] };
    for (const [key, role, text] of items) { const m = msg(role, text); s.messages.push(m); if (key) found.set(key, { session: s, msg: m }); }
    return s;
  };
  const sessions = [
    sess('claude', repos.api, 1, [
      ['apiStart', 'user', 'remember: api starts with `npm run dev`.'],
      ['apiRelease', 'user', 'remember: api release needs GITHUB_TOKEN from `gh auth token`.'],
      [null, 'assistant', 'Ran GITHUB_TOKEN=$(gh auth token) npm run release:dry and the health check passed.'],
    ]),
    sess('claude', repos.api, 2, [
      ['apiStripe', 'user', 'remember: api integration tests load STRIPE_API_KEY from .env.local.'],
      [null, 'assistant', `The test failed: invalid key ${CANARIES.stripe} for the Stripe account.`],
      ['pasted', 'user', `I pasted it by mistake: ${CANARIES.github} please ignore.`],
    ]),
    sess('codex', repos.api, 3, [
      ['apiStartCodex', 'user', 'remember: api starts with `npm run dev`.'],
      [null, 'assistant', `export SESSION_SECRET=${CANARIES.secret}; psql ${DATABASE_URL} -c 'select 1'`],
      ['apiDocs', 'user', 'remember: api docs start with `npm run dev:api`.'],
    ]),
    sess('claude', repos.web, 4, [
      ['webToken', 'user', 'remember: web deploy needs GH_TOKEN from `gh auth token`.'],
    ]),
    sess('claude', repos.api2, 5, [
      ['api2Start', 'user', 'remember: api starts with `make serve`.'],
    ]),
    sess('claude', repos.shopOld, 6, [
      ['shopOld', 'user', 'remember: shop starts with `docker compose up`.'],
    ]),
    sess('claude', repos.shopNew, 7, [
      ['shopNew', 'user', 'remember: shop lints with `npm run lint`.'],
    ]),
  ];
  const facts: Facts = {};
  for (const [key, { session, msg: m }] of found) facts[key] = { tag: tagOf(m), fact: m.text.replace(/^\[q\d+\] remember: /, '').replace(/\.$/, ''), handle: `session:${session.id.replace(/[^0-9A-Za-z]/g, '')}#${m.id}` };
  return { sessions, facts, repos, byFact: (k) => found.get(k)! };
}
export const MEMORY = '- Never commit directly to main.\n- Run npm test before you push.\n';

/** 30 days of history: 212 sessions over four repos, 12 messages of about 600 characters each, the second a `remember:` fact. */
export function corpus(work: string, first = 1000): Sess[] {
  const repos = ['api', 'web', 'cli', 'docs'].map((n) => join(work, 'corpus', n));
  return Array.from({ length: 212 }, (_, i) => {
    const messages: Msg[] = [];
    for (let k = 0; k < 12; k++) {
      const filler = rnd(first + i * 31 + k, 600, 'abcdefghij klmnopqrst uvwxyz ');
      messages.push(k === 1 ? msg('user', `remember: ${repos[i % 4]!.split('/').pop()} fact ${i} starts with \`npm run dev${i % 5}\`. ${filler.slice(0, 500)}`) : msg(k % 2 ? 'assistant' : 'user', filler));
    }
    return { agent: i % 5 === 4 ? 'codex' : 'claude', id: sessionId(first + i), cwd: repos[i % 4]!, day: Math.floor((i * 30) / 212), messages } as Sess;
  });
}
