import { expect } from 'vitest';
import { CHECK, cut, hostAdd, HostSession, openWorld, PROMPT, q, shown, type Ev, type World } from '../999/helpers.ts';
import { BASE_TEST, ownOrUnread, TEST } from './cases.ts';

export interface Scene { w: World; s: HostSession; task: string; repo: string; cwd: string; folder: string }

export interface Judged { id: string; outcome: string | null; reasons: string[]; runs: { check: string; outcome: string | null }[] }

export const runStartLine = (folder: string): string => `printf '%s %s\\n' "\${DEEP_RUN_TOKEN:-none}" "$(tail -n 1 /proc/self/cgroup)" >> ${q(`${folder}/price.starts`)}`;

export const checkScript = (folder: string, body: string): string => `${runStartLine(folder)}\n${body}\n`;

export const standardFiles = (body: string) => ({ folder }: { repo: string; folder: string }): Record<string, string> => ({ [CHECK]: checkScript(folder, body), [TEST]: BASE_TEST });

export async function openScene(o: {
  files: (at: { repo: string; folder: string }) => Record<string, string>;
  beforeCommit?: string;
  sub?: string;
  tools?: string[];
}): Promise<Scene> {
  const w = await openWorld();
  for (const tool of o.tools ?? []) {
    const has = await w.host.sh(`command -v ${q(tool)}`);
    if (has.code !== 0) throw Error(`BLOCKED: the test host has no ${tool}, which this scene's check runs; install it on the VM`);
  }
  const repo = await w.host.repo();
  const folder = w.host.folder;
  for (const [path, text] of Object.entries(o.files({ repo, folder }))) await w.host.write(`${repo}/${path}`, text);
  await w.host.must(`cd ${q(repo)} && ${o.beforeCommit ?? ':'} && git add -A && git -c user.name=T -c user.email=t@example.test -c commit.gpgsign=false commit -q -m 'the check runs its test'`);
  const cwd = o.sub ? `${repo}/${o.sub}` : repo;
  if (o.sub) w.host.repo = async () => cwd;
  await hostAdd(w);
  const s = await HostSession.open(w);
  await s.start();
  await s.typed(PROMPT);
  const taskOf = (events: readonly Ev[]): string | undefined => events.find((e) => e.kind === 'user.ask' && e.session === s.id)?.data.tasks?.[0] as string | undefined;
  const locked = await w.log.until((events) => { const t = taskOf(events); return t !== undefined && events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === t); }, 300_000);
  if (!locked) throw Error(`the prompt typed on ${w.alias} opens no task whose handed definition locks: ${cut(JSON.stringify(w.log.events.filter((e) => /^(user\.ask|task\.|definition\.)/.test(e.kind)).map((e) => [e.kind, e.data])))}`);
  return { w, s, task: taskOf(w.log.events)!, repo, cwd, folder };
}

export async function agentRuns(sc: Scene, command: string): Promise<void> {
  const c = await sc.s.bash(command);
  if (!c.after) throw Error(`BLOCKED: the session's Bash call \`${cut(command, 300)}\` on ${sc.w.alias} was not let through: ${sc.w.redact(shown(c.before))}`);
}

export async function requireCheckExitsZero(sc: Scene): Promise<void> {
  const r = await sc.w.host.sh(`cd ${q(sc.cwd)} && sh ${q(CHECK)}`);
  if (r.code !== 0) throw Error(`BLOCKED: as the scene left the session's folder on ${sc.w.alias}, ${CHECK} does not exit 0 there, so its claim would prove nothing: ${sc.w.redact(shown(r))}`);
}

export async function requireHiddenFromPlainGit(sc: Scene, path: string): Promise<void> {
  const r = await sc.w.host.sh(`cd ${q(sc.cwd)} && git diff --name-only HEAD && git ls-files --others --exclude-standard`);
  const listed = r.stdout.split('\n').filter(Boolean);
  if (r.code === 0 && listed.includes(path)) throw Error(`BLOCKED: the scene meant to hide ${JSON.stringify(path)} from a plain read on ${sc.w.alias}, but plain git lists it: ${JSON.stringify(listed)}`);
}

export async function removeSessionTranscripts(sc: Scene): Promise<void> {
  await sc.w.host.sh(`rm -rf ${q(`${sc.w.host.home}/.claude/projects/${sc.cwd.replace(/[^A-Za-z0-9]/g, '-')}`)}`);
}

export async function stopAndJudge(sc: Scene): Promise<Judged> {
  const { w } = sc;
  const from = w.log.events.length;
  await sc.s.stop();
  const madeOf = (events: readonly Ev[]): Ev | undefined => events.slice(from).find((e) => e.kind === 'claim.made' && e.data.task_ref === sc.task);
  if (!await w.log.until((events) => madeOf(events) !== undefined, 300_000)) {
    throw Error(`the session's stop on ${w.alias} made no claim on ${sc.task}: the record since holds ${[...new Set(w.log.events.slice(from).map((e) => e.kind))].join(', ') || 'nothing'}`);
  }
  const id = `claim:${madeOf(w.log.events)!.id}`;
  const verdicts = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'verdict.made' && (e.subject === id || e.data.claim === id));
  const runs = (events: readonly Ev[]): { check: string; ended: Ev | undefined }[] => events.filter((e) => e.kind === 'run.started' && e.data.claim === id)
    .map((e) => ({ check: String(e.data.check), ended: events.find((x) => x.kind === 'run.finished' && x.data.run === e.data.run) }));
  const settled = (events: readonly Ev[]): boolean => {
    const v = verdicts(events).at(-1);
    if (!v || v.data.outcome === 'pending') return false;
    const r = runs(events);
    return r.every((x) => x.ended !== undefined && x.ended.log_pos < v.log_pos) && (v.data.outcome !== 'PASS' || r.some((x) => x.check === CHECK));
  };
  await w.log.until(settled, 900_000);
  const last = verdicts(w.log.events).at(-1);
  const reasons = last && Array.isArray(last.data.reasons) ? (last.data.reasons as unknown[]).map((r) => (typeof r === 'string' ? r : JSON.stringify(r))) : [];
  return { id, outcome: last ? String(last.data.outcome) : null, reasons, runs: runs(w.log.events).map((r) => ({ check: r.check, outcome: r.ended ? String(r.ended.data.outcome) : null })) };
}

export const shownJudged = (sc: Scene, j: Judged): string => sc.w.redact(`${j.id}: outcome ${j.outcome}; reasons ${cut(JSON.stringify(j.reasons), 900)}; runs ${j.runs.map((r) => `${r.check} ${r.outcome ?? 'running'}`).join(', ') || 'none'}`);

export function expectNotPass(sc: Scene, j: Judged, what: string): void {
  expect(j.outcome, `${what}: the claim gets a verdict: ${shownJudged(sc, j)}`).not.toBeNull();
  expect(j.outcome, `${what}: the claim must not read PASS: ${shownJudged(sc, j)}`).not.toBe('PASS');
}

export function expectNamesOwnOrUnread(sc: Scene, j: Judged, what: string): void {
  expect(ownOrUnread(j.reasons, CHECK), `${what}: a reason names ${CHECK} as the agent's own, or the read the gate couldn't make: ${shownJudged(sc, j)}`).toBeDefined();
}
