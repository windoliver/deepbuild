// Screens (#37, design: Screens): the pure parts. A journey screen's only baseline is the same step rendered from
// the merge base by DeepBuild on the same machine, under the same environment profile and tool versions, kept per
// base commit, check, profile and machine. Masks are locators the approved spec names, resolved on each side among
// the elements its capture recorded, painted on both sides before the comparison; a region that never holds still
// is masked by the smallest element holding it, on your answer.
import { createHash } from 'node:crypto';
import type { Locator } from './journey.js';
import { comparePixels, paintMasks, type Box, type Image } from './png.js';
import type { ScreenElement } from './run.js';

export interface MaskAsk { kind: 'taste'; step: string; region: Box; mask: Locator; screenshot: string }
export interface Difference { step: string; boxes: Box[]; sizeChanged: boolean }
export interface Delta { kind: 'screen' | 'dom' | 'request' | 'timing' | 'bundle'; step?: string; what: string; base: string | number | null; head: string | number | null }
/** One step's screen as a run captured it: the frame, whether it held still and where it didn't, the elements on it, and what else the step saw. */
export interface Capture { step: string; image: Image | null; still: boolean; unstable: Box | null; elements: ScreenElement[]; dom: string[]; tookMs: number }
export interface Render { captures: Capture[]; requests: Record<string, number>; bundle: Record<string, number> }

/** The key a base render is kept and reused by. */
export const renderKey = (base: string, check: string, environment: Record<string, string>, tools: Record<string, string>, machine: string): string =>
  createHash('sha256').update(JSON.stringify([base, check, environment, tools, machine])).digest('hex');

export const describeLocator = (l: Locator): string => {
  const own = l.testId ? `getByTestId('${l.testId}')` : l.label ? `getByLabel('${l.label}')` : l.role ? `getByRole('${l.role}'${l.name === undefined ? '' : `, { name: '${l.name}' }`})` : `getByLabel('${l.name ?? ''}', { exact: true })`;
  return l.within ? `getByRole('${l.within.role}', { name: '${l.within.name}' }).${own}` : own;
};
const contains = (outer: Box, inner: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const matches = (e: ScreenElement, l: Locator): boolean => {
  if (l.testId !== undefined) return e.testId === l.testId;
  if (l.label !== undefined) return e.label === l.label;
  if (l.role !== undefined) return e.role === l.role && (l.name === undefined || e.name === l.name);
  return l.name !== undefined && e.label === l.name;
};
/** A mask among a capture's elements: its box when exactly one element matches, and how many did. */
export function resolveMask(elements: readonly ScreenElement[], l: Locator): { box: Box | null; count: number } {
  let pool = elements;
  if (l.within) pool = pool.filter((e) => elements.some((c) => c.role === l.within!.role && c.name === l.within!.name && contains(c.box, e.box) && c !== e));
  const found = pool.filter((e) => matches(e, l));
  return { box: found.length === 1 ? found[0]!.box : null, count: found.length };
}
/** The smallest element whose box holds the region, as a locator the spec can name. */
export function smallestHolding(elements: readonly ScreenElement[], region: Box): Locator | null {
  const holding = elements.filter((e) => contains(e.box, region)).sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  const e = holding[0];
  if (!e) return null;
  if (e.testId) return { testId: e.testId };
  if (e.label && (e.explicitRole === null && e.role === 'generic')) return { name: e.label };
  if (e.role !== 'generic' && e.name) return { role: e.role, name: e.name };
  return e.label ? { name: e.label } : null;
}
/** Whether a region lies within the masks' boxes. */
export const masked = (region: Box | null, masks: readonly Box[]): boolean => region !== null && masks.some((m) => contains(m, region));
const union = (boxes: readonly Box[]): Box | null => {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};
/** Where two base renders of one screen differ outside the masks, as one region; null when they agree. */
export function baseDisagreement(first: Image, second: Image, masks: readonly Box[]): Box | null {
  const c = comparePixels(paintMasks(first, masks), paintMasks(second, masks));
  if (c.same) return null;
  return c.reason === 'pixels' ? union(c.boxes) : { x: 0, y: 0, width: first.width, height: first.height };
}
/** Base beside head, each a frame, with each changed box outlined on the head's half. */
export function sideBySide(base: Image, head: Image, boxes: readonly Box[]): Image {
  const width = base.width + head.width, height = Math.max(base.height, head.height);
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < base.height; y++) data.set(base.data.subarray(y * base.width * 4, (y + 1) * base.width * 4), y * width * 4);
  for (let y = 0; y < head.height; y++) data.set(head.data.subarray(y * head.width * 4, (y + 1) * head.width * 4), (y * width + base.width) * 4);
  const dot = (x: number, y: number): void => { if (x < 0 || y < 0 || x >= width || y >= height) return; const o = (y * width + x) * 4; data[o] = 220; data[o + 1] = 30; data[o + 2] = 30; data[o + 3] = 255; };
  for (const b of boxes) {
    for (let x = b.x - 1; x <= b.x + b.width; x++) { dot(base.width + x, b.y - 1); dot(base.width + x, b.y + b.height); }
    for (let y = b.y - 1; y <= b.y + b.height; y++) { dot(base.width + b.x - 1, y); dot(base.width + b.x + b.width, y); }
  }
  return { width, height, data };
}
/** The first line where two DOM listings differ, naming the element. */
export function domDelta(base: readonly string[], head: readonly string[]): { base: string; head: string } | null {
  for (let i = 0; i < Math.max(base.length, head.length); i++) if (base[i] !== head[i]) return { base: (base[i] ?? '(nothing)').trim(), head: (head[i] ?? '(nothing)').trim() };
  return null;
}
/** Requests by route with IDs read as one placeholder, counted. */
export function routesOf(requests: readonly { url: string; method: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of requests) {
    let key: string;
    try { const u = new URL(r.url); key = `${r.method} ${u.pathname.split('/').map((s) => (/^(?:[0-9a-f]{8,}|\d{4,}|[A-Za-z0-9_-]{20,})$/i.test(s) ? '{id}' : s)).join('/')}`; } catch { key = `${r.method} ${r.url}`; }
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
