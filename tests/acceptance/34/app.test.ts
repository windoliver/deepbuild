// #34, the app's halves of AC5, AC6, AC10 and AC11: the app's one record reader, in Rust, run as deep-app's
// `acceptance_34` test target (app/record_reader.rs; README, The surface). This file runs that target once and
// holds each criterion to its Rust test, so the criteria's IDs sit in the lane the rest of #34 runs in.
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE, REPO, run, type Line } from './helpers.ts';

let ran: Promise<{ code: number | null; out: string }> | undefined;
/** `cargo test --locked -p deep-app --test acceptance_34`, once for this file, with this Node first on PATH. */
function cargoTest(): Promise<{ code: number | null; out: string }> {
  ran ??= run('cargo', ['test', '--locked', '-p', 'deep-app', '--test', 'acceptance_34', '--', '--test-threads=1'], {
    env: { ...process.env, PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}` } as Line,
    cwd: REPO,
    timeoutMs: 1_800_000,
  }).then((r) => ({ code: r.code, out: `${r.stdout}\n${r.stderr}` }));
  return ran;
}
/** The Rust test's line (`test <name> ... ok`) and, when it failed, its own failure output. */
async function rust(name: string): Promise<void> {
  const { out } = await cargoTest();
  if (!out.includes('running ')) throw Error(`BLOCKED: the acceptance_34 target didn't build or run:\n${out.split('\n').filter((l) => /error|warning: unused|no test target/.test(l)).slice(0, 20).join('\n') || out.slice(-3000)}`);
  const status = new RegExp(`^test ${name} \\.\\.\\. (\\w+)`, 'm').exec(out)?.[1];
  const failure = out.split(`---- ${name} stdout ----`)[1]?.split(/\n---- |\nfailures:\n/)[0]?.trim();
  expect(status, `${name} ran`).toBeDefined();
  expect(status, failure ?? `${name}: ${status}`).toBe('ok');
}

describe('AC5 #34.ed028526 cold start: the app reads the inbox at log_pos 800, an ask is appended at 801 before its subscription opens, and it subscribes after 800 and shows the ask', () => {
  it('AC5 the record reader, on the test stream, subscribes after 800 and shows the ask (an app that subscribes from the current end fails, naming the ask)', async () => {
    await rust('ac5_cold_start_the_app_subscribes_after_800_and_shows_the_ask_appended_at_801');
  }, 1_800_000);
});

describe('AC6 #34.ef7fb9f9 a test stream that drops the frame at 701 and sends 702 twice', () => {
  it('AC6 the record reader refetches from 700 before it applies 702, shows 701 and applies 702 once (an app that applies frames as they come fails, naming 701)', async () => {
    await rust('ac6_a_dropped_frame_at_701_is_refetched_from_700_before_702_applies_and_702_applies_once');
  }, 1_800_000);
});

describe('AC10 #34.af8f9478 log positions 701 to 749 skipped by a power cut', () => {
  it('AC10 the record reader at 700 that gets 750 refetches from 700 once, moves to 750 and refetches nothing for 751 (an app that stays at 700 fails, naming the count)', async () => {
    await rust('ac10_an_app_at_700_that_gets_750_refetches_from_700_once_moves_to_750_and_refetches_nothing_for_751');
  }, 1_800_000);
});

describe('AC11 #34.6ce4b9ff with the test VFS, a power cut drops the events at 900 to 905 after the app has shown them', () => {
  it('AC11 the record reader sees the restarted hub\'s new start ID, redoes its reads and no longer shows them (an app that resumes after 905 fails, naming 900)', async () => {
    await rust('ac11_after_a_power_cut_drops_900_to_905_the_app_sees_the_new_start_id_redoes_its_reads_and_no_longer_shows_them');
  }, 1_800_000);
});
