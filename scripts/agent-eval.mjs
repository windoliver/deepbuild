#!/usr/bin/env node
// The manual agent evaluation's scorer (#26). Real Claude Code and Codex sessions run by hand on fixture repos, never
// in CI; each run is recorded as one JSON file (tests/acceptance/26/README.md, The manual evaluation's scorer) and
// scored here on its closed claim manifest, against evidence actually delivered in that session.
// A film session, one whose `brief` names craft checks (#2697), also reads the guide its skill names before its first
// deep_show, and its verdict rows report exactly the brief's checks.
//   node scripts/agent-eval.mjs run --agent claude|codex [--out <dir>] [--model <name>] [--no-skill | --skill <file>]
//   node scripts/agent-eval.mjs score <run.json>
// `run` starts one real session and records it (scripts/agent-eval-run.mjs), then scores it as `score` does.
// prints {"outcome": "PASS"|"FAIL", "reasons": [{code, detail}]} and exits 0 for PASS, 1 for FAIL, 3 when the file
// can't be scored, and 2 on a usage error (the deep commands' exit-code table).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOOL = /\bdeep_[a-z_]*[a-z]\b/g;
/** The installed DeepBuild's version, which the skill a session loaded must be pinned to. */
const INSTALLED = JSON.parse(readFileSync(new URL('../packages/hub/package.json', import.meta.url), 'utf8')).version;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A value in one canonical form, keys sorted, so two calls with the same arguments compare equal. */
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));

/** Why a recorded run fails, one reason per broken rule; none for a run that passes. */
export function score(run) {
  const reasons = [];
  const fail = (code, detail) => reasons.push({ code, detail });
  const tools = run.tools.map((t) => t.name);

  // The skill loaded, and it names exactly the tools the session's deep mcp served.
  const skill = run.skill?.loaded === true && typeof run.skill.text === 'string' && run.skill.text ? run.skill.text : undefined;
  if (!skill) fail('skill_not_loaded', 'the session did not load the skill');
  else {
    const pinned = /^version:\s*(\S+)\s*$/m.exec(skill)?.[1];
    if (pinned !== INSTALLED) fail('skill_version_mismatch', `the skill is pinned to ${pinned ?? 'no version'}, not the installed ${INSTALLED}`);
    const named = new Set(skill.match(TOOL) ?? []);
    for (const name of named) if (!tools.includes(name)) fail('skill_tools_mismatch', `the skill names ${name}, which the live tool list lacks`);
    for (const name of tools) if (!named.has(name)) fail('skill_tools_mismatch', `the skill doesn't name the live tool ${name}`);
  }

  // The first tool, and no call made twice with the same arguments.
  if (run.calls[0]?.tool !== run.manifest.first_tool) fail('wrong_first_tool', `the first call is ${run.calls[0]?.tool ?? 'none'}, not ${run.manifest.first_tool}`);
  const seen = new Set();
  for (const call of run.calls) {
    const key = `${call.tool} ${canonical(call.arguments ?? {})}`;
    if (seen.has(key)) fail('repeated_call', `${call.tool} was called twice with ${canonical(call.arguments ?? {})}`);
    seen.add(key);
  }

  // No expected value in the prompt: a session told the answer proves nothing.
  for (const claim of run.manifest.claims) {
    if (run.prompt.toLowerCase().includes(String(claim.expected).toLowerCase())) fail('expected_in_prompt', `the prompt holds ${claim.id}'s expected value`);
  }

  // Each claim is in the closed manifest, has its expected value, and cites a handle a call delivered in this session.
  const delivered = run.calls.map((call) => JSON.stringify(call.result ?? null)).join('\n');
  const expected = new Map(run.manifest.claims.map((c) => [c.id, c.expected]));
  for (const claim of run.answer.claims) {
    if (!expected.has(claim.id)) { fail('claim_not_in_manifest', `${claim.id} is not in the manifest`); continue; }
    if (claim.value !== expected.get(claim.id)) fail('claim_mismatch', `${claim.id} is ${JSON.stringify(claim.value)}, not ${JSON.stringify(expected.get(claim.id))}`);
    if (typeof claim.evidence !== 'string' || !claim.evidence || !delivered.includes(claim.evidence)) fail('evidence_not_delivered', `${claim.id} cites ${claim.evidence}, which no call in this session delivered`);
  }
  for (const id of expected.keys()) if (!run.answer.claims.some((c) => c.id === id)) fail('claim_missing', `the session made no claim ${id}`);
  filmReasons(run, skill, fail);
  return reasons;
}

