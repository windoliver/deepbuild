// The #538 Oracle lane's tools: the #538 suite's surface (`deep-show run`'s `deep_show` and `eval` with the view's locale,
// its helpers in ../538/helpers.ts), its program writer and fixtures (../538/programs.ts, ../538/fixtures.ts), reused as
// they stand so both lanes ask the same binary the same way; and the one upstream file the Oracle page pins, read where
// README says, checked against its pinned SHA-256. Nothing of the file is copied into this folder.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, sha256 } from '../538/helpers.ts';

export * from '../538/helpers.ts';
export { countsProgram, RULES_WRITES } from '../538/programs.ts';
export { CAPTION_SIZE, caption, captionRef, film, logicItem } from '../538/fixtures.ts';

/** The pinned file, as the Oracle page links it: the upstream plural-rules file at commit 1129998233. */
export const PLURALS = 'cldr-1129998233/common/supplemental/plurals.xml';
export const PLURALS_SHA256 = 'd701d8b461afd2ba5eb21f9c1d645c8a661de225596afcf0f492ee36c69d727d';
/** Where the oracle checkout is: `DEEP_ORACLES` (the folder holding `vendor/`), else a sibling worktree of the `doneright`
 * branch (README: Where the lane reads the file). */
export const ORACLES = process.env['DEEP_ORACLES'] ? resolve(process.env['DEEP_ORACLES']) : resolve(REPO, '..', 'deep-oracles', 'doneright', 'oracles');

/** The pinned file's text, or BLOCKED with the one thing to do. */
export function vendored(rel: string, pin: string): string {
  const path = join(ORACLES, 'vendor', rel);
  if (!existsSync(path)) {
    throw Error(`BLOCKED: the pinned upstream file vendor/${rel} is missing at ${path}; this is not a pass.\nUnblock: check out branch doneright of DeepBuildAI/deepbuild as a worktree beside this checkout (git fetch origin doneright && git worktree add ../deep-oracles origin/doneright), or set DEEP_ORACLES to the folder that holds vendor/, then rerun.`);
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== pin) throw Error(`the file at ${path} hashes to ${sha256(bytes)}, not the pinned ${pin}: it isn't the file the Oracle page pins`);
  return bytes.toString('utf8');
}
