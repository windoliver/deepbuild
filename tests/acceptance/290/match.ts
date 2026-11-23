// The match pieces' run (criteria 4, 5, 8; README: The surface under test). It reuses #549's suite for building
// `deep-show` and driving `deep-show run` without blocking this process, #550's for reading a `match` reply's copies
// and comparing their full-state hashes, and #552's scenario and `match` call with `views`. Like helpers.ts's `gpu` it
// asserts nothing of what a criterion reads: a scenario the binary refuses (an unknown planted name among them), a
// piece refused at check and a `match` call refused come back as words, for the test's own assertion. Nothing here
// stands in for the net module, a copy's view, a driver or a `seen` column.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../424/helpers.ts';
import { FULL, Script, isObject, putEvidence, runShow, show, useBuilds, useChildren, useTemp } from '../549/helpers.ts';
import { hashFailures, netCopiesOf, playedOnFailures, type NetCopy } from '../550/helpers.ts';
import { matchCall, scenario } from '../552/helpers.ts';
import { PIECE_SIZE, type JsonObject, type JsonValue, type Pic, type Program, type Seen } from './helpers.ts';

export { FULL, hashFailures, playedOnFailures, useBuilds, useChildren, useTemp, type NetCopy };

/** The wrong programs a `deep-show run` scenario's `planted` holds for this suite (README: Planted programs). */
export type ShowPlanted = 'hidden_view_opacity_ignores_match_me' | 'hidden_view_ignores_seen';
/** A copy's view, with its frame's bytes as the evidence store holds them (the renderer's own PNG). */
export interface CopyView extends Seen { snapshot: string | null; bytes: Buffer | null }
export interface Played {
  /** Why nothing can be judged, in order: the scenario refused, the piece refused at check, the match refused. */
  blocked: string[];
  copies: NetCopy[];
  views: CopyView[];
}
/**
 * One `deep-show run`: the piece presented by `deep show` from your shell, then its match of `steps` match steps
 * played by both copies in this process over the test relay (seed 290), with each asked copy's view after its step
 * (#552's `views`), under the scenario's `planted` when one is named.
 */
export async function play(bin: string, evidence: string, o: { doc: string; document: JsonObject; program: Program; steps: number; views: { player: number; step: number }[]; planted?: ShowPlanted; what: string }): Promise<Played> {
  putEvidence(evidence, o.program.bytes);
  const s = new Script();
  const shown = s.present(o.doc, o.document);
  const m = s.add(matchCall(o.doc, o.steps, { relay: { seed: 290 }, views: o.views }));
  const sc: JsonObject = { ...scenario(evidence, [{ id: o.doc, size: PIECE_SIZE }], s.calls), ...(o.planted ? { planted: o.planted } : {}) };
  const none: Played = { blocked: [], copies: [], views: [] };
  let replies: JsonObject[];
  try {
    replies = await runShow(bin, sc, o.what);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    // A run that couldn't be made here stays what it is, never a verdict on the piece.
    if (/^(INCONCLUSIVE|BLOCKED):/.test(why)) throw e;
    return { ...none, blocked: [`${o.what}${o.planted ? ` (planted ${o.planted})` : ''}: deep-show run doesn't take the scenario: ${why.slice(0, 900)}`] };
  }
  const piece = replies[shown];
  if (!piece || piece['outcome'] !== 'presented') {
    const errors = (Array.isArray(piece?.['issues']) ? piece['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error').map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`);
    return { ...none, blocked: [`${o.what}: the piece is ${String(piece?.['outcome'])} at check, not presented: ${errors.join('; ') || show(piece, 900)}`] };
  }
  const reply = replies[m];
  if (!reply || reply['code'] !== undefined) return { ...none, blocked: [`${o.what}: the match call is refused: ${show(reply, 900)}`] };
  const rows: JsonValue[] = Array.isArray(reply['views']) ? reply['views'] : [];
  const views = rows.filter(isObject).map((v): CopyView => {
    const sha = typeof v['snapshot'] === 'string' && /^[0-9a-f]{64}$/.test(v['snapshot']) ? v['snapshot'] : null;
    const path = sha ? join(evidence, sha.slice(0, 2), sha.slice(2)) : '';
    const bytes = sha && existsSync(path) ? readFileSync(path) : null;
    let image: Pic | null = null;
    try { image = bytes ? decodePng(bytes) : null; } catch { image = null; }
    return { player: Number(v['player']), step: Number(v['step']), me: v['me'], image, snapshot: sha, bytes };
  });
  return { blocked: [], copies: netCopiesOf(reply, o.what), views };
}
