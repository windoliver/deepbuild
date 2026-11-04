// Twenty Codex review rounds on ten claims, written by this job as fixtures: no recorded corpus of review rounds
// exists at the base (tests/ and benchmarks/ hold none). Each claim is a small TypeScript change in a git history:
// the base, commit A (the change, reviewed in round 1 on base..A) and commit B (the agent's next commit after the
// send-back, re-reviewed in round 2 on A..B), and for one claim a commit C after the last review. Each round holds
// what Codex answered, in the review check's finding schema (file, line, rule, quote) with Codex's own fields beside
// it (title, body, priority, confidence and the overall verdict and explanation, all prose), and the items the round
// sent back, by this issue's rules: a finding missing a field, quoting text not at its cited line, or citing a rule
// not in the rubric is dropped; a finding on a line the change didn't add or alter (a context line) is a follow-up;
// a finding whose rule and quote match an item already sent back on the claim isn't sent again; and findings of one
// rule go back as one item listing every site. `outcomes` is how each sent-back item ended: fixed by the first later
// commit that changes a line it cites, or left, decided by the commit the claim settled on (its last).

export type Snapshot = Record<string, string[] | null>;
export type CodexFinding = {
  title?: string; body?: string; priority?: number; confidence_score?: number;
  file?: string; line?: number; rule?: string; quote?: string;
};
export type CodexAnswer = {
  findings: CodexFinding[];
  overall_correctness: 'patch is correct' | 'patch is incorrect';
  overall_explanation: string;
  overall_confidence_score: number;
};
/** An item as sent back: its rule and each site as [file, line, quote]. */
export interface SentItem { rule: string; sites: [string, number, string][] }
export interface RecordedRound { reviews: 'A' | 'B'; answer: CodexAnswer; sent: SentItem[] }
export interface RecordedOutcome { rule: string; site: [string, number]; ended: 'fixed' | 'left'; by: 'B' | 'C' }
export interface RecordedClaim {
  id: string;
  base: Snapshot;
  commits: { label: 'A' | 'B' | 'C'; files: Snapshot }[];
  rounds: [RecordedRound, RecordedRound];
  outcomes: RecordedOutcome[];
}

const clean = (overall_explanation: string): CodexAnswer => ({ findings: [], overall_correctness: 'patch is correct', overall_explanation, overall_confidence_score: 0.86 });