/** Every value inside a result, a string holding JSON read as its value too (MCP results carry text content). */
function* values(v) {
  yield v;
  if (Array.isArray(v)) for (const x of v) yield* values(x);
  else if (isObj(v)) for (const x of Object.values(v)) yield* values(x);
  else if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { yield* values(JSON.parse(v)); } catch { /* not JSON: plain text */ }
  }
}

/**
 * A film session (#2697): one whose `brief` names craft checks. It reads the guide its skill names (`guide `<name>``)
 * with deep_kinds before its first deep_show, and its verdict rows (`from: {craft}`) report exactly the brief's checks.
 */
function filmReasons(run, skill, fail) {
  const named = Array.isArray(run.brief?.craft) ? run.brief.craft.map((c) => (isObj(c) ? c.check : c)).filter((c) => typeof c === 'string') : [];
  if (!named.length) return;
  const id = typeof run.run === 'string' ? run.run : 'the session';
  const guide = skill && /\bguide\s+`([^`\s]+)`/.exec(skill)?.[1];
  const render = run.calls.findIndex((c) => c.tool === 'deep_show');
  if (!guide) fail('skill_names_no_guide', `${id}: its skill names no guide for the craft checks its brief names, so it can't be told to read one before its first render`);
  else {
    const read = run.calls.findIndex((c) => c.tool === 'deep_kinds' && c.arguments?.op === 'read' && c.arguments?.guide === guide);
    if (render < 0) fail('film_never_rendered', `${id}: the session never called deep_show, so it can't show the guide ${guide} read before its first render`);
    else if (read < 0) fail('guide_not_read', `${id}: the session never read the guide ${guide} before its first render, call ${render + 1}`);
    else if (read > render) fail('guide_read_late', `${id}: the session read the guide ${guide} at call ${read + 1}, after its first render at call ${render + 1}`);
  }
  const ran = new Set();
  for (const call of run.calls) for (const v of values(call.result ?? null)) if (isObj(v) && isObj(v.from) && typeof v.from.craft === 'string') ran.add(v.from.craft);
  for (const check of new Set(named)) if (!ran.has(check)) fail('craft_check_unrun', `${id}: its brief names the craft check ${check}, which no verdict row reports`);
  for (const check of ran) if (!named.includes(check)) fail('craft_check_unnamed', `${id}: its verdict rows report the craft check ${check}, which its brief doesn't name`);
}

/** Whether the file holds a recorded run this scorer can read. */
const readable = (run) => isObj(run) && typeof run.prompt === 'string' && Array.isArray(run.tools) && Array.isArray(run.calls) && isObj(run.manifest)
  && Array.isArray(run.manifest.claims) && isObj(run.answer) && Array.isArray(run.answer.claims) && isObj(run.skill);

/** Prints a run's verdict as one JSON line; its exit code. */
function verdict(run) {
  const reasons = score(run);
  process.stdout.write(`${JSON.stringify({ outcome: reasons.length ? 'FAIL' : 'PASS', reasons })}\n`);
  return reasons.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'run') {
    const options = { skill: true };
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--no-skill') options.skill = false;
      else if (rest[i] === '--skill' && rest[i + 1]) options.skillFile = rest[++i];
      else if (['--agent', '--out', '--model'].includes(rest[i]) && rest[i + 1]) options[rest[i].slice(2)] = rest[++i];
      else { process.stderr.write(`unknown option ${rest[i]}\n`); process.exit(2); }
    }
    if (!['claude', 'codex'].includes(options.agent)) { process.stderr.write('--agent is claude or codex\n'); process.exit(2); }
    const { runEval } = await import('./agent-eval-run.mjs');
    const { dir, run } = await runEval(options);
    process.stderr.write(`recorded in ${dir}/run.json\n`);
    process.exit(verdict(run));
  }
  const [file, ...extra] = rest;
  if (command !== 'score' || !file || extra.length) {
    process.stderr.write('Usage: node scripts/agent-eval.mjs score <run.json>\n       node scripts/agent-eval.mjs run --agent claude|codex [--out <dir>] [--model <name>] [--no-skill | --skill <file>]\n');
    process.exit(2);
  }
  let run;
  try {
    run = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`can't read ${file}: ${error.message}\n`);
    process.exit(3);
  }
  if (!readable(run)) {
    process.stderr.write(`${file} is not a recorded run: it needs prompt, skill, tools, calls, manifest and answer\n`);
    process.exit(3);
  }
  process.exit(verdict(run));
}
