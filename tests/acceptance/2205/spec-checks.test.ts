// #2205: a spec check the gate can't run stands on the claim as BLOCKED. A name the done claim lists that `checks`
// doesn't define, an entry with no run line that no check kind takes, and a done.yaml that doesn't parse are each left
// out on the merge base, and the claim is judged without them.
//
// Each test is one world of #322's (README): a trusted fixture repo whose `.deepbuild/done.yaml` is the spec the
// criterion writes, the real hub and a Claude Code session through the real deep-hook. The session makes a fix that
// passes the spec's unit check and its definition's one requirement, and stops. The claim that stop makes is read from
// the record: its `verdict.made` and its runs. The merge base is the wrong program for AC1, AC2, AC3 and the Scope
// tests: it carries PASS with nothing in the record naming the check or the file. AC4's two tests pass on it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, verdict } from '../322/helpers.ts';
import {
  AC1, AC2, AC3, AC4, DEFINED, JOURNEY, JOURNEY_FILE, JOURNEY_YAML, MISSPELLED, NO_CHECKS, NO_CLAIMS, NO_RUN, R1_CHECK, SCOPE, STOP_LINE, UNCLOSED, claimOn, namesLine, naming,
  namingFile, outcomesOf, ownedByYou, shownClaim,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** A hub's start, the definition's lock (180 s), the hooks and the claim's checks (900 s) on a machine other sessions load. */
const LIMIT = 2_400_000;
const SPEC = '.deepbuild/done.yaml';

describe(`${AC1} a name the done claim lists that checks doesn't define stands on the claim as BLOCKED, naming it`, () => {
  it(`${AC1} with claims: {done: {checks: [unit, typechek]}} and unit and typecheck defined, a claim whose unit check passes is BLOCKED, naming typechek`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(MISSPELLED, { waitsFor: ['unit'] });
    expect(outcomesOf(claim, 'unit'), `the done claim names unit, which checks defines with a run line, and the session's fix makes its test pass, so unit runs on the claim and passes: ${shownClaim(claim)}`).toContain('passed');
    // A hub that drops the name judges the claim without it, and fails here.
    expect(claim.outcome, `the done claim names typechek and checks defines only unit and typecheck, so typechek must stand on the claim as a check missing something outside the code and the claim is BLOCKED, never judged without it: ${shownClaim(claim)}`).toBe('BLOCKED');
    expect(naming(claim, 'typechek'), `the BLOCKED verdict must name typechek, the check that checks doesn't define: ${shownClaim(claim)}`).not.toEqual([]);
  }), LIMIT);
});

describe(`${AC2} an entry the gate can't turn into a run stands on the claim as BLOCKED, naming it`, () => {
  it(`${AC2} with checks.checkout written as {type: journey, file: ${JOURNEY_FILE}} and named by the done claim, the claim is BLOCKED, naming checkout`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(JOURNEY, { files: { [JOURNEY_FILE]: JOURNEY_YAML } });
    // A hub that drops the entry judges the claim without it, and fails here.
    expect(claim.outcome, `the done claim names checkout, whose entry has a type and a file and no run line, so nothing can run it: checkout must stand on the claim as a check missing something outside the code and the claim is BLOCKED, never judged without it: ${shownClaim(claim)}`).toBe('BLOCKED');
    expect(naming(claim, 'checkout'), `the BLOCKED verdict must name checkout, the check nothing can run: ${shownClaim(claim)}`).not.toEqual([]);
  }), LIMIT);
});

describe(`${AC3} a done.yaml that doesn't parse makes the claim BLOCKED, naming the file and where the parser stopped`, () => {
  it(`${AC3} with a done.yaml that ends inside an open checks: [ on its line ${STOP_LINE}, the claim is BLOCKED, naming ${SPEC} and line ${STOP_LINE}, and is never PASS`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(UNCLOSED);
    // A hub that reads the file as no spec judges the claim on its definition alone, and fails here.
    expect(claim.outcome, `${SPEC} ends inside an open checks: [ on its line ${STOP_LINE}, so it doesn't parse and the claim must be BLOCKED, never judged on its definition alone as in a repo with no spec: ${shownClaim(claim)}`).toBe('BLOCKED');
    expect(claim.verdicts.map((v) => String(v.data.outcome)), `a repo whose ${SPEC} doesn't parse is never read as a repo with no spec, so no verdict on the claim is PASS: ${shownClaim(claim)}`).not.toContain('PASS');
    const named = namingFile(claim, SPEC);
    expect(named, `the BLOCKED verdict must name ${SPEC}, the file that doesn't parse: ${shownClaim(claim)}`).not.toEqual([]);
    expect(named.filter((text) => namesLine(text, STOP_LINE)), `what the verdict says of ${SPEC} must say where the parser stopped: line ${STOP_LINE}, where the file ends inside the open checks: [: ${JSON.stringify(named)}`).not.toEqual([]);
  }), LIMIT);
});

