// @deepbuild/reading (#63): reading by reference. When DeepBuild needs free text read (your history at install, a
// trial's replays, a premise review, a change summary), it never pastes the record into a prompt: your own agent,
// headless through the runner, gets handles and reads them a slice at a time through its reading tools, handing them
// to sub-agents on a smaller model, and answers only with findings that cite a handle and the exact quote. Before
// anything is written, each quote is checked at its handle and each handle against what that job was delivered; a
// finding that fails either is dropped and logged. The install writes what is kept to the wiki.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '@deepbuild/contracts';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import type { Agent, JobRecord, Runner } from '@deepbuild/runner';
import { knownOf, type Candidate, type Known, type Wiki } from '@deepbuild/wiki';
import { claimId } from './claims.js';
import { usedBetween, type WindowReading } from './plan.js';
import { CAP, NotFound, openSlicer, type Found, type Slice, type Slicer } from './slices.js';

export { CAP, NotFound, openSlicer };
export type { Found, Slice, Slicer };

export type ReadingKind = 'install' | 'replay' | 'premise' | 'summary';
export interface ReadingOptions {
  record: RecordStore;
  /** Every job of it starts here, of kind `read`. */
  runner: Runner;
  /** The hub's root, which the job's reading tools read. */
  root: string;
  /** Where an install writes what it learned. */
  wiki: Wiki;
  now: () => number;
}
export interface ReadingSpec {
  kind: ReadingKind;
  /** What it is delivered; an install's default is every session a transcript.archived event links. */
  handles?: string[];
  /** What to find; an install has its own. */
  question?: string;
  agent?: Agent;
}
/** A citation kept: its handle, its quote, how its source knew it and, for a transcript, its message's role. */
export interface Cited { at: string; quote: string; known: Known; role?: string }
export interface Finding { text: string; cites: Cited[] }
export interface ReadingResult {
  /** `reading:<ULID>`. */
  reading: string;
  /** Every runner job it started. */
  runs: string[];
  /** Kept: every quote at its handle, every handle delivered in this job. */
  findings: Finding[];
  /** Each refused citation; the reason names the handle. */
  dropped: { at: string; quote: string; reason: string }[];
  /** Findings dropped for citing no handle delivered in this job. */
  undelivered: number;
  /** The plan usage it took, as a share of the 5-hour window, or 'not captured' when no window reading spans it. */
  plan: { five_hour_pct: number } | 'not captured';
  /** The model of its final answer (or premise review) and of each sub-read. */
  models: { final: string; subreads: string[] };
  /** The wiki claims it wrote. */
  written: string[];
}
export interface Reading { run(spec: ReadingSpec): Promise<ReadingResult> }

/** The reading jobs write as the core. */
const CORE: Connection = { writer: 'core', actor: 'deepbuild', scope: 'you' };
/** Where a model can be chosen: the strongest for the final answer and premise reviews, a smaller one for sub-reads. */
const STRONGEST = 'opus';
const SMALLER = 'haiku';
const DEADLINE = 30 * 60_000;
/** How long a job's end waits for a window reading made after it, to show its plan usage. */
const READING_WAIT = 3000;
const SESSION = /^session:([0-9A-Za-z]+)$/;
const MESSAGE = /^(session:[0-9A-Za-z]+)#[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** The tools server, built beside this file's compiled form. */
const TOOLS = fileURLToPath(new URL('../dist/tools.mjs', import.meta.url));
/** Where the node that runs the job's tools reads itself from: its binary's folder, and the folders of the libraries
 *  it loaded besides the system's and its addons, which a Homebrew node links from its own prefix. */
let reads: string[] | undefined;
const nodeReads = (): string[] => {
  // Read once: a report takes milliseconds on the hub's loop, and the libraries node loaded at its start don't change.
  if (reads) return reads;
  const loaded = (process.report.getReport() as { sharedObjects?: string[] }).sharedObjects ?? [];
  return (reads = [...new Set([process.execPath, ...loaded].filter((p) => !/^\/(usr\/lib|System)\/|\.node$/.test(p)).map((p) => dirname(realpathSync(p))))]);
};
const INSTALL = 'What should DeepBuild remember about each project from these sessions: how it starts, builds and is set up, and what you said to remember? Quote what to remember.';

