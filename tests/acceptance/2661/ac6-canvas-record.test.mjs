// AC6: the shipping app's build holds neither thread-local map, and a paint builds no JSON value for them, counted by
// the test. The replica's build still reads every item it read, on tests/acceptance/326/panels/'s suites, unchanged.
//
// The shipping app's build is the one scripts/app-bundle makes: `cargo build -p deep-app --bin deep-app`, no features.
// The maps are canvas.rs's two thread-locals, `DRAWN` (each item's value) and `PLACED` (where it was drawn); in a build
// that holds one, its thread-local's symbols name it (`deep_app::canvas::DRAWN`, mangled `8deep_app6canvas5DRAWN`), as
// `nm` lists the debug binary's symbols.
//
// The replica's build is read through #326's two suites that read the items a frame drew (`deep_app::canvas::items`):
// `acceptance_326_panels` and `acceptance_326_panels_redraft`, whose session page's `session-readout` item is read after
// each frame. At the merge base each ends as fixtures/326-panels-at-base.json holds (each fails one assertion of its
// own there, on the two views' counts, after the frames whose items it read). Unchanged means each test ends as it did
// there, or passes where it failed there, and no frame lacks its item.
//
// "A paint builds no JSON value for them" is not counted here: see README, Open points.
//
//   node --test tests/acceptance/2661/ac6-canvas-record.test.mjs      (cargo on PATH; macOS; builds both)
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const HERE = fileURLToPath(new URL(".", import.meta.url));
const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, "target");
const APP = join(TARGET, "debug", "deep-app");
const MAPS = { DRAWN: /8deep_app6canvas5DRAWN/, PLACED: /8deep_app6canvas6PLACED/ };
const SUITES = ["acceptance_326_panels", "acceptance_326_panels_redraft"];

/** Runs cargo with its output and its errors in one stream, in order, as a person reads them. */
function cargo(args) {
  const dir = mkdtempSync(join(tmpdir(), "da2661-cargo-"));
  const fd = openSync(join(dir, "out"), "w");
  try {
    const r = spawnSync("cargo", args, { cwd: REPO, stdio: ["ignore", fd, fd], timeout: 7_200_000 });
    return { status: r.status, output: readFileSync(join(dir, "out"), "utf8") };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}
const errors = (output) => output.split("\n").filter((l) => /^error|panicked|failed/.test(l)).slice(0, 12).join("\n");

/** Each test a harness-free suite ran, with how it ended: `ok`, or `FAILED at <file:line:col>: <its message>`. */
export function outcomes(output) {
  const ended = {};
  const lines = output.split("\n");
  let panic = null;
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].match(/panicked at .*?(tests\/acceptance\/\S+):$/);
    if (at) panic = `${at[1]}: ${lines[i + 1] ?? ""}`;
    const ran = lines[i].match(/^test (\S+) \.\.\. (ok|FAILED)$/);
    if (ran) {
      ended[ran[1]] = ran[2] === "ok" ? "ok" : `FAILED at ${panic}`;
      panic = null;
    }
  }
  return ended;
}

test("#2661 AC6 the shipping app holds neither canvas map, and the replica still reads every item #326 suites read", { timeout: 7_200_000 }, () => {
  if (process.platform !== "darwin") assert.fail("INCONCLUSIVE: the app ships on macOS; this reads its Mach-O symbols");
  const failures = [];

  // The shipping app's build, as scripts/app-bundle makes it.
  const built = cargo(["build", "--locked", "-p", "deep-app", "--bin", "deep-app"]);
  if (built.status !== 0 || !existsSync(APP)) assert.fail(`BLOCKED: the shipping app can not be built: ${errors(built.output)}`);
  const nm = spawnSync("nm", ["-j", APP], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (nm.status !== 0) assert.fail(`BLOCKED: nm can not read ${APP}: ${nm.stderr}`);
  const symbols = nm.stdout.split("\n");
  if (!symbols.some((s) => /8deep_app6canvas/.test(s))) assert.fail(`BLOCKED: ${APP} names no deep_app::canvas symbol; is it a debug build with its symbols?`);
  for (const [name, pattern] of Object.entries(MAPS)) {
    const held = symbols.filter((s) => pattern.test(s));
    if (held.length) failures.push(`the shipping app build holds the thread-local map deep_app::canvas::${name}: ${held.length} symbols, ${held.slice(0, 3).join(", ")}`);
  }

  // The replica's build, through #326's suites that read the items a frame drew, each test as it ended at the merge base.
  const atBase = JSON.parse(readFileSync(join(HERE, "fixtures", "326-panels-at-base.json"), "utf8"));
  for (const suite of SUITES) {
    const ran = cargo(["test", "--locked", "-p", "deep-replica", "--test", suite, "--no-fail-fast"]);
    const ended = outcomes(ran.output);
    if (!Object.keys(ended).length) assert.fail(`BLOCKED: #326 ${suite} ran no test (exit ${ran.status}): ${errors(ran.output)}`);
    for (const [name, then] of Object.entries(atBase[suite])) {
      const now = ended[name] ?? "not run";
      if (now !== then && !(now === "ok" && then.startsWith("FAILED"))) failures.push(`#326 ${suite} > ${name} ended "${now}", not as at the merge base (${atBase.base}), "${then}"`);
    }
    const missing = ran.output.split("\n").filter((l) => /drew no session-readout item|readout is not a count/.test(l));
    if (missing.length) failures.push(`#326 ${suite}: a frame the replica drew has no item it read at the merge base: ${missing.slice(0, 3).join("; ")}`);
  }

  assert.deepEqual(failures, [], `FAIL: ${failures.join("; ")}`);
});