describe(`${AC4} the twin: defined checks with run lines are judged as today, and a repo with no done.yaml gets no spec check and no BLOCKED`, () => {
  it(`${AC4} with claims: {done: {checks: [unit, typecheck]}}, both defined with run lines and unit with min_tests as the design writes it, each runs on the claim and passes, and the claim is PASS`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(DEFINED, { waitsFor: ['unit', 'typecheck', R1_CHECK] });
    for (const check of ['unit', 'typecheck']) {
      expect(outcomesOf(claim, check), `the done claim names ${check}, which checks defines with a run line, so ${check} runs on the claim and passes, as today: ${shownClaim(claim)}`).toContain('passed');
    }
    expect(claim.outcome, `every check the done claim names is defined with a run line and passes, and so does the definition's, so the claim is judged as today, PASS, with no BLOCKED from this rule (min_tests is a key the gate doesn't read): ${shownClaim(claim)}`).toBe('PASS');
  }), LIMIT);

  it(`${AC4} in a repo with no done.yaml the claim runs its definition's check and no spec check, and is not BLOCKED`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(null, { waitsFor: [R1_CHECK] });
    expect(outcomesOf(claim, R1_CHECK), `with no ${SPEC} the claim is still judged on its definition, whose check ${R1_CHECK} runs and passes: ${shownClaim(claim)}`).toContain('passed');
    expect(claim.runs.map((r) => r.check).filter((check) => check !== R1_CHECK), `a repo with no ${SPEC} has no spec check, so the only runs on the claim are of its definition's check ${R1_CHECK}: ${shownClaim(claim)}`).toEqual([]);
    expect(claim.outcome, `a repo with no ${SPEC} gets no BLOCKED from this rule: ${shownClaim(claim)}`).not.toBe('BLOCKED');
  }), LIMIT);
});

// The issue's Scope, first sentence: "A name in a claim's checks list that checks doesn't define, and an entry the gate
// can't turn into a run (no run line and no check kind that takes it), each stand on the claim as a check missing
// something outside the code: BLOCKED, naming the check and the cause, with you as owner. Neither is left out". The
// criteria fix one fixture each; these are the shapes of that sentence their fixtures don't have (README, Scope).
describe(`${SCOPE} a name checks doesn't define and an entry the gate can't turn into a run each stand on the claim as BLOCKED, naming the check, with you as owner, in every shape the spec gives them`, () => {
  it(`${SCOPE} no claims block: the claim takes every check, so unit runs and passes, and checks.checkout written as {type: journey, file: ${JOURNEY_FILE}} makes the claim BLOCKED, naming checkout, with you as owner`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(NO_CLAIMS, { files: { [JOURNEY_FILE]: JOURNEY_YAML }, waitsFor: ['unit'] });
    expect(outcomesOf(claim, 'unit'), `the spec has no claims block, so the claim takes every check checks holds: unit, which has a run line, runs on the claim and passes: ${shownClaim(claim)}`).toContain('passed');
    // A hub that takes only the entries with a run line judges the claim without checkout, and fails here.
    expect(claim.outcome, `the spec has no claims block, so the claim takes every check checks holds, and checkout has a type and a file and no run line: it must stand on the claim as a check missing something outside the code and the claim is BLOCKED, never judged without it: ${shownClaim(claim)}`).toBe('BLOCKED');
    const named = naming(claim, 'checkout');
    expect(named, `the BLOCKED verdict must name checkout, the check nothing can run: ${shownClaim(claim)}`).not.toEqual([]);
    expect(named.filter(ownedByYou), `what the verdict says of checkout must give you as its owner: ${JSON.stringify(named)}`).not.toEqual([]);
  }), LIMIT);

  it(`${SCOPE} no run line on a command entry: with checks.typecheck written as {type: command} and named by the done claim, the claim is BLOCKED, naming typecheck, with you as owner`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(NO_RUN);
    // A hub that drops the entry judges the claim without it, and fails here.
    expect(claim.outcome, `the done claim names typecheck, whose entry is of the command kind and has no run line, so the gate can't turn it into a run: typecheck must stand on the claim as a check missing something outside the code and the claim is BLOCKED, never judged without it: ${shownClaim(claim)}`).toBe('BLOCKED');
    const named = naming(claim, 'typecheck');
    expect(named, `the BLOCKED verdict must name typecheck, the check with no run line: ${shownClaim(claim)}`).not.toEqual([]);
    expect(named.filter(ownedByYou), `what the verdict says of typecheck must give you as its owner: ${JSON.stringify(named)}`).not.toEqual([]);
  }), LIMIT);

  it(`${SCOPE} no checks block: with claims: {done: {checks: [typecheck]}} and nothing under checks, no check of the spec can run and the claim is BLOCKED, naming typecheck, with you as owner`, async (ctx) => verdict(ctx, async () => {
    const claim = await claimOn(NO_CHECKS);
    // A hub that drops the name is left with no spec check at all, judges the claim on its definition alone, and fails here.
    expect(claim.outcome, `the done claim names typecheck and the spec defines no check, so typecheck must stand on the claim as a check missing something outside the code and the claim is BLOCKED, never judged on its definition alone: ${shownClaim(claim)}`).toBe('BLOCKED');
    const named = naming(claim, 'typecheck');
    expect(named, `the BLOCKED verdict must name typecheck, the check that checks doesn't define: ${shownClaim(claim)}`).not.toEqual([]);
    expect(named.filter(ownedByYou), `what the verdict says of typecheck must give you as its owner: ${JSON.stringify(named)}`).not.toEqual([]);
  }), LIMIT);
});
