// The judges of the #3611 acceptance tests: each decides a criterion from what cores answered and what the store's
// files hold, and gives its failures as sentences that name the pack and what was wrong. They start nothing and read no
// file, so each is also run on planted answers (README: What was run). A row is a row of the `packs` call:
// `{pack, version, state, checks, issues, layouts}`, its `checks` 0 for a result the core took from the store and 1 for
// a check it ran; `counts` is that call's `{kits, fields, rewrites, runs, compiles}`.
import { isDeepStrictEqual } from 'node:util';

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`), checked against the issue's body. */
export const AC = {
  1: '#3611.d8311031',
  2: '#3611.8b256396',
  3: '#3611.ce0f9025',
  4: '#3611.f11db91d',
  5: '#3611.55062395',
  6: '#3611.3b726ffd',
};
/** What a pack check runs, as the `packs` call's `counts` names each. */
export const COUNTS = ['kits', 'fields', 'rewrites', 'runs', 'compiles'];

const show = (v, n = 300) => (JSON.stringify(v) ?? String(v)).slice(0, n);
export const refOf = (row) => `${row?.pack}@${row?.version}`;
export const rowOf = (rows, ref) => rows.find((row) => refOf(row) === ref);
const said = (row) => (row ? `state ${show(row.state)}, checks ${show(row.checks)}` : 'no row');
/** `rows` with the count of checks run taken out of each. */
const but = (rows) => rows.map(({ checks: _checks, ...rest }) => rest);

/** Why `counts` isn't the five whole numbers the `packs` call says, or ''. */
export function countsProblem(counts) {
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) return `holds no \`counts\` (${show(counts)})`;
  const bad = COUNTS.filter((name) => !Number.isInteger(counts[name]) || counts[name] < 0);
  return bad.length ? `holds \`counts\` without a whole number for ${bad.join(', ')} (${show(counts)})` : '';
}

