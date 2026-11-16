// AC1: "Given only the generated skill, Claude Code and Codex each write a fixture figure as a document that passes the
// document checks on the first try"
//
// The half that needs no model. "The generated skill": skills/deepbuild-canvas/SKILL.md (technical design: For an
// outside agent) is what its generator writes now (`node scripts/canvas-skill.mjs --check` exits 0; README: Surfaces
// this job invents, 8), and it names every kind of the registry that holds `effect@1` in the core's own listing
// (`deep-show kinds --dump`, kinds.dump@1) and each explainer effect kind, so it is made from the kinds' schemas. "Each
// write ... on the first try": the two run records the live test keeps (docs/evidence/508/agents/claude-code.run.json
// and codex.run.json), made on these exact skill bytes with the skill as their only context, hold a fixture figure (a
// `figure` document with a slider) that `deep_show` presents with no error. With no record the test is BLOCKED (run
// ac1-skill.live.test.ts); with a record made on other skill bytes it is INCONCLUSIVE. Wrong programs: the base (no
// skill, no generator); a hand-written or stale skill; one that leaves a kind out; a first try the checks refuse.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGENTS, AGENT_RUNS, EXPLAINERS, REPO, SKILL, TIMEOUT, ac, arr, blocked, checkFailures, inconclusive, isObject, none, obj, runShow, scenarioOf,
  sha256, show, showDoc, str, useBins, type JsonValue,
} from './helpers.ts';

const bin = useBins();

describe(`${ac(1)} the generated skill, and two agents' first tries at a fixture figure from it`, () => {
  it(`${ac(1)} the skill is generated from the kinds' schemas, and the Claude Code and Codex runs made from it alone each wrote a fixture figure that passes the document checks on the first try`, () => {
    const failures: string[] = [];
    if (!existsSync(SKILL)) blocked(`the generated skill ${SKILL} isn't there`);
    const skill = readFileSync(SKILL);
    const gen = spawnSync(process.execPath, [join(REPO, 'scripts', 'canvas-skill.mjs'), '--check'], { cwd: REPO, encoding: 'utf8' });
    if (gen.status !== 0) failures.push(`node scripts/canvas-skill.mjs --check exits ${String(gen.status)}: the skill on disk isn't what its generator writes now: ${(gen.stderr || gen.stdout || String(gen.error)).slice(-1500)}`);
    const dumpDir = mkdtempSync(join(tmpdir(), 'deep-508-kinds-'));
    try {
      const d = spawnSync(bin('deep-show'), ['kinds', '--dump', dumpDir], { cwd: REPO, encoding: 'utf8' });
      const answer = obj(JSON.parse(d.stdout || 'null') as JsonValue, `deep-show kinds --dump: ${d.stderr}`);
      const dump = obj(JSON.parse(readFileSync(str(answer['path'], 'the dump\'s path'), 'utf8')) as JsonValue, 'the kinds dump');
      const registries = arr(dump['registries'], 'the dump\'s registries').filter(isObject);
      const names = (r: JsonValue): string[] => (isObject(r) && Array.isArray(r['entries']) ? r['entries'].filter(isObject).map((e) => String(e['name'])) : []);
      const kinds = registries.find((r) => names(r).includes('effect@1'));
      if (!kinds) failures.push(`the core's listing has no registry holding effect@1: ${show(registries.map((r) => r['name']))}`);
      const text = skill.toString('utf8');
      for (const k of [...names(kinds ?? null), ...EXPLAINERS]) if (!text.includes(k)) failures.push(`the skill doesn't name ${k}, which the kinds' schemas list`);
    } finally {
      rmSync(dumpDir, { recursive: true, force: true });
    }
    none(failures, 'the generated skill');

    const skillSha = sha256(skill);
    for (const agent of AGENTS) {
      const path = join(AGENT_RUNS, `${agent}.run.json`);
      if (!existsSync(path)) blocked(`no recorded ${agent} run at ${path}: run ac1-skill.live.test.ts with DEEP_SKILL_LIVE=1`);
      const run = obj(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);
      expect(run['format'], `${path}: format`).toBe('canvas-skill.run@1');
      expect(obj(run['agent'], `${path}: agent`)['name'], `${path}: agent.name`).toBe(agent);
      expect(run['context'], `${path}: the skill was the session's only context`).toEqual(['SKILL.md']);
      if (run['skill_sha256'] !== skillSha) inconclusive(`the ${agent} run was made on skill bytes ${String(run['skill_sha256'])}, not this skill's ${skillSha}: run ac1-skill.live.test.ts again`);
      const document = obj(run['document'], `${path}: document`);
      const controls = isObject(document['controls']) ? Object.values(document['controls']).filter(isObject) : [];
      const own: string[] = [];
      if (document['profile'] !== 'figure') own.push(`${agent}: its document's profile is ${show(document['profile'] ?? null)}, not a figure`);
      if (!controls.some((c) => c['kind'] === 'slider')) own.push(`${agent}: its figure has no slider, so it isn't the test rig with a throttle slider it was asked for`);
      const evidence = mkdtempSync(join(tmpdir(), 'deep-508-evidence-'));
      try {
        const [shown] = runShow(bin('deep-show'), scenarioOf(evidence, [1280, 720], [showDoc(document)]), `the ${agent} figure`);
        own.push(...checkFailures(shown!, `${agent}: its first try`));
      } finally {
        rmSync(evidence, { recursive: true, force: true });
      }
      none(own, `the ${agent} session's first try at a fixture figure`);
    }
  }, TIMEOUT);
});
