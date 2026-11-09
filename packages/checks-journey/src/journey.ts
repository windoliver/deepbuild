// A journey file (#37): `.deepbuild/journeys/<id>.yaml` read as data, each step keeping the line its action or
// expect is written on, so a failure points at it; and its review: an end state whose oracle is code or a person is
// required, no credential is ever written into the file (a secret is referenced by name, its value comes from a
// lease), and no baseline image is ever named, since the only baseline is the base rendered here.
import { isMap, isSeq, LineCounter, parseDocument, type Node } from 'yaml';

export interface Locator { role?: string; name?: string; label?: string; testId?: string; within?: { role: string; name: string } }
/** The driver's locator: `within` as the container it looks inside. */
export interface DriverLocator { role?: string; name?: string; label?: string; testId?: string; exact?: boolean; container?: DriverLocator }
interface MotionReq { target: Locator; property: string; from: string; to: string; duration: number; delay: number; easing: string }
export interface Action { line: number | null; goto?: string; click?: DriverLocator; fill?: DriverLocator; text?: string; secret?: string; scrollIntoView?: DriverLocator; hover?: DriverLocator; press?: string; wait?: number }
export interface Expect { line: number | null; locator?: DriverLocator; text?: string; visible?: boolean; until?: { evaluate: string; equals: string } }
interface Request { line: number | null; method: string; path: string; body?: unknown; status: number }
/** `timeoutMs` bounds each expect and each wait on an element, kept under the step's deadline; a navigation is bounded by the deadline alone. */
interface Step { id: string; line: number | null; deadlineMs: number; timeoutMs: number; actions: Action[]; expects: Expect[]; motion: MotionReq[]; request?: Request; targets: Locator[] }
interface EndCheck { id: string; line: number | null; oracle: 'code' | 'model' | 'person'; locator?: Locator; driverLocator?: DriverLocator; text?: string; visible?: boolean; readback?: { method: string; path: string }; equals?: unknown; count?: Record<string, number>; requirement?: string }
interface ExpectedError { step: string; message?: string; url?: string; status?: number }
export interface Journey { id: string; feature: string | null; depth: 'journey' | 'live'; api: boolean; masks: Locator[]; steps: Step[]; endState: EndCheck[]; expectedErrors: ExpectedError[]; baseline: string | null }
type Review = { ok: true } | { ok: false; reasons: string[] };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The keys each map of a journey file may carry; any other is refused, never skipped, so nothing named goes unrun. */
const TOP_KEYS = ['journey', 'feature', 'depth', 'api', 'masks', 'steps', 'end_state', 'expected_errors', 'baseline'];
const STEP_KEYS = ['id', 'deadline', 'timeout', 'goto', 'click', 'fill', 'scroll_into_view', 'hover', 'press', 'wait', 'expect', 'motion', 'request', 'status'];
const END_KEYS = ['id', 'oracle', 'locator', 'text', 'visible', 'readback', 'equals', 'count', 'requirement'];
const LOCATOR_KEYS = ['role', 'name', 'label', 'testId', 'within'];
const MOTION_KEYS = ['target', 'property', 'from', 'to', 'duration', 'delay', 'easing'];
const only = (v: unknown, keys: readonly string[], where: string, what: string): void => {
  if (isObj(v)) for (const k of Object.keys(v)) if (!keys.includes(k)) throw Error(`${where}: ${k} is not ${what}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

export const toDriver = (l: Locator | undefined): DriverLocator | undefined => {
  if (!l) return undefined;
  const out: DriverLocator = {};
  if (l.role !== undefined) out.role = l.role;
  if (l.name !== undefined) out.name = l.name;
  if (l.label !== undefined) out.label = l.label;
  if (l.testId !== undefined) out.testId = l.testId;
  if (l.within) out.container = { role: l.within.role, name: l.within.name };
  return out;
};
/** A locator; when `where` names it, its keys are checked, with the `extra` keys of the map that holds it (`what`). */
const locatorOf = (v: unknown, where?: string, extra: readonly string[] = [], what = 'a locator key'): Locator | undefined => {
  if (!isObj(v)) return undefined;
  if (where !== undefined) { only(v, [...LOCATOR_KEYS, ...extra], where, what); only(v.within, ['role', 'name'], `${where} within`, 'a locator key'); }
  const l: Locator = {};
  for (const k of ['role', 'name', 'label', 'testId'] as const) { const s = str(v[k]); if (s !== undefined) l[k] = s; }
  const w = v.within;
  if (isObj(w) && str(w.role) !== undefined && str(w.name) !== undefined) l.within = { role: str(w.role)!, name: str(w.name)! };
  return Object.keys(l).length ? l : undefined;
};
/** The timeout a step asks for, or Playwright's own default of 5 s. */
const DEFAULT_TIMEOUT_MS = 5000;
/** The expect's own timeout, kept under the step's deadline: never more than four fifths of it. */
export const timeoutUnder = (deadlineMs: number, asked: number | undefined): number => Math.max(50, Math.min(asked ?? DEFAULT_TIMEOUT_MS, Math.floor(deadlineMs * 0.8)));

/** Reads a journey file; a malformed one throws naming what is wrong. Lines are 1-based, of the key each action or expect is written at. */
export function parseJourney(text: string): Journey {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  const lineAt = (node: Node | null | undefined): number | null => (node?.range ? lines.linePos(node.range[0]).line : null);
  const root = doc.contents;
  if (!isMap(root)) throw Error('a journey file is a map: journey, steps and end_state');
  const data = doc.toJS() as Record<string, unknown>;
  const id = str(data.journey);
  if (!id) throw Error('a journey names itself: journey: <id>');
  only(data, TOP_KEYS, `journey ${id}`, 'a journey key');
  const stepNodes = root.get('steps', true);
  const steps: Step[] = [];
  const rawSteps = Array.isArray(data.steps) ? data.steps : [];
  rawSteps.forEach((raw, i) => {
    if (!isObj(raw)) throw Error(`step ${i + 1} is a map`);
    const node = (isSeq(stepNodes) ? stepNodes.items[i] : undefined) as Node | undefined;
    const keyLine = (key: string): number | null => (isMap(node) ? lineAt(node.items.find((p) => String((p.key as { value?: unknown })?.value ?? p.key) === key)?.key as Node | undefined) ?? lineAt(node) : null);
    const sid = str(raw.id);
    if (!sid) throw Error(`step ${i + 1} has an id`);
    only(raw, STEP_KEYS, `step ${sid}`, 'a step key');
    const deadlineMs = Number(raw.deadline);
    if (!(deadlineMs > 0)) throw Error(`step ${sid} has a deadline in ms`);
    const timeoutMs = timeoutUnder(deadlineMs, typeof raw.timeout === 'number' ? raw.timeout : undefined);
    const actions: Action[] = [];
    const targets: Locator[] = [];
    if (str(raw.goto) !== undefined) actions.push({ line: keyLine('goto'), goto: str(raw.goto)! });
    for (const k of ['click', 'fill', 'scroll_into_view', 'hover'] as const) {
      const l = k === 'fill' ? locatorOf(raw[k], `step ${sid} fill`, ['text', 'secret'], 'a fill key') : locatorOf(raw[k], `step ${sid} ${k}`);
      if (!l) continue;
      targets.push(l);
      const d = toDriver(l)!;
      if (k === 'click') actions.push({ line: keyLine('click'), click: d });
      else if (k === 'scroll_into_view') actions.push({ line: keyLine('scroll_into_view'), scrollIntoView: d });
      else if (k === 'hover') actions.push({ line: keyLine('hover'), hover: d });
      else if (k === 'fill') {
        const f = raw.fill as Record<string, unknown>;
        actions.push({ line: keyLine('fill'), fill: d, ...(str(f.secret) !== undefined ? { secret: str(f.secret)! } : { text: str(f.text) ?? '' }) });
      }
    }
    if (str(raw.press) !== undefined) actions.push({ line: keyLine('press'), press: str(raw.press)! });
    if (typeof raw.wait === 'number') actions.push({ line: keyLine('wait'), wait: raw.wait });
    const expects: Expect[] = [];
    if (isObj(raw.expect)) {
      const e = raw.expect;
      if (e.until === true) expects.push({ line: (isMap(node) ? lineAt((node.get('expect', true) as { get?: (k: string, keep: true) => unknown } | undefined)?.get?.('until', true) as Node | undefined) : null) ?? keyLine('expect'), until: { evaluate: str(e.evaluate) ?? '', equals: str(e.equals) ?? '' } });
      else {
        const l = locatorOf(e, `step ${sid} expect`, ['text', 'visible', 'until', 'evaluate', 'equals'], 'an expect key');
        if (!l) throw Error(`step ${sid}: expect names what it looks for (a role and name, a label or a test ID), or is a toPass block (until: true)`);
        targets.push(l);
        expects.push({ line: keyLine('expect'), locator: toDriver(l)!, ...(str(e.text) !== undefined ? { text: str(e.text)! } : {}), ...(typeof e.visible === 'boolean' ? { visible: e.visible } : {}) });
      }
    }
    const motion: MotionReq[] = (Array.isArray(raw.motion) ? raw.motion : []).flatMap((m: unknown) => {
      if (!isObj(m)) return [];
      only(m, MOTION_KEYS, `step ${sid} motion`, 'a motion key');
      const target = locatorOf(m.target, `step ${sid} motion target`);
      if (!target) throw Error(`step ${sid}: a motion assertion names its target`);
      return [{ target, property: str(m.property) ?? '', from: str(m.from) ?? '', to: str(m.to) ?? '', duration: Number(m.duration), delay: Number(m.delay ?? 0), easing: str(m.easing) ?? '' }];
    });
    const step: Step = { id: sid, line: lineAt(node), deadlineMs, timeoutMs, actions, expects, motion, targets };
    only(raw.request, ['method', 'path', 'body'], `step ${sid} request`, 'a request key');
    if (isObj(raw.request)) step.request = { line: keyLine('request'), method: (str(raw.request.method) ?? 'GET').toUpperCase(), path: str(raw.request.path) ?? '/', body: raw.request.body, status: Number(raw.status ?? 200) };
    steps.push(step);
  });
  const endNodes = root.get('end_state', true);
  const endState: EndCheck[] = (Array.isArray(data.end_state) ? data.end_state : []).map((raw, i) => {
    if (!isObj(raw)) throw Error(`end_state ${i + 1} is a map`);
    const node = (isSeq(endNodes) ? endNodes.items[i] : undefined) as Node | undefined;
    const eid = str(raw.id) ?? `end-${i + 1}`;
    only(raw, END_KEYS, `end_state ${eid}`, 'an end-state key');
    only(raw.readback, ['method', 'path'], `end_state ${eid} readback`, 'a readback key');
    const oracle = raw.oracle === 'model' || raw.oracle === 'person' ? raw.oracle : 'code';
    const locator = locatorOf(raw.locator, `end_state ${eid} locator`);
    const check: EndCheck = { id: eid, line: lineAt(node), oracle };
    if (locator) { check.locator = locator; check.driverLocator = toDriver(locator)!; }
    if (str(raw.text) !== undefined) check.text = str(raw.text)!;
    if (typeof raw.visible === 'boolean') check.visible = raw.visible;
    if (isObj(raw.readback)) check.readback = { method: (str(raw.readback.method) ?? 'GET').toUpperCase(), path: str(raw.readback.path) ?? '/' };
    if (raw.equals !== undefined) check.equals = raw.equals;
    if (isObj(raw.count)) check.count = Object.fromEntries(Object.entries(raw.count).map(([k, v]) => [k, Number(v)]));
    if (str(raw.requirement) !== undefined) check.requirement = str(raw.requirement)!;
    return check;
  });
  const expectedErrors: ExpectedError[] = (Array.isArray(data.expected_errors) ? data.expected_errors : []).flatMap((e: unknown, i: number) => (only(e, ['step', 'message', 'url', 'status'], `expected_errors ${i + 1}`, 'an expected-error key'), isObj(e) && str(e.step) !== undefined ? [{ step: str(e.step)!, ...(str(e.message) !== undefined ? { message: str(e.message)! } : {}), ...(str(e.url) !== undefined ? { url: str(e.url)! } : {}), ...(typeof e.status === 'number' ? { status: e.status } : {}) }] : []));
  return {
    id, feature: str(data.feature) ?? null, depth: data.depth === 'live' ? 'live' : 'journey', api: data.api === true,
    masks: (Array.isArray(data.masks) ? data.masks : []).map((m: unknown, i: number) => locatorOf(m, `masks ${i + 1}`)).filter((l): l is Locator => !!l),
    steps, endState, expectedErrors, baseline: str(data.baseline) ?? null,
  };
}

/** What a file can never carry: a credential, or a baseline image. A run on such a file is refused before any stack starts. */
export function refusals(journey: Journey): string[] {
  const reasons: string[] = [];
  for (const s of journey.steps) {
    const fill = s.actions.find((a) => a.fill);
    if (!fill) continue;
    const name = `${fill.fill?.name ?? ''} ${fill.fill?.label ?? ''} ${fill.fill?.testId ?? ''}`;
    if (fill.text !== undefined && /password|passcode|secret|token|api[-_ ]?key/i.test(name)) reasons.push(`step ${s.id} types a literal into the password field; a credential is referenced by name (secret: NAME) and comes from a lease`);
    if (fill.secret !== undefined && !NAME.test(fill.secret)) reasons.push(`step ${s.id}: secret names the credential (letters, digits and _), never its value`);
  }
  if (journey.baseline) reasons.push(`baseline: ${journey.baseline} names an image to compare with; a screen's only baseline is the same step rendered from the merge base here, so no committed image is ever compared`);
  return reasons;
}
/** What a run can't drive, so a run on it is refused rather than passing with it unrun: no end state; an API journey's
 * step without a request, or with a page action beside it, or end-state check without a readback; a browser journey
 * with no step, or a step that makes a request; and a readback that checks nothing, also looks at the page, or isn't read by code. */
export function unrunnable(journey: Journey): string[] {
  const reasons: string[] = [];
  if (!journey.endState.length) reasons.push('an end state is required: end_state names at least one check of what the system holds once the journey is done, and this journey names none');
  if (journey.api) {
    for (const s of journey.steps) if (!s.request) reasons.push(`step ${s.id} of an API journey makes no request, so it would never run`);
    for (const s of journey.steps) if (s.request && (s.actions.length || s.expects.length || s.motion.length)) reasons.push(`step ${s.id} of an API journey drives a page, which only a browser journey does, so it would never run`);
    for (const c of journey.endState) if (!c.readback) reasons.push(`end_state ${c.id} of an API journey reads nothing back from the system, so it would never run`);
  } else {
    if (!journey.steps.length) reasons.push('a journey has at least one step');
    for (const s of journey.steps) if (s.request) reasons.push(`step ${s.id} of a browser journey makes a request, which only an API journey makes, so it would never run`);
  }
  for (const c of journey.endState) {
    if (!c.readback) continue;
    if (c.equals === undefined && !c.count) reasons.push(`end_state ${c.id} reads back ${c.readback.path} but checks nothing in it: name equals or count`);
    if (c.locator || c.text !== undefined || c.visible !== undefined) reasons.push(`end_state ${c.id} both reads back and looks at the page; name each as its own check, so neither half goes unrun`);
    if (c.oracle !== 'code') reasons.push(`end_state ${c.id} reads back with a ${c.oracle} oracle; a readback is read by code`);
  }
  return reasons;
}
/** Review of a journey file as data: end state required, nothing it can't run, no credential, no baseline image; what a proposal fails on. */
export function reviewJourney(text: string): Review {
  let journey: Journey;
  try { journey = parseJourney(text); } catch (error) { return { ok: false, reasons: [(error as Error).message] }; }
  const reasons = unrunnable(journey);
  if (journey.endState.length && !journey.endState.some((c) => c.oracle !== 'model')) reasons.push('an end state is required: a model reading alone is no end state a journey can rest on; name a check whose oracle is code or a person');
  reasons.push(...refusals(journey));
  return reasons.length ? { ok: false, reasons } : { ok: true };
}