/** The first place two lists of replies differ, in a sentence; '' when they are equal. */
function firstDifference(what, first, second) {
  if (isDeepStrictEqual(first, second)) return '';
  if (first.length !== second.length) return `${what}: ${second.length} where the first core gave ${first.length}`;
  const at = first.findIndex((value, index) => !isDeepStrictEqual(value, second[index]));
  const keys = Object.keys({ ...first[at], ...second[at] }).filter((key) => !isDeepStrictEqual(first[at]?.[key], second[at]?.[key]));
  return `${what} ${at + 1} of ${first.length} differs from the first core's in ${keys.join(', ') || 'its value'}: ${show(second[at]?.[keys[0]], 200)} where the first gave ${show(first[at]?.[keys[0]], 200)}`;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1.

/**
 * The first core, started on an empty store: its own count counts each of the five, it ran each version's check once,
 * and it left a row for each version in the store. `refs` are the shipped versions, `{ref, provider}`; `files` maps
 * each to its file as store.mjs `fileAt` reads it.
 */
export function judgeFirstCore({ refs, packs, files, store }) {
  const out = [];
  const bad = countsProblem(packs.counts);
  if (bad) out.push(`the first core's \`packs\` reply ${bad}: a core's own count of the kits, field checks, rewrites, runs and compiles its pack checks ran`);
  else for (const name of COUNTS) if (packs.counts[name] < 1) out.push(`the first core checked every shipped pack and its count of ${name} is ${packs.counts[name]}: a count that stays 0 on the core that ran the checks says nothing on a second`);
  for (const { ref } of refs) {
    const row = rowOf(packs.rows, ref);
    if (!row) out.push(`${ref}: the first core's \`packs\` reply holds no row for it`);
    else if (row.checks !== 1) out.push(`${ref}: the first core, started on an empty store, counts ${show(row.checks)} checks of it, not 1`);
  }
  const unkept = refs.filter(({ ref, provider }) => !provider && !files.get(ref)?.exists).map(({ ref }) => ref);
  if (unkept.length) out.push(`the first core left no row under ${store} for ${unkept.length} of the ${refs.length} shipped versions (${unkept.slice(0, 4).join(', ')}${unkept.length > 4 ? ', …' : ''}): it filled no store, so a second core has none to start on and runs every check again`);
  return out;
}

/**
 * The second core, started on the store the first filled. `first` and `second` are each `{packs, listing, last}`: the
 * first call's rows and counts, every page of the `deep_kinds` listing, and the rows and counts after the listing.
 * `before` and `after` map each version to its file before the second core started and after it was stopped.
 */
export function judgeSecondCore({ refs, first, second, before, after }) {
  const out = [];
  const bad = countsProblem(second.packs.counts);
  if (bad) out.push(`the second core's first reply ${bad}`);
  else for (const name of COUNTS) if (second.packs.counts[name] !== 0) out.push(`the second core ran pack checks before its first reply: its own count of ${name} since start is ${second.packs.counts[name]}, not 0`);
  for (const { ref } of refs) {
    const row = rowOf(second.packs.rows, ref);
    if (!row) out.push(`${ref}: the second core's \`packs\` reply holds no row for it`);
    else if (row.checks !== 0) out.push(`${ref}: the second core ran its check again (checks ${show(row.checks)}), though the first left its result in the store`);
  }
  // The rows equal the first core's, in its order, but for the count of checks run.
  for (const [index, row] of first.packs.rows.entries()) {
    const [was] = but([row]);
    const [is] = second.packs.rows[index] ? but([second.packs.rows[index]]) : [];
    if (isDeepStrictEqual(was, is)) continue;
    const keys = is ? Object.keys({ ...was, ...is }).filter((key) => !isDeepStrictEqual(was[key], is[key])) : [];
    out.push(`${refOf(row)}: the second core's \`packs\` row ${is ? `differs from the first core's in ${keys.join(', ')}: ${show(is[keys[0]], 200)} where the first gave ${show(was[keys[0]], 200)}` : 'is missing where the first core gave it'}`);
  }
  if (second.packs.rows.length > first.packs.rows.length) out.push(`the second core's \`packs\` reply holds ${second.packs.rows.length} rows where the first core's held ${first.packs.rows.length}`);
  const listing = firstDifference('page', first.listing, second.listing);
  if (listing) out.push(`the second core's \`deep_kinds\` listing: ${listing}`);
  const last = countsProblem(second.last.counts);
  if (last) out.push(`the second core's \`packs\` reply after its listing ${last}`);
  else for (const name of COUNTS) if (second.last.counts[name] !== 0) out.push(`the second core ran a pack check while it listed: after the listing its own count of ${name} is ${second.last.counts[name]}, not 0`);
  for (const { ref } of refs) {
    const was = before.get(ref), is = after.get(ref);
    if (!was?.exists) continue;
    if (!is?.exists) out.push(`${ref}: its row is gone from the store after the second core`);
    else if (was.sha !== is.sha || was.ino !== is.ino || was.mtimeMs !== is.mtimeMs) out.push(`${ref}: the second core wrote its row again (${was.sha === is.sha ? 'the same bytes in another file' : 'other bytes'}): a core writes a row for a check it ran, and it said it ran none`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2.

/**
 * `seen` holds the rows of six cores in turn and what the store's files said between them:
 *   `after`     the core started once a pack's bytes, a required version's bytes and a row's build had changed;
 *   `again`     the core after it, on the rows that one replaced;
 *   `planted`   a core started with the wrong program `wrong` planted, on those rows;
 *   `back`      a core like the first again, on the rows the planted one replaced;
 *   `settled`   the core after it.
 * `packs` names the four versions: `changed` (its bytes changed under its folder, to bytes its check refuses),
 * `required` (its bytes changed, to bytes that pass), `requiring` (untouched; it requires `required`) and `built`
 * (untouched; its row rewritten as a build of other sources would have left it). `digests` are `changed`'s row's digest
 * before and after, `builds` this build's digest, the other one, and what `built`'s row names after, with whether its
 * mark verifies.
 */
export function judgeChanged(seen) {
  const { packs, after, again, planted, back, settled, wrong, digests, builds } = seen;
  const out = [];
  const all = [packs.changed, packs.required, packs.requiring, packs.built];
  const ran = (rows, ref) => rowOf(rows, ref)?.checks === 1;
  const took = (rows, ref) => rowOf(rows, ref)?.checks === 0;

  const changed = rowOf(after, packs.changed);
  if (!ran(after, packs.changed)) out.push(`${packs.changed}: its bytes changed under the same folder, so the row there is of another digest (${digests.before}), and the core ${took(after, packs.changed) ? 'took that row' : 'gave no count of a check it ran'}: ${said(changed)}; the bytes there now are refused by their own check`);
  else if (changed.state !== 'refused') out.push(`${packs.changed}: its changed bytes hold an input whose default is outside its range, and after their check it reads ${show(changed.state)}, not refused`);
  if (!ran(after, packs.required)) out.push(`${packs.required}: its bytes changed under the same folder, so the row there is of another digest, and the core ${took(after, packs.required) ? 'took that row' : 'gave no count of a check it ran'}: ${said(rowOf(after, packs.required))}`);
  if (!ran(after, packs.requiring)) out.push(`${packs.requiring}: ${packs.required}, which it requires, is at another digest than its row names, and the core ${took(after, packs.requiring) ? 'took the row' : 'gave no count of a check it ran'}: ${said(rowOf(after, packs.requiring))}`);
  if (!ran(after, packs.built)) out.push(`${packs.built}: its row is of another build (${builds.other}, where this build is ${builds.own}), and the core ${took(after, packs.built) ? 'took it' : 'gave no count of a check it ran'}: ${said(rowOf(after, packs.built))}`);
  for (const ref of [packs.required, packs.requiring, packs.built]) if (ran(after, ref) && rowOf(after, ref).state !== 'installed') out.push(`${ref}: its bytes pass their check, and after it ran again it reads ${show(rowOf(after, ref).state)}`);

  if (digests.after === digests.before) out.push(`${packs.changed}: its row was not replaced: the file still names the digest ${digests.before} of the bytes that were there before`);
  if (builds.after !== builds.own) out.push(`${packs.built}: its row was not replaced: the file names build ${show(builds.after)}, not this build's ${builds.own}`);
  else if (!builds.marked) out.push(`${packs.built}: the row that replaced it carries no mark of the launch key`);

  for (const ref of all) {
    const row = rowOf(again, ref);
    if (!took(again, ref)) out.push(`${ref}: its check ran again and left no row the next core takes: that core ran the check once more (${said(row)}), so the row was not replaced`);
    else if (row.state !== rowOf(after, ref)?.state) out.push(`${ref}: the next core reads ${show(row.state)} from the store where the check just run read ${show(rowOf(after, ref)?.state)}`);
  }
  for (const ref of all) if (!ran(planted, ref)) out.push(`${ref}: a core started with the wrong program ${wrong} planted took the row a core without it wrote (${said(rowOf(planted, ref))}): a planted build runs the check again`);
  for (const ref of all) if (!ran(back, ref)) out.push(`${ref}: the core took the row a core with ${wrong} planted wrote (${said(rowOf(back, ref))}): a planted build's row is no result for another`);
  for (const ref of all) if (!took(settled, ref)) out.push(`${ref}: after a planted build's row was checked again, the next core ran the check once more (${said(rowOf(settled, ref))}): the row was not replaced`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3.

/**
 * `cases` are the versions whose rows were damaged, each `{ref, what}` with `what` the damage in words; `whole` is the
 * version whose row was left as the first core wrote it. `after` are the rows of the core started on them, `again`
 * those of the core after it.
 */
export function judgeDamaged({ cases, whole, after, again }) {
  const out = [];
  for (const { ref, what } of cases) {
    const row = rowOf(after, ref);
    if (row?.checks === 1 && row.state === 'installed') continue;
    out.push(row?.checks === 0
      ? `${ref}: its row ${what}, and the core read it as ${show(row.state)} without running its check: checks 0`
      : `${ref}: its row ${what}, and the core didn't run its check and install it: ${said(row)}`);
  }
  const kept = rowOf(after, whole);
  if (kept?.checks !== 0) out.push(`${whole}: its row is whole, as the first core wrote it, and the core didn't take it (${said(kept)}): a core that takes no row tells no damaged row from a whole one`);
  for (const ref of [...cases.map((c) => c.ref), whole]) {
    const row = rowOf(again, ref);
    if (row?.checks !== 0) out.push(`${ref}: after its check ran again, the next core ran it once more (${said(row)}): the row was not replaced whole`);
  }
  return out;
}

/**
 * Evidence the check kept that is gone. `same` is the row of a core started on the row with the first core's evidence
 * store, `gone` that of a core started on the row with an empty one; `lost` are the hashes the first store holds and
 * the empty one lacks once that core has answered.
 */
export function judgeEvidence({ ref, first, same, gone, lost }) {
  const out = [];
  if (first?.checks !== 1 || first.state !== 'installed') out.push(`${ref}: the first core, on an empty store, didn't check and install it: ${said(first)}`);
  if (same?.checks !== 0) out.push(`${ref}: with the evidence its check kept still there, a second core didn't take its row: ${said(same)}`);
  if (gone?.checks !== 1) out.push(`${ref}: the evidence its check kept is gone (${lost.length} of the first store's hashes, such as ${lost[0] ?? 'none'}, are not in this one), and the core ${gone?.checks === 0 ? 'took its row' : 'gave no count of a check it ran'}: ${said(gone)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4.

/**
 * `open` is a version its own check refuses, whose row a process that is not the hub rewrote to say installed, under a
 * mark it made itself; `shut` one its check installs, whose row that process changed to say refused, leaving the hub's
 * mark on it; `kept` one whose row nobody touched. `fill` are the first core's rows, `after` those of the core
 * started once the rows were written.
 */
export function judgeBeside({ open, shut, kept, fill, after }) {
  const out = [];
  const o = rowOf(after, open);
  if (o?.state !== 'refused' || o.checks !== 1) out.push(`${open}: a process that is not the hub wrote a row beside the hub's that says installed, under a mark it made itself, and the core ${o?.checks === 0 ? 'took it' : 'didn\'t run its check and refuse it'}: ${said(o)}; its own check refuses it`);
  else if (!isDeepStrictEqual(o.issues, rowOf(fill, open)?.issues)) out.push(`${open}: its check ran, and its issues are not those the first core's check gave: ${show(o.issues)}`);
  const s = rowOf(after, shut);
  if (s?.state !== 'installed' || s.checks !== 1) out.push(`${shut}: a process that is not the hub changed the hub's row to say refused and left the hub's mark on it, and the core ${s?.checks === 0 ? 'took it' : 'didn\'t run its check and install it'}: ${said(s)}`);
  const k = rowOf(after, kept);
  if (k?.checks !== 0) out.push(`${kept}: the hub's own row, untouched, was not taken (${said(k)}): a core that takes no row tells no row written beside the hub's from the hub's`);
  return out;
}

/**
 * The hub's own store, after its core answered a call that needs the release's packs. `rows` are the shipped versions'
 * files, each `{ref, provider, problems}` with what store.mjs `rowProblems` found; `scan` is what the process that is
 * not the hub found under the hub's root: `{files, candidates, key}`, `key` naming the file a key that makes a row's
 * mark was read from, or null.
 */
export function judgeHubStore({ rows, scan, store }) {
  const out = [];
  const unkept = rows.filter(({ provider, problems }) => !provider && problems.length);
  if (unkept.length) out.push(`the hub's core kept no result under ${store} for ${unkept.length} of the ${rows.length} versions the release ships: ${unkept.slice(0, 3).map(({ problems }) => problems[0]).join('; ')}${unkept.length > 3 ? '; …' : ''}`);
  if (scan.key) out.push(`a process that is not the hub read the launch key from ${scan.key.file} (${scan.key.form}): under it the mark of ${scan.key.row} verifies, so a row it writes beside the hub's would be taken`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5.

/**
 * `packs` names three versions their own check refuses: `stays` (untouched throughout), `fixed` (its bytes then changed
 * under its folder, to bytes that pass) and `built` (its row then rewritten as a build of other sources would have left
 * it). `fill` are the first core's rows, `second` the next core's, `after` those of the core started once `fixed`'s
 * bytes and `built`'s row had changed, `settled` those of the core after it.
 */
export function judgeRefused({ packs, fill, second, after, settled, builds }) {
  const out = [];
  const issues = (ref) => rowOf(fill, ref)?.issues;
  const fromStore = (rows, ref, when) => {
    const row = rowOf(rows, ref);
    if (row?.checks !== 0) return void out.push(`${ref}: refused by the first core's check, it was checked again ${when} (${said(row)}), though neither its digest nor the build changed: its refusal isn't taken from the store`);
    if (row.state !== 'refused') return void out.push(`${ref}: refused by its check, it reads ${show(row.state)} from the store ${when}`);
    if (!isDeepStrictEqual(row.issues, issues(ref))) out.push(`${ref}: it stays refused from the store ${when}, without the issues its check gave: ${show(row.issues, 200)} where the check gave ${show(issues(ref), 200)}`);
  };
  for (const ref of [packs.stays, packs.fixed, packs.built]) fromStore(second, ref, 'by the second core');
  fromStore(after, packs.stays, 'by the third core');
  const fixed = rowOf(after, packs.fixed);
  if (fixed?.checks !== 1 || fixed.state !== 'installed') out.push(`${packs.fixed}: its bytes changed under the same folder, so its refusal's row is of another digest, and it ${fixed?.checks === 0 ? 'was not checked again' : 'didn\'t pass its check'}: ${said(fixed)}; the bytes there now pass their check`);
  const built = rowOf(after, packs.built);
  if (built?.checks !== 1) out.push(`${packs.built}: its refusal's row is of another build (${builds.other}, where this build is ${builds.own}), and it ${built?.checks === 0 ? 'was not checked again' : 'has no count of a check run'}: ${said(built)}`);
  else if (built.state !== 'refused' || !isDeepStrictEqual(built.issues, issues(packs.built))) out.push(`${packs.built}: checked again by this build, it doesn't read refused with the issues its check gave before: ${said(built)}, ${show(built.issues, 200)}`);
  fromStore(settled, packs.stays, 'by the fourth core');
  fromStore(settled, packs.built, 'by the fourth core');
  const then = rowOf(settled, packs.fixed);
  if (then?.checks !== 0 || then.state !== 'installed') out.push(`${packs.fixed}: installed by the check its changed bytes ran, it doesn't read installed from the store on the next core: ${said(then)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6.

/** The number the issue gives the first reply, in ms, as the budget task's target. */
export const FIRST_REPLY_MS = 500;

/**
 * `benchmarks/budgets.json`: a task names the criterion, holds its number as `targets.first_reply_ms`, and compares
 * with the merge base at the lane's margin, a half.
 */
export function judgeTask(budgets, criterion = AC[6]) {
  const tasks = Array.isArray(budgets?.tasks) ? budgets.tasks.filter((task) => Array.isArray(task?.criteria) && task.criteria.includes(criterion)) : [];
  if (!tasks.length) return [`benchmarks/budgets.json holds no task whose \`criteria\` name ${criterion}: the budget window measures no first reply against the merge base`];
  const out = [];
  for (const task of tasks) {
    if (task.targets?.first_reply_ms !== FIRST_REPLY_MS) out.push(`${task.id}: its \`targets.first_reply_ms\` is ${show(task.targets?.first_reply_ms)}, not the issue's ${FIRST_REPLY_MS}`);
    if (task.margin !== 0.5) out.push(`${task.id}: its \`margin\` is ${show(task.margin)}, not the lane's 0.5, within which its time and its memory are compared with the merge base's`);
    if (typeof task.initialReason !== 'string' || !/#3611\b/.test(task.initialReason)) out.push(`${task.id}: its \`initialReason\` doesn't name #3611`);
    if (!Array.isArray(task.command) || !task.command.length) out.push(`${task.id}: it has no command to run`);
  }
  return out;
}

/**
 * A first reply's time, judged. `profile` is the build's (`release`, or `dev`), `verdict` the perf lane's own judge of
 * the five runs against the limit (`{status, reason}`), `ran` each timed core's own counts' sum, 0 for one that ran no
 * check. Returns `{state, text}`: PASS, FAIL, or INCONCLUSIVE with why.
 */
export function judgeFirstReply({ profile, runs, loads, verdict, ran, memory, first }) {
  const readings = `first replies ${runs.map((ms) => ms.toFixed(1)).join(', ')} ms against ${FIRST_REPLY_MS} ms, at one-minute loads ${loads.map(({ start, end }) => `${start.toFixed(1)} to ${end.toFixed(1)}`).join(', ')}; memory after each reply ${memory.map((bytes) => (bytes === null ? 'unread' : `${(bytes / 1048576).toFixed(1)} MiB`)).join(', ')}; the core that ran every check first replied in ${first.toFixed(1)} ms`;
  const busy = ran.findIndex((n) => n !== 0);
  if (busy >= 0) return { state: 'FAIL', text: `timed core ${busy + 1} ran ${ran[busy]} parts of pack checks before its first reply, on a filled store: what was timed is no core that takes its results from the store; ${readings}` };
  if (profile !== 'release') return { state: 'INCONCLUSIVE', text: `a reading, not the budget's result: the core timed is a ${profile} build, and the budget is a release build's; ${readings}` };
  if (verdict.status === 'PASS') return memory.some((bytes) => bytes === null)
    ? { state: 'INCONCLUSIVE', text: `the time is within the budget, and the memory after a reply can't be read here, which is missing, never 0; ${readings}` }
    : { state: 'PASS', text: readings };
  if (verdict.status === 'FAIL') return { state: 'FAIL', text: `a release build's first reply on a filled store is over the budget: ${verdict.reason}; ${readings}` };
  return { state: 'INCONCLUSIVE', text: `${verdict.reason ?? verdict.status}; ${readings}` };
}