export const CLAIMS: RecordedClaim[] = [
  {
    id: 'session-load',
    base: { 'src/session.ts': [
      "import { store } from './store';",
      '',
      'export function load(raw: string) {',
      '  return store.get(raw);',
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/session.ts': [
        "import { store } from './store';",
        '',
        'export function load(raw: string) {',
        '  const data = JSON.parse(raw);',
        '  return store.get(data.id);',
        '}',
      ] } },
      { label: 'B', files: { 'src/session.ts': [
        "import { store } from './store';",
        "import { parseSession } from './schema';",
        '',
        'export function load(raw: string) {',
        '  const data = parseSession(raw);',
        '  return store.get(data.id);',
        '}',
      ] } },
      { label: 'C', files: { 'src/session.ts': [
        "import { store } from './store';",
        "import { parseSession } from './schema';",
        '',
        'export function load(raw: string) {',
        '  const data = parseSession(raw);',
        '  return store.get(data.id);',
        '}',
        'export const SESSION_TTL = 3600;',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'unchecked-parse', sites: [['src/session.ts', 4, 'const data = JSON.parse(raw);']] }], answer: {
        findings: [{
          title: '[P1] Parse session payload defensively',
          body: '`load` now calls `JSON.parse` on the raw cookie value. A malformed cookie throws a SyntaxError that escapes to the request handler and returns a 500. Validate the shape or catch the error.',
          priority: 1, confidence_score: 0.81, file: 'src/session.ts', line: 4, rule: 'unchecked-parse', quote: 'const data = JSON.parse(raw);',
        }],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The change introduces an unguarded parse of client-controlled input.',
        overall_confidence_score: 0.78,
      } },
      { reviews: 'B', sent: [], answer: clean('The parse now goes through the schema validator; no further issues in this change.') },
    ],
    outcomes: [{ rule: 'unchecked-parse', site: ['src/session.ts', 4], ended: 'fixed', by: 'B' }],
  },
  {
    id: 'report-send',
    base: { 'src/report.ts': [
      'export async function send(report: Report) {',
      '  await mailer.send(report);',
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/report.ts': [
        'export async function send(report: Report) {',
        '  try {',
        '    await mailer.send(report);',
        '  } catch {}',
        '}',
      ] } },
      { label: 'B', files: { 'src/report.ts': [
        'export async function send(report: Report) {',
        '  try {',
        '    await mailer.send(report);',
        '  } catch (err) {',
        "    log.error('report send failed', err);",
        '    throw err;',
        '  }',
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'swallowed-error', sites: [['src/report.ts', 4, '} catch {}']] }], answer: {
        findings: [
          {
            title: '[P1] Mail failures are silently dropped',
            body: 'The empty catch swallows every error from `mailer.send`, so callers believe the report went out. Rethrow or at least log.',
            priority: 1, confidence_score: 0.88, file: 'src/report.ts', line: 4, rule: 'swallowed-error', quote: '} catch {}',
          },
          {
            title: '[P3] Consider structured logging here',
            body: 'It may be worth wrapping this in the shared retry helper.',
            priority: 3, confidence_score: 0.35, file: 'src/report.ts', line: 2, rule: 'swallowed-error',
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'Errors from the mailer are discarded.',
        overall_confidence_score: 0.84,
      } },
      { reviews: 'B', sent: [], answer: clean('The catch now logs and rethrows. Looks good.') },
    ],
    outcomes: [{ rule: 'swallowed-error', site: ['src/report.ts', 4], ended: 'fixed', by: 'B' }],
  },
  {
    id: 'page-rows',
    base: { 'src/page.ts': [
      'export function page<T>(rows: T[], size: number): T[][] {',
      '  const out: T[][] = [];',
      '  return out;',
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/page.ts': [
        'export function page<T>(rows: T[], size: number): T[][] {',
        '  const out: T[][] = [];',
        '  for (let i = 0; i <= rows.length; i += size) {',
        '    out.push(rows.slice(i, i + size));',
        '  }',
        '  return out;',
        '}',
      ] } },
      { label: 'B', files: { 'src/page.ts': [
        'export function page<T>(rows: T[], size: number): T[][] {',
        '  const out: T[][] = [];',
        '  for (let i = 0; i < rows.length; i += size) {',
        '    out.push(rows.slice(i, i + size));',
        '  }',
        '  return out;',
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'off-by-one', sites: [['src/page.ts', 3, 'i <= rows.length']] }], answer: {
        findings: [
          {
            title: '[P2] Loop emits an empty trailing page',
            body: 'When `rows.length` is a multiple of `size`, `i <= rows.length` runs once more and pushes `[]`.',
            priority: 2, confidence_score: 0.74, file: 'src/page.ts', line: 3, rule: 'off-by-one', quote: 'i <= rows.length',
          },
          {
            title: '[P3] Name `out` more descriptively',
            body: 'Something like `pages` reads better.',
            priority: 3, confidence_score: 0.4, file: 'src/page.ts', line: 4, rule: 'prefer-descriptive-names', quote: 'out.push(rows.slice(i, i + size));',
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'Pagination yields an extra empty page on exact multiples.',
        overall_confidence_score: 0.7,
      } },
      { reviews: 'B', sent: [], answer: {
        findings: [{
          title: '[P3] Name `out` more descriptively',
          body: 'Still worth renaming.',
          priority: 3, confidence_score: 0.38, file: 'src/page.ts', line: 4, rule: 'prefer-descriptive-names', quote: 'out.push(rows.slice(i, i + size));',
        }],
        overall_correctness: 'patch is correct',
        overall_explanation: 'The bound is fixed; one naming nit remains.',
        overall_confidence_score: 0.8,
      } },
    ],
    outcomes: [{ rule: 'off-by-one', site: ['src/page.ts', 3], ended: 'fixed', by: 'B' }],
  },
  {
    id: 'users-query',
    base: { 'src/users.ts': ["import { db } from './db';"] },
    commits: [
      { label: 'A', files: { 'src/users.ts': [
        "import { db } from './db';",
        '',
        'export function byName(name: string) {',
        `  return db.query("SELECT * FROM users WHERE name = '" + name + "'");`,
        '}',
        '',
        'export function byEmail(email: string) {',
        `  return db.query("SELECT * FROM users WHERE email = '" + email + "'");`,
        '}',
      ] } },
      { label: 'B', files: { 'src/users.ts': [
        "import { db } from './db';",
        '',
        'export function byName(name: string) {',
        "  return db.query('SELECT * FROM users WHERE name = ?', [name]);",
        '}',
        '',
        'export function byEmail(email: string) {',
        "  return db.query('SELECT * FROM users WHERE email = ?', [email]);",
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'sql-concat', sites: [
        ['src/users.ts', 4, `"SELECT * FROM users WHERE name = '" + name + "'"`],
        ['src/users.ts', 8, `"SELECT * FROM users WHERE email = '" + email + "'"`],
      ] }], answer: {
        findings: [
          {
            title: '[P0] SQL injection in byName',
            body: '`name` comes from the query string and is concatenated into the statement. Use a bound parameter.',
            priority: 0, confidence_score: 0.93, file: 'src/users.ts', line: 4, rule: 'sql-concat', quote: `"SELECT * FROM users WHERE name = '" + name + "'"`,
          },
          {
            title: '[P0] SQL injection in byEmail',
            body: 'Same pattern as byName.',
            priority: 0, confidence_score: 0.92, file: 'src/users.ts', line: 8, rule: 'sql-concat', quote: `"SELECT * FROM users WHERE email = '" + email + "'"`,
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'Both new lookups build SQL from user input.',
        overall_confidence_score: 0.91,
      } },
      { reviews: 'B', sent: [], answer: clean('Both queries are parameterized now.') },
    ],
    outcomes: [{ rule: 'sql-concat', site: ['src/users.ts', 4], ended: 'fixed', by: 'B' }],
  },
  {
    id: 'jobs-ack',
    base: { 'src/jobs.ts': [
      'export async function run(queue: Queue) {',
      '  const job = queue.next();',
      '  const cfg = JSON.parse(job.payload);',
      '  return cfg;',
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/jobs.ts': [
        'export async function run(queue: Queue) {',
        '  const job = queue.next();',
        '  const cfg = JSON.parse(job.payload);',
        '  queue.ack(job.id);',
        '  return cfg;',
        '}',
      ] } },
      { label: 'B', files: { 'src/jobs.ts': [
        'export async function run(queue: Queue) {',
        '  const job = queue.next();',
        '  const cfg = JSON.parse(job.payload);',
        '  await queue.ack(job.id);',
        '  return cfg;',
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'missing-await', sites: [['src/jobs.ts', 4, 'queue.ack(job.id);']] }], answer: {
        findings: [
          {
            title: '[P1] ack is not awaited',
            body: '`queue.ack` returns a promise; a rejected ack is unhandled and the job is redelivered.',
            priority: 1, confidence_score: 0.77, file: 'src/jobs.ts', line: 4, rule: 'missing-await', quote: 'queue.ack(job.id);',
          },
          {
            title: '[P2] Payload parse can throw',
            body: 'A malformed payload throws before the ack.',
            priority: 2, confidence_score: 0.55, file: 'src/jobs.ts', line: 3, rule: 'unchecked-parse', quote: 'JSON.parse(job.payload)',
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The new ack call is fire-and-forget.',
        overall_confidence_score: 0.72,
      } },
      { reviews: 'B', sent: [], answer: {
        findings: [{
          title: '[P2] Payload parse can throw',
          body: 'Still unguarded.',
          priority: 2, confidence_score: 0.5, file: 'src/jobs.ts', line: 3, rule: 'unchecked-parse', quote: 'JSON.parse(job.payload)',
        }],
        overall_correctness: 'patch is correct',
        overall_explanation: 'The ack is awaited now.',
        overall_confidence_score: 0.75,
      } },
    ],
    outcomes: [{ rule: 'missing-await', site: ['src/jobs.ts', 4], ended: 'fixed', by: 'B' }],
  },
  {
    id: 'client-token',
    base: {
      'src/client.ts': [
        'export const client = new Client({',
        '  url: process.env.API_URL,',
        '});',
      ],
      'src/config.ts': [
        'export const config = {',
        '  retries: 3,',
        '  timeout: 1000,',
        '};',
      ],
    },
    commits: [
      { label: 'A', files: { 'src/client.ts': [
        'export const client = new Client({',
        '  url: process.env.API_URL,',
        "  token: 'tok_test_0000',",
        '});',
      ] } },
      { label: 'B', files: { 'src/config.ts': [
        'export const config = {',
        '  retries: 3,',
        '  timeout: 2000,',
        '};',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'secret-in-code', sites: [['src/client.ts', 3, "token: 'tok_test_0000',"]] }], answer: {
        findings: [{
          title: '[P1] Token committed in source',
          body: 'Read the token from the environment like the URL above.',
          priority: 1, confidence_score: 0.9, file: 'src/client.ts', line: 3, rule: 'secret-in-code', quote: "token: 'tok_test_0000',",
        }],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'A credential is hard-coded.',
        overall_confidence_score: 0.88,
      } },
      { reviews: 'B', sent: [], answer: clean('Only a timeout changed in this commit.') },
    ],
    outcomes: [{ rule: 'secret-in-code', site: ['src/client.ts', 3], ended: 'left', by: 'B' }],
  },
  {
    id: 'price-total',
    base: { 'src/price.ts': [
      'export function total(items: Item[]): number {',
      '  let sum = 0;',
      '  for (const it of items) sum += it.price;',
      '  return sum;',
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/price.ts': [
        'export function total(items: Item[]): number {',
        '  let sum = 0;',
        '  for (let i = 0; i <= items.length; i++) sum += items[i].price;',
        "  const extra = JSON.parse(localStorage.getItem('extra'));",
        '  return sum + extra;',
        '}',
      ] } },
      { label: 'B', files: { 'src/price.ts': [
        'export function total(items: Item[]): number {',
        '  let sum = 0;',
        '  for (let i = 0; i < items.length; i++) sum += items[i].price;',
        "  const extra = JSON.parse(localStorage.getItem('extra'));",
        '  return sum + extra;',
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [
        { rule: 'unchecked-parse', sites: [['src/price.ts', 4, "JSON.parse(localStorage.getItem('extra'))"]] },
        { rule: 'off-by-one', sites: [['src/price.ts', 3, 'i <= items.length']] },
      ], answer: {
        findings: [
          {
            title: '[P1] Reads past the end of items',
            body: '`items[items.length]` is undefined, so `.price` throws on every call.',
            priority: 1, confidence_score: 0.9, file: 'src/price.ts', line: 3, rule: 'off-by-one', quote: 'i <= items.length',
          },
          {
            title: '[P2] Unvalidated parse of stored value',
            body: 'A missing key yields `JSON.parse(null)`; a corrupted value throws.',
            priority: 2, confidence_score: 0.66, file: 'src/price.ts', line: 4, rule: 'unchecked-parse', quote: "JSON.parse(localStorage.getItem('extra'))",
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The loop bound is wrong and the stored extra is parsed without checks.',
        overall_confidence_score: 0.8,
      } },
      { reviews: 'B', sent: [], answer: {
        findings: [{
          title: '[P2] Unvalidated parse of stored value',
          body: 'Still parses the stored value without a guard.',
          priority: 2, confidence_score: 0.63, file: 'src/price.ts', line: 4, rule: 'unchecked-parse', quote: "JSON.parse(localStorage.getItem('extra'))",
        }],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The bound is fixed; the parse is not.',
        overall_confidence_score: 0.7,
      } },
    ],
    outcomes: [
      { rule: 'unchecked-parse', site: ['src/price.ts', 4], ended: 'left', by: 'B' },
      { rule: 'off-by-one', site: ['src/price.ts', 3], ended: 'fixed', by: 'B' },
    ],
  },
  {
    id: 'upload-save',
    base: { 'src/upload.ts': [
      'export function save(file: File) {',
      '  return disk.write(file.name, file.data);',
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/upload.ts': [
        'export async function save(file: File) {',
        '  disk.write(file.name, file.data);',
        '  return { saved: true };',
        '}',
      ] } },
      { label: 'B', files: { 'src/upload.ts': [
        'export async function save(file: File) {',
        '  try {',
        '    await disk.write(file.name, file.data);',
        '  } catch {}',
        '  return { saved: true };',
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'missing-await', sites: [['src/upload.ts', 2, 'disk.write(file.name, file.data);']] }], answer: {
        findings: [{
          title: '[P1] Write is not awaited',
          body: '`save` reports success before the write finishes, and a failed write is lost.',
          priority: 1, confidence_score: 0.83, file: 'src/upload.ts', line: 2, rule: 'missing-await', quote: 'disk.write(file.name, file.data);',
        }],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'Success is returned before the write completes.',
        overall_confidence_score: 0.8,
      } },
      { reviews: 'B', sent: [{ rule: 'swallowed-error', sites: [['src/upload.ts', 4, '} catch {}']] }], answer: {
        findings: [{
          title: '[P1] Write failure is swallowed',
          body: 'The new empty catch hides the failure the await now surfaces; `save` still reports success.',
          priority: 1, confidence_score: 0.85, file: 'src/upload.ts', line: 4, rule: 'swallowed-error', quote: '} catch {}',
        }],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The previous missing await is fixed, but the error is now discarded.',
        overall_confidence_score: 0.82,
      } },
    ],
    outcomes: [
      { rule: 'missing-await', site: ['src/upload.ts', 2], ended: 'fixed', by: 'B' },
      { rule: 'swallowed-error', site: ['src/upload.ts', 4], ended: 'left', by: 'B' },
    ],
  },
  {
    id: 'csv-rows',
    base: { 'src/csv.ts': [
      'export function rows(text: string): string[][] {',
      "  return text.split('\\n').map((l) => l.split(','));",
      '}',
    ] },
    commits: [
      { label: 'A', files: { 'src/csv.ts': [
        'export function rows(text: string): string[][] {',
        "  const lines = text.split('\\n');",
        '  const out: string[][] = [];',
        "  for (let i = 1; i <= lines.length; i++) out.push(lines[i].split(','));",
        '  return out;',
        '}',
      ] } },
      { label: 'B', files: { 'src/csv.ts': [
        'export function rows(text: string): string[][] {',
        "  const lines = text.split('\\n');",
        '  const out: string[][] = [];',
        "  for (let i = 1; i < lines.length; i++) out.push(lines[i].split(','));",
        '  return out;',
        '}',
      ] } },
    ],
    rounds: [
      { reviews: 'A', sent: [{ rule: 'off-by-one', sites: [['src/csv.ts', 4, 'i <= lines.length']] }], answer: {
        findings: [
          {
            title: '[P1] Loop reads one line past the end',
            body: '`lines[lines.length]` is undefined and `.split` throws.',
            priority: 1, confidence_score: 0.79, file: 'src/csv.ts', line: 5, rule: 'off-by-one', quote: 'i <= lines.length',
          },
          {
            title: '[P1] Loop reads one line past the end',
            body: 'Same issue, cited at the loop header.',
            priority: 1, confidence_score: 0.79, file: 'src/csv.ts', line: 4, rule: 'off-by-one', quote: 'i <= lines.length',
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The new loop overruns the array.',
        overall_confidence_score: 0.77,
      } },
      { reviews: 'B', sent: [], answer: clean('The bound is fixed.') },
    ],
    outcomes: [{ rule: 'off-by-one', site: ['src/csv.ts', 4], ended: 'fixed', by: 'B' }],
  },
  {
    id: 'format-money',
    base: { 'src/format.ts': ['export const money = (cents: number) => `$${cents / 100}`;'] },
    commits: [
      { label: 'A', files: { 'src/format.ts': ['export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;'] } },
      { label: 'B', files: { 'src/format.ts': ["export const money = (cents: number, sign = '$') => `${sign}${(cents / 100).toFixed(2)}`;"] } },
    ],
    rounds: [
      { reviews: 'A', sent: [], answer: {
        findings: [{
          title: '[P3] Floating point formatting',
          body: 'toFixed rounds half-even on some engines; consider integer math.',
          priority: 3, confidence_score: 0.3, file: 'src/format.ts', rule: 'off-by-one', quote: '(cents / 100).toFixed(2)',
        }],
        overall_correctness: 'patch is correct',
        overall_explanation: 'Formatting change only.',
        overall_confidence_score: 0.6,
      } },
      { reviews: 'B', sent: [], answer: clean('Adds a currency sign parameter; nothing to flag.') },
    ],
    outcomes: [],
  },
];