/** Text as quotes are compared: NFC, each whitespace run one space (design: Reading by reference). */
const norm = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ');
type Obj = { [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sqlText = (text: string): string => `'${text.replace(/'/g, "''")}'`;

function prompt(kind: ReadingKind, question: string, handles: readonly string[]): string {
  return [
    `DeepBuild reading job (${kind}): ${question}`,
    '',
    'Read the record only by reference, through your reading tools: `read` returns one slice of what a handle names, at most 8,192 characters (call it again with `slice` set to a reply\'s `next` for more), and `find` searches the sessions below. Hand the handles to the `reader` sub-agent, a few at a time and in parallel, so long material stays inside those sub-reads. Never copy a slice back whole: quote only the exact words a finding rests on.',
    '',
    'Answer with JSON only, as reading.answer@1: {"findings":[{"text":"the finding","cites":[{"at":"the message handle it rests on","quote":"the exact words at that handle"}]}]}. A finding whose quote is not at its handle, or that cites a handle you were not given, is dropped.',
    '',
    'Handles:',
    ...handles,
    '',
  ].join('\n');
}
const READER = {
  description: 'Reads a few handles of DeepBuild\'s record through the reading tools and returns what to remember, quoted.',
  prompt: 'You read the handles you are given through the reading tools, a slice at a time, and answer with JSON only: {"findings":[{"text":"...","cites":[{"at":"<message handle>","quote":"<exact words>"}]}]}. Quote only words that are at the handle you cite.',
  model: SMALLER,
};

/** The models a run answered on, from its stream-json: its main session's last, and its sub-agents'. */
function modelsOf(stdout: string): { final: string; subreads: string[] } {
  let final = 'unknown';
  const subs = new Set<string>();
  for (const line of stdout.split('\n')) {
    let e: unknown;
    try { e = JSON.parse(line); } catch { continue; }
    if (!isObj(e) || e.type !== 'assistant' || !isObj(e.message) || typeof e.message.model !== 'string' || e.message.model === '<synthetic>') continue;
    if (e.parent_tool_use_id) subs.add(e.message.model);
    else final = e.message.model;
  }
  return { final, subreads: [...subs] };
}
/** The run's final answer, as reading.answer@1, or why it is none. */
function answerOf(stdout: string): { findings: { text: string; cites: { at: string; quote: string }[] }[] } | string {
  let text: string | undefined;
  for (const line of stdout.split('\n')) {
    try { const e = JSON.parse(line) as unknown; if (isObj(e) && e.type === 'result' && typeof e.result === 'string') text = e.result; } catch { /* not a line of JSON */ }
  }
  if (text === undefined) return 'the job gave no final answer';
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let value: unknown;
  try { value = JSON.parse(json); } catch { return 'the answer is not JSON'; }
  // Only its findings are read: anything else the agent added beside them carries nothing.
  const answer = isObj(value) ? { findings: value.findings } : value;
  const held = validate('reading.answer@1', answer);
  if (held.ok) return answer as { findings: { text: string; cites: { at: string; quote: string }[] }[] };
  // The first issues and how many there were: the reason fits reading.finished's 8,192 characters however many there are.
  const shown = held.issues.slice(0, 10).map((i) => `${i.code} at ${(i.path || '/').slice(0, 200)}`).join(', ');
  return `the answer is not reading.answer@1: ${shown}${held.issues.length > 10 ? `, and ${held.issues.length - 10} more` : ''}`;
}

/** The job's reading tools' socket: `read` and `find` over the handles it was delivered, and nothing else. */
async function serve(slicer: Slicer, delivered: (handle: string) => boolean, sessions: readonly string[]): Promise<{ socket: string; close(): void }> {
  const dir = realpathSync(mkdtempSync('/tmp/deep-reading-'));
  const socket = join(dir, 's');
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      const reply = (status: number, text: string) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(text); };
      void (async () => {
        let call: unknown;
        try { call = JSON.parse(body); } catch { return reply(400, 'a call is JSON'); }
        const args = isObj(call) && isObj(call.arguments) ? call.arguments : {};
        const slice = typeof args.slice === 'string' ? args.slice : undefined;
        try {
          if (isObj(call) && call.name === 'read' && typeof args.handle === 'string') {
            if (!delivered(args.handle)) return reply(403, `${args.handle} wasn't delivered to this reading job`);
            return reply(200, JSON.stringify(await slicer.read(args.handle, slice)));
          }
          if (isObj(call) && call.name === 'find' && typeof args.query === 'string') return reply(200, JSON.stringify(await slicer.find(args.query, slice, sessions)));
          return reply(400, 'the reading tools are read {handle, slice?} and find {query, slice?}');
        } catch (error) {
          return reply(error instanceof NotFound ? 404 : 500, error instanceof Error ? error.message : String(error));
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  return { socket, close: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

export async function openReading(o: ReadingOptions): Promise<Reading> {
  const { record, runner, now } = o;
  const append = async (kind: string, data: Obj): Promise<void> => {
    const ts = now();
    await record.append(CORE, { v: 1, id: ulid(ts), kind, ts, data: data as never });
  };
  /** The plan usage a job took: the 5-hour window's use from its start to the first reading after its end. */
  async function planOf(rec: JobRecord, from: WindowReading | undefined, ended: number): Promise<ReadingResult['plan']> {
    const { account } = rec;
    if (!account || !from) return 'not captured';
    const latest = () => runner.planWindows().get(account);
    for (const until = Date.now() + READING_WAIT; Date.now() < until && (latest()?.at ?? 0) <= ended;) await new Promise((r) => setTimeout(r, 50));
    const to = latest();
    if (!to || to.at <= ended) return 'not captured';
    const used = usedBetween(from, to);
    return used === 'not captured' ? used : { five_hour_pct: used };
  }

  /** Writes an install's findings as wiki claims; returns the claims written and each finding the wiki refused, with why. */
  async function install(findings: Finding[]): Promise<{ written: string[]; refused: Map<Finding, string> }> {
    // Each finding goes to its repo's page, at the scope its sessions cover; the same finding from many sessions is one claim.
    const projectOf = new Map<string, string | null>();
    for (const f of findings) for (const c of f.cites) {
      const id = /^session:([0-9A-Za-z]+)/.exec(c.at)?.[1];
      if (id && !projectOf.has(id)) projectOf.set(id, ((await record.raw(`SELECT project_id FROM sessions WHERE id = ${sqlText(id)}`)) as { project_id: string | null }[])[0]?.project_id ?? null);
    }
    const claims = new Map<string, { claim: Omit<Candidate, 'sources'>; findings: Finding[] }>();
    for (const f of findings) {
      const projects = new Set(f.cites.map((c) => projectOf.get(/^session:([0-9A-Za-z]+)/.exec(c.at)?.[1] ?? '') ?? null));
      const project = projects.size === 1 ? [...projects][0] : null;
      // Only a project id the learned layer's scope can name has its repo's page and scope.
      const page = project && /^[a-z0-9]+$/.test(project) ? `repos/${project}` : 'notes';
      const key = `${page}\n${norm(f.text).trim()}`;
      const same = claims.get(key);
      if (same) same.findings.push(f);
      else claims.set(key, { claim: { page, id: claimId(f.text), text: f.text, scope: project && /^[0-9A-Za-z]+$/.test(project) ? `repo:${project}` : 'all' }, findings: [f] });
    }
    // The wiki checks a claim's quotes again, by its own reading of them. The findings stating one claim are learned
    // in turn, each with its own quotes and those the claim already holds, so a refused one takes only itself.
    const written = new Set<string>();
    const refused = new Map<Finding, string>();
    const held = new Map<string, Candidate['sources']>();
    // A claim an earlier install wrote keeps its sources: a restatement adds to them, superseding it.
    for (const [key, { claim }] of claims) {
      const was = (await record.raw(`SELECT s.at, s.quote FROM wiki_sources s JOIN wiki_claims c ON c.handle = s.claim WHERE c.handle = ${sqlText(`wiki:${claim.page}#${claim.id}`)} AND c.state = 'in force' AND s.at IS NOT NULL ORDER BY s.n`)) as { at: string; quote: string }[];
      if (was.length) held.set(key, was.map((s) => ({ at: s.at, quote: s.quote })));
    }
    for (let turn = 0; ; turn++) {
      const batch: [string, Finding, Candidate][] = [];
      for (const [key, { claim, findings: same }] of claims) {
        const f = same[turn];
        if (!f) continue;
        const own = f.cites.map((c) => ({ at: c.at, quote: c.quote }));
        const kept = (held.get(key) ?? []).filter((s) => !own.some((c) => 'at' in s && c.at === s.at && c.quote === s.quote));
        // One claim keeps a few sources: enough to show it, short enough to read.
        const sources = [...own, ...kept].slice(0, Math.max(5, own.length));
        batch.push([key, f, { ...claim, sources, ...(held.has(key) ? { supersedes: `wiki:${claim.page}#${claim.id}` } : {}) }]);
      }
      if (!batch.length) break;
      const learned = await o.wiki.learn(batch.map(([, , c]) => c));
      const why = new Map(learned.dropped.map((d) => [d.claim, d.reason]));
      for (const [key, f, c] of batch) {
        const handle = `wiki:${c.page}#${c.id}`;
        if (why.has(handle)) refused.set(f, `the wiki refused ${handle}: ${why.get(handle)}`);
        else { written.add(handle); held.set(key, c.sources); }
      }
    }
    return { written: [...written], refused };
  }

  return {
    async run(spec) {
      const reading = `reading:${ulid(now())}`;
      // A reading that fails still ends on record: its job, if one started, what it dropped, and why.
      const at = { job: undefined as string | undefined, dropped: 0, finished: false };
      try {
        const slicer = await openSlicer(o.root);
        try {
          const handles = [...new Set(spec.handles ?? (spec.kind === 'install' ? await slicer.archived() : []))];
          const given = new Set(handles);
          const delivered = (h: string): boolean => given.has(h) || given.has(MESSAGE.exec(h)?.[1] ?? '');
          const tools = await serve(slicer, delivered, handles.filter((h) => SESSION.test(h)));
          let rec: JobRecord;
          let stdout: string;
          let plan: ReadingResult['plan'];
          try {
            // Before submit, which may launch the job: a reading taken after it could already hold the job's use.
            const before = runner.planWindows();
            const submitted = await runner.submit({
              kind: 'read', agent: spec.agent ?? 'claude-code', model: STRONGEST, deadline_ms: DEADLINE,
              prompt: prompt(spec.kind, spec.question ?? INSTALL, handles),
              // The tools make no TLS call; a node built on a shared OpenSSL would otherwise read its config outside the grant.
              mcp: { reading: { command: process.execPath, args: ['--openssl-config=/dev/null', TOOLS, tools.socket] } },
              subagents: { reader: READER },
              grant: { read: [...nodeReads(), dirname(TOOLS)], sockets: [tools.socket] },
            });
            at.job = submitted.job;
            const from = submitted.account ? before.get(submitted.account) : undefined;
            rec = await runner.wait(submitted.job);
            const ended = now();
            stdout = await runner.output(rec.job);
            plan = await planOf(rec, from, ended);
          } finally {
            tools.close();
          }
          const models = modelsOf(stdout);
          const answer = answerOf(stdout);
          let findings: Finding[] = [];
          const dropped: ReadingResult['dropped'] = [];
          let undelivered = 0;
          for (const f of typeof answer === 'string' ? [] : answer.findings) {
            // A finding that cites no handle delivered in this job is dropped and counted.
            if (!f.cites.length || f.cites.some((c) => !delivered(c.at))) {
              undelivered++;
              for (const c of f.cites) if (!delivered(c.at)) dropped.push({ at: c.at, quote: c.quote, reason: `${c.at} wasn't delivered to this reading job` });
              continue;
            }
            const cites: Cited[] = [];
            for (const c of f.cites) {
              const source = SESSION.test(c.at) ? undefined : await slicer.whole(c.at);
              const reason = SESSION.test(c.at) ? `${c.at} names a whole session; a quote from a transcript cites its message (${c.at}#<message>)`
                : !source ? `${c.at} names nothing the record can read`
                  : !norm(c.quote).trim() || !norm(source.text).includes(norm(c.quote)) ? `the quote "${c.quote.slice(0, 200)}" is not at ${c.at}` : undefined;
              if (reason || !source) dropped.push({ at: c.at, quote: c.quote, reason: reason ?? `${c.at} names nothing` });
              else cites.push({ at: c.at, quote: c.quote, known: knownOf(c.at, source), ...(source.role ? { role: source.role } : {}) });
            }
            if (cites.length === f.cites.length) findings.push({ text: f.text, cites });
          }
          const { written, refused } = spec.kind === 'install' ? await install(findings) : { written: [], refused: new Map<Finding, string>() };
          for (const [f, why] of refused) for (const c of f.cites) dropped.push({ at: c.at, quote: c.quote, reason: `${c.at}: ${why}` });
          findings = findings.filter((f) => !refused.has(f));
          for (const d of dropped) { await append('reading.dropped', { reading, ...d, reason: d.reason.slice(0, 8192) }); at.dropped++; }
          const result: ReadingResult = { reading, runs: [rec.job], findings, dropped, undelivered, plan, models, written };
          await append('reading.finished', {
            reading, kind: spec.kind, runs: result.runs, state: rec.state, findings: findings.length, dropped: dropped.length, undelivered,
            plan: plan === 'not captured' ? null : plan, models, written: written.length,
            ...(typeof answer === 'string' ? { invalid: answer } : {}),
          });
          at.finished = true;
          return result;
        } finally {
          slicer.close();
        }
      } catch (error) {
        if (!at.finished) {
          await append('reading.finished', {
            reading, kind: spec.kind, runs: at.job ? [at.job] : [], state: 'failed', findings: 0, dropped: at.dropped, undelivered: 0,
            plan: null, models: { final: 'unknown', subreads: [] }, written: 0,
            invalid: `the reading failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 8192),
          }).catch(() => undefined); // the error that failed it is the one to report
        }
        throw error;
      }
    },
  };
}

// ---- `deep read` and `deep find`: read-only over a hub's root, with or without the hub running.

/** A parsed command; `again` is the `--root` a continuation line repeats, when one was given. */
interface Parsed { what: string; cursor?: string; json: boolean; root: string; again?: string }
/** A word the shell reads back as it is: a handle or a cursor bare, anything else (a leading '#' starts a comment) in single quotes. */
const shell = (word: string): string => (/^[A-Za-z0-9:._\/-][A-Za-z0-9:#._\/-]*$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`);
/** The rest of a continuation line: its handle or query, the cursor, the root it read, and `--` before a word starting with '-'. */
const again = (p: Parsed, slice: string): string =>
  p.what.startsWith('-') ? `${slice}${p.again ?? ''} -- ${shell(p.what)}` : `${shell(p.what)} ${slice}${p.again ?? ''}`;
/** Parses `<what> [--slice [<cursor>]] [--json] [--root <folder>] [-- <what>]`, or says what's wrong. */
function parse(command: string, args: readonly string[]): Parsed | string {
  let what: string | undefined;
  let cursor: string | undefined;
  let json = false;
  let root = join(homedir(), '.deepbuild');
  let given = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') json = true;
    else if (a === '--root' && args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) { root = args[++i]!; given = true; }
    else if (a === '--slice') { if (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) cursor = args[++i]!; }
    else if (!a.startsWith('-') && what === undefined) what = a;
    // After `--`, the next word is the handle or query even when it starts with '-'.
    else if (a === '--' && args[i + 1] !== undefined && what === undefined) what = args[++i]!;
    else return `Usage: deep ${command} <${command === 'read' ? 'handle' : 'query'}> [--slice [<cursor>]] [--json] [--root <folder>] [-- <what>]`;
  }
  return what === undefined ? `Usage: deep ${command} <${command === 'read' ? 'handle' : 'query'}> [--slice [<cursor>]] [--json] [--root <folder>] [-- <what>]` : { what, ...(cursor !== undefined ? { cursor } : {}), json, root, ...(given ? { again: ` --root ${shell(root)}` } : {}) };
}

/** `deep read <handle> --slice [<cursor>]`: one slice; a cut one ends with the command that continues it. */
export async function readCommand(args: readonly string[]): Promise<number> {
  return command('read', args, async (slicer, p) => {
    const slice = await slicer.read(p.what, p.cursor);
    return p.json ? JSON.stringify(slice) : `${slice.text}${slice.next !== undefined ? `\ndeep read ${again(p, `--slice ${slice.next}`)}` : ''}`;
  });
}
/** `deep find <query>`: matching handles, a line of context each, capped as a slice is. */
export async function findCommand(args: readonly string[]): Promise<number> {
  return command('find', args, async (slicer, p) => {
    const found = await slicer.find(p.what, p.cursor);
    return p.json ? JSON.stringify(found) : [...found.hits.map((h) => `${h.handle}  ${h.context}`), ...(found.next !== undefined ? [`deep find ${again(p, `--slice ${found.next}`)}`] : [])].join('\n');
  });
}
async function command(name: string, args: readonly string[], body: (slicer: Slicer, p: Parsed) => Promise<string>): Promise<number> {
  const p = parse(name, args);
  if (typeof p === 'string') { console.error(p); return 2; }
  let slicer: Slicer;
  try { slicer = await openSlicer(p.root); } catch (error) {
    console.error(`deep ${name} ${p.what}: no record to read at ${p.root}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  try {
    process.stdout.write(`${await body(slicer, p)}\n`);
    return 0;
  } catch (error) {
    console.error(error instanceof NotFound ? `deep ${name}: ${error.message}` : `deep ${name} ${p.what}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    slicer.close();
  }
}
