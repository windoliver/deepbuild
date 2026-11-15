// Teardown tasks (#342): an outside resource a session creates, such as a cloud instance or a phone number, costs money
// until someone takes it down, and nothing on this machine can reach it. The repo's spec says what creates one:
// `resources` in done.yaml names, for each kind, the command that creates it, how its output names it, what it costs
// and the check that proves it gone. The core reads a session's own calls against that, never the agent's word, and
// raises one task per resource; only its check closes it (the core's "I did it" runs it, and so does a default).
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { isRecord as isObj, canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import { parse as parseYaml } from 'yaml';

type Obj = Record<string, unknown>;
type Rows = (query: string, params?: readonly (string | number | bigint | null)[]) => Promise<unknown[]>;
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');

/** One kind of `resources` in done.yaml: `created_by` matches a command, group 1 of `key` names what its output made. */
interface ResourceKind { name: string; created_by: string; key: string; cost: number; check: string }
/** A resource the record holds: `key` undefined when its command's output named none. */
interface Resource { resource: string; session: string; agent: string; cwd: string; kind: string; key?: string; check: string }
export interface Ran { session: string; agent: string; cwd: string; call: string; command: string; stdout: string }

/** How long a repo's pattern may run: it runs on the core's thread, against what an agent's command printed. */
const MATCH_MS = 50;
/** Every match of a repo's pattern, each its first group or its whole match; a pattern that overruns or won't compile matches nothing. */
function matches(pattern: string, text: string): string[] {
  try {
    return runInNewContext('[...text.matchAll(new RegExp(pattern, "g"))].map((m) => m[1] ?? m[0])', { pattern, text }, { timeout: MATCH_MS }) as string[];
  } catch { return []; }
}
const compiles = (pattern: unknown): pattern is string => {
  if (typeof pattern !== 'string') return false;
  try { new RegExp(pattern); return true; } catch { return false; }
};

/** The spec's `resources`, read as its checks are: the kinds that hold together, and what's wrong with the rest. */
export function resourceKinds(spec: unknown): { kinds: ResourceKind[]; wrong: string[] } {
  const given = isObj(spec) && isObj(spec.resources) ? spec.resources : {};
  const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
  const kinds: ResourceKind[] = [];
  const wrong: string[] = [];
  for (const [name, k] of Object.entries(given)) {
    if (isObj(k) && compiles(k.created_by) && compiles(k.key) && typeof k.cost === 'number' && k.cost >= 0 && typeof k.check === 'string' && isObj(checks[k.check])) {
      kinds.push({ name, created_by: k.created_by, key: k.key, cost: k.cost, check: k.check });
    } else wrong.push(name);
  }
  return { kinds, wrong };
}

interface TeardownsOptions {
  raw: Rows;
  /** The values the hub scrubs by: a key that holds one is never recorded. */
  held: readonly string[];
  /** An event about a session, appended as the core. */
  append(session: string, agent: string, kind: string, data: Obj): Promise<void>;
  reading(session: string, agent: string, text: string): Promise<void>;
  raise(session: string, agent: string, ask: Obj): Promise<void>;
}

export class Teardowns {
  /** Each folder's kinds, kept while its done.yaml stays as it was: a session's every shell call reads them. */
  private readonly specs = new Map<string, { mark: string; kinds: ResourceKind[] }>();
  private read = 0;
  constructor(private readonly o: TeardownsOptions) {}

  private async kindsIn(ran: Ran): Promise<ResourceKind[]> {
    const file = join(ran.cwd, '.deepbuild', 'done.yaml');
    let mark: string;
    try { const s = statSync(file); mark = `${s.size}:${s.mtimeMs}`; } catch { return []; }
    const kept = this.specs.get(ran.cwd);
    if (kept?.mark === mark) return kept.kinds;
    let found: ReturnType<typeof resourceKinds>;
    try { found = resourceKinds(parseYaml(readFileSync(file, 'utf8'))); } catch { found = { kinds: [], wrong: [] }; }
    this.specs.set(ran.cwd, { mark, kinds: found.kinds });
    if (found.wrong.length) await this.o.reading(ran.session, ran.agent, `done.yaml's resources ${found.wrong.join(', ')} can't be read, so what they create gets no teardown task: each needs created_by, key, cost and a check its checks name`);
    return found.kinds;
  }

  /** A session's shell call that ran: each resource it created gets its record and its task. */
  async saw(ran: Ran): Promise<void> {
    for (const kind of await this.kindsIn(ran)) {
      if (!matches(kind.created_by, ran.command).length) continue;
      const keys = matches(kind.key, ran.stdout).map((key) => scrubText(key, { held: [...this.o.held] }));
      // A command that made one and named none still gets its task; only its check can say it's gone.
      for (const key of keys.length ? keys : [undefined]) await this.created(ran, kind, key);
    }
  }

  private async created(ran: Ran, kind: ResourceKind, key: string | undefined): Promise<void> {
    const resource = sha256Hex(canonicalize({ kind: kind.name, key: key ?? ran.call } as JsonValue));
    const [known] = await this.o.raw(`SELECT 1 FROM events WHERE kind = 'resource.created' AND json_extract(data, '$.resource') = ? LIMIT 1`, [resource]);
    if (known) return;
    await this.o.append(ran.session, ran.agent, 'resource.created', { resource, kind: kind.name, ...(key === undefined ? {} : { key }), cost_usd: kind.cost, check: kind.check, cwd: ran.cwd });
    const named = key ?? `the one \`${ran.command.slice(0, 200)}\` made`;
    await this.o.raise(ran.session, ran.agent, {
      kind: 'unblock', question: `Take down ${kind.name} ${named}: a session created it, and it costs $${kind.cost} until it's gone.`,
      options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', steps: [`Remove ${named} at its provider`], where: 'at its provider',
      why: 'Nothing here can reach it, and its check closes this task once it\'s gone', unblocks: [`session:${letters(ran.session)}`], proves: kind.check, cost_usd: kind.cost,
      fallback: 'you', provisional: false, owner: 'you', key: resource, pinned_to: { kind: 'evidence', ref: resource },
    });
  }

  /** The resource a task is pinned to, or nothing for any other task. */
  async of(ask: Obj): Promise<Resource | undefined> {
    const pin = ask.pinned_to;
    if (!isObj(pin) || pin.kind !== 'evidence' || typeof pin.ref !== 'string') return undefined;
    const [row] = await this.o.raw(`SELECT session_id, agent, data FROM events WHERE kind = 'resource.created' AND json_extract(data, '$.resource') = ? LIMIT 1`, [pin.ref]) as { session_id: string; agent: string; data: string }[];
    if (!row) return undefined;
    const d = JSON.parse(row.data) as { resource: string; kind: string; key?: string; check: string; cwd: string };
    return { resource: d.resource, session: row.session_id, agent: row.agent, cwd: d.cwd, kind: d.kind, check: d.check, ...(d.key === undefined ? {} : { key: d.key }) };
  }

  /** The tasks that took their default since the last call: a default closes nothing, so each one's check runs. */
  async defaulted(): Promise<{ handle: string; data: Obj; resource: Resource }[]> {
    const rows = await this.o.raw(`SELECT d.log_pos, d.subject, a.data FROM events d JOIN events a ON a.id = substr(d.subject, 5) AND a.kind = 'ask.created' WHERE d.kind = 'ask.defaulted' AND d.log_pos > ? ORDER BY d.log_pos`, [this.read]) as { log_pos: number; subject: string; data: string }[];
    const out: { handle: string; data: Obj; resource: Resource }[] = [];
    for (const row of rows) {
      this.read = Number(row.log_pos);
      const data = JSON.parse(row.data) as Obj;
      const resource = data.kind === 'unblock' ? await this.of(data) : undefined;
      if (resource) out.push({ handle: row.subject, data, resource });
    }
    return out;
  }
}
