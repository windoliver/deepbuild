// Where an outward step's targets came from (#1098; design: Plans before acting, Threats): each recipient, host,
// remote, repo, channel or payee a plan names is placed from the record, never from the agent's words. `you` when a
// prompt a person typed in the session names it, `decision` when a decision covering the ask names it in the plan it
// was saved from, `repo` when the session's worktree configures it as a git remote, `read` when only a tool's result
// in the session's transcript holds it (citing the first), and `unknown` otherwise. Targets compare normalized.
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export type TargetKind = 'address' | 'host' | 'remote' | 'repo' | 'channel' | 'payee';
/** Where a step that leaves the machine goes, as its plan names it. */
export interface Target { kind: TargetKind; ref: string }
export type TargetOrigin = 'you' | 'decision' | 'repo' | 'read' | 'unknown';
/** What the card says about one target of its plan, placed by the core from the record. */
export interface CardTarget {
  /** The plan step it is a target of, from 0. */
  step: number;
  kind: TargetKind;
  /** The target, normalized. */
  ref: string;
  origin: TargetOrigin;
  /** For `read`, the `session:` handle of the first tool result that holds it; for `decision`, the decision; else null. */
  first: string | null;
  /** For `read` or `unknown`, the words the card shows before it arms; null otherwise. */
  warning: string | null;
  /** For `read` or `unknown`, the decision that would have covered the step but doesn't because of it; null otherwise. */
  rule: string | null;
}
export const KINDS = new Set<TargetKind>(['address', 'host', 'remote', 'repo', 'channel', 'payee']);
/** The origins no decision covers: a step going there always asks you. */
export const UNCOVERED = new Set<TargetOrigin>(['read', 'unknown']);

const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`()\]\[{}]+/gi;
const isUrl = (ref: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(ref);
/** A remote URL without credentials, `.git` or a trailing slash, its scheme and host lowercased; undefined when it isn't one. */
function url(ref: string): string | undefined {
  try {
    const u = new URL(ref.replace(/[.,;:!?]+$/, ''));
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '').replace(/\.git$/, '')}`;
  } catch {
    return undefined;
  }
}
/** A target as targets compare: host, address, owner/repo, channel and payee lowercased; a remote URL as `url` reads it; a remote's name as typed. */
export function normalize(kind: TargetKind, ref: string): string {
  const r = ref.trim();
  if (kind === 'remote') return isUrl(r) ? url(r) ?? r : r;
  return kind === 'host' ? r.toLowerCase().replace(/\.$/, '') : r.toLowerCase();
}

/** Characters that continue an address, host or name, so a match inside a longer one isn't the target. */
const PART = /[a-z0-9_%+@-]/;
/** Whether `text`, lowercased, names the normalized target: a URL by its normalized form, anything else as a whole word. */
export function names(lower: string, kind: TargetKind, ref: string): boolean {
  if (kind === 'remote' && isUrl(ref)) {
    // Most texts name no URL with the target's host, so only those are parsed.
    if (!lower.includes(new URL(ref).host)) return false;
    for (const m of lower.matchAll(URL_RE)) if (url(m[0])?.toLowerCase() === ref.toLowerCase()) return true;
    return false;
  }
  const want = ref.toLowerCase();
  for (let at = lower.indexOf(want); at >= 0; at = lower.indexOf(want, at + 1)) {
    const before = lower[at - 1];
    const after = lower[at + want.length];
    const next = lower[at + want.length + 1];
    if (before !== undefined && (PART.test(before) || (before === '.' && kind !== 'channel'))) continue;
    if (after !== undefined && (PART.test(after) || (after === '.' && next !== undefined && /[a-z0-9]/.test(next)))) continue;
    return true;
  }
  return false;
}

/** The git config files of a worktree: its own and, for a linked worktree, the repository's common one. */
function configsOf(worktree: string): string[] {
  try {
    const dot = join(worktree, '.git');
    let gitdir = dot;
    if (statSync(dot).isFile()) {
      const to = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'))?.[1]?.trim();
      if (!to) return [];
      gitdir = isAbsolute(to) ? to : resolve(worktree, to);
    }
    let common = gitdir;
    try {
      common = resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim());
    } catch {
      // No commondir: the worktree's own folder is the repository's.
    }
    return [...new Set([join(common, 'config'), join(gitdir, 'config.worktree')])];
  } catch {
    return [];
  }
}
/** The remotes a worktree configures, by name, each URL normalized. */
export function remotesOf(worktree: string | undefined): Map<string, string> {
  const remotes = new Map<string, string>();
  if (!worktree) return remotes;
  for (const file of configsOf(worktree)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    let remote: string | undefined;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const section = /^\[\s*remote\s+"([^"]+)"\s*\]$/.exec(line);
      if (section) { remote = section[1]; continue; }
      if (line.startsWith('[')) { remote = undefined; continue; }
      const value = remote !== undefined ? /^url\s*=\s*(.+)$/.exec(line)?.[1]?.trim() : undefined;
      if (remote !== undefined && value !== undefined && !remotes.has(remote)) remotes.set(remote, normalize('remote', value));
    }
  }
  return remotes;
}
/** Whether the repo's own configuration names a target: a configured remote, by name or URL, or its host or owner/repo. */
function configured(remotes: Map<string, string>, kind: TargetKind, ref: string): boolean {
  const urls = [...remotes.values()].map((u) => url(u)).filter((u): u is string => u !== undefined);
  if (kind === 'remote') return remotes.has(ref) || urls.some((u) => u.toLowerCase() === ref.toLowerCase());
  if (kind === 'host') return urls.some((u) => new URL(u).hostname === ref);
  if (kind === 'repo') return urls.some((u) => new URL(u).pathname.replace(/^\/+/, '').toLowerCase() === ref);
  return false;
}

/** One message of a session's transcript, as the record resolves it. */
export interface Said { id: string; text: string; role?: string; tool?: string }
/** What the core places targets from, all read from the record for the ask's session. */
export interface Sources {
  session: string;
  /** The texts of prompts a person typed in the session (user.ask from person or the app). */
  prompts: string[];
  /** The session's archived transcript, in order; [] when none is archived. */
  transcript: Said[];
  /** The remotes the session's worktree configures. */
  remotes: Map<string, string>;
  /** The decisions covering the ask, each with the normalized targets of the plan it was saved from. */
  decisions: { handle: string; targets: Set<string> }[];
}
const NOUN: Record<TargetKind, string> = { address: 'address', host: 'host', remote: 'remote', repo: 'repo', channel: 'channel', payee: 'payee' };
const keyOf = (kind: TargetKind, ref: string): string => `${kind}\u0000${ref.toLowerCase()}`;

/** Every target of every step, placed from the record, in step order. */
export function place(steps: { targets?: Target[] }[], s: Sources, plant?: string): CardTarget[] {
  const prompts = s.prompts.map((p) => p.toLowerCase());
  // Text the session read: a tool's result. The agent's own turns and calls are its words, never evidence.
  const read = s.transcript.filter((m) => m.tool !== undefined && m.role !== 'assistant').map((m) => ({ id: m.id, lower: m.text.toLowerCase() }));
  const said = plant === 'origin-from-agent-message' ? s.transcript.filter((m) => m.role === 'assistant').map((m) => m.text.toLowerCase()) : [];
  const out: CardTarget[] = [];
  steps.forEach((step, n) => {
    const placed: CardTarget[] = [];
    for (const t of step.targets ?? []) {
      const ref = normalize(t.kind, t.ref);
      const rule = s.decisions[0]?.handle ?? null;
      const by = (origin: TargetOrigin, first: string | null = null): CardTarget => ({
        step: n, kind: t.kind, ref, origin, first,
        warning: origin === 'read' ? `this ${NOUN[t.kind]} appears in nothing you typed or approved; the agent first read it in ${first}`
          : origin === 'unknown' ? `this ${NOUN[t.kind]} appears in nothing you typed or approved, nor in anything the agent read` : null,
        rule: UNCOVERED.has(origin) ? rule : null,
      });
      if (plant === 'push-target-as-repo' && t.kind === 'remote') { placed.push(by('repo')); continue; }
      if (prompts.some((p) => names(p, t.kind, ref)) || said.some((p) => names(p, t.kind, ref))) { placed.push(by('you')); continue; }
      const decision = s.decisions.find((d) => d.targets.has(keyOf(t.kind, ref)));
      if (decision) { placed.push(by('decision', decision.handle)); continue; }
      if (configured(s.remotes, t.kind, ref)) { placed.push(by('repo')); continue; }
      const first = read.find((m) => names(m.lower, t.kind, ref));
      placed.push(first ? by('read', `session:${s.session}#${first.id}`) : by('unknown'));
    }
    if (plant === 'first-recipient-origin' && placed.length) for (const p of placed) Object.assign(p, { origin: placed[0]!.origin, first: placed[0]!.first, warning: placed[0]!.warning, rule: placed[0]!.rule });
    out.push(...placed);
  });
  return out;
}
/** The normalized targets of a plan's steps, as a decision saved from it names them. */
export const targetsOf = (steps: { targets?: Target[] }[]): Set<string> => new Set(steps.flatMap((st) => (st.targets ?? []).map((t) => keyOf(t.kind, normalize(t.kind, t.ref)))));
