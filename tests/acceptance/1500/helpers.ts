// Test-side tools for the #1500 acceptance tests (README: The surface under test). They build `deep-show`, drive
// `deep-show run [--planted <name>]` (one scenario line in, one answer line out, one reply per call), write the
// jumper’s document with its logic program as WebAssembly bytes, and read `play_frames` replies. Nothing here stands in
// for the logic module, the physics module or the app: every state hash, pose, array, join and track entry read here
// is the implementation’s own; the expected values come from the issue’s text and this suite’s fixture, and each judge
// is run on planted output it must fail.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect } from "vitest";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1500 is three levels down). */
export const REPO = join(HERE, "..", "..", "..");
const TARGET = process.env["CARGO_TARGET_DIR"] ? resolve(REPO, process.env["CARGO_TARGET_DIR"]) : join(REPO, "target");
const RUST_BINS = ["/opt/homebrew/opt/rustup/bin", join(process.env["HOME"] ?? "/", ".cargo", "bin")].filter((d) => existsSync(d));
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env["CARGO_INCREMENTAL"] ?? "0",
  CARGO_PROFILE_DEV_DEBUG: process.env["CARGO_PROFILE_DEV_DEBUG"] ?? "0",
  ...(RUST_BINS.length ? { PATH: `${RUST_BINS.join(":")}:${process.env["PATH"] ?? ""}` } : {}),
};
const MIB = 1024 * 1024;

/** Every test passes this timeout. */
export const TIMEOUT = 3_600_000;
/** A file’s build, before its tests: a first deep-show build on a shared machine takes long. */
export const BUILD_TIMEOUT = 4 * TIMEOUT;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

/** Each criterion as a test names it, `AC<n> #1500.<id>` (the ID scripts/proof-change.mjs computes: the first eight hex characters of the SHA-256 of its text). */
export const AC = {
  1: "AC1 #1500.969af07a", 2: "AC2 #1500.d2cd8796", 3: "AC3 #1500.5b51b79e", 4: "AC4 #1500.e3f1b11d", 5: "AC5 #1500.5b02eccf",
  6: "AC6 #1500.ff44ea26", 7: "AC7 #1500.e19d11cf", 8: "AC8 #1500.d43f7964", 9: "AC9 #1500.fa7fb729", 10: "AC10 #1500.de71542b",
} as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? "undefined").slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === "number" && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe("string");
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join("\n  ")}`).toEqual([]);
}
/** A planted twin is caught: the judge that passes the real program finds something wrong, and its first failure
 * names every one of `names`. */
export function caughtNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what}: the judge finds the planted program wrong (it found nothing)`).toBeGreaterThan(0);
  expect(names.every((n) => failures[0]!.includes(n)), `${what}: the first failure names ${names.join(" and ")}; failures:\n  ${failures.slice(0, 20).join("\n  ")}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-show’s default set, once per file, copied out of the target folder.

/** `cargo build` of deep-show in the checkout, the binary copied to `to`; "" or why not. */
function buildTo(to: string): string {
  const args = ["build", "--locked", "-p", "deep-show", "--bin", "deep-show"];
  const r = spawnSync("cargo", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return (r.error as NodeJS.ErrnoException).code === "ENOENT" ? `BLOCKED: cargo isn’t on this machine (looked on PATH and in ${RUST_BINS.join(", ") || "no rustup folder"}), so deep-show can’t be built; this is not a pass` : `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(" ")} failed:\n${(r.stderr ?? "").split("\n").filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Download|Updating|Locking/.test(l)).join("\n").slice(-4000)}`;
  copyFileSync(join(TARGET, "debug", "deep-show"), to);
  return "";
}

/** Builds deep-show once, in the file’s beforeAll; a test fails at "the binary builds" with cargo’s error. With
 * `when` false nothing is built (a file whose test is BLOCKED before it would run anything). */
export function useBuild(when = true): () => string {
  let dir = "";
  let made: { bin: string; error: string } | undefined;
  beforeAll(() => {
    if (!when) return;
    dir = mkdtempSync(join(tmpdir(), "deep-1500-bin-"));
    const bin = join(dir, "deep-show");
    made = { bin, error: buildTo(bin) };
  }, BUILD_TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });
  return () => {
    expect(made, "the file built deep-show").toBeDefined();
    expect(made!.error, "the binary builds: deep-show").toBe("");
    return made!.bin;
  };
}

/** An evidence store per file (where a document’s program is read by its SHA-256), deleted after it. */
export function useEvidence(): () => string {
  let dir = "";
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });
  return () => (dir ||= mkdtempSync(join(tmpdir(), "deep-1500-evidence-")));
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run [--planted <name>]` (#393’s convention): one scenario line on stdin, one answer `{ok, replies}`.

export const SESSION = "sess-1500-jumper";
/** The jumper’s document ID, as the hub mints one (26 Crockford characters). */
export const DOC = "01JB1500GAME00000000000001";
const SESSIONS: JsonObject = { [SESSION]: { thread: "thread-1500", name: "Test agent: a change while you play", process: { pid: 4150, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4150, ppid: 1, start: 1_000 }];

/** This suite’s planted names (README: Planted twins), each reachable only through the startup `--planted <name>`. */
export type Planted = "join_restarts" | "join_reads_old_bytes" | "checks_read_carried_run" | "join_writes_entry" | "join_clears_pending" | "join_poses_only";

/** Runs `calls` through one `deep-show run [--planted p]` process of `bin` on the evidence store `evidence`: it starts,
 * exits 0 and answers each call. */
export function runShow(bin: string, evidence: string, calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const args = ["run", ...(planted ? ["--planted", planted] : [])];
  const sc = { evidence, sessions: SESSIONS, processes: PROCESSES, panels: { p1: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: "p1" } }, calls };
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: "utf8", maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: "SIGKILL" });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === "ETIMEDOUT" ? "timed out" : "", `${what}: deep-show ${args.join(" ")} finished within its timeout`).toBe("");
  if (r.error && code !== "EPIPE") throw Error(`${what}: ${r.error.message}`);
  const stdout = r.stdout ?? "";
  expect(r.status, `${what}: deep-show ${args.join(" ")} starts and exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? "").slice(-1500)}`).toBe(0);
  const lines = stdout.split("\n").filter((l) => l !== "");
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out["ok"], `${what}: deep-show run takes the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = arr(out["replies"], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies;
}

export const present = (document: JsonObject): JsonObject => ({ call: "deep_show", session: SESSION, doc: DOC, document, include: ["issues"] });
export function presented(reply: JsonObject | undefined, what: string): void {
  const r = obj(reply, what);
  expect(r["outcome"], `${what} is presented: ${show(r["issues"] ?? r, 3000)}`).toBe("presented");
  const errors = arr(r["issues"] ?? [], `${what}: issues`).filter((i) => isObject(i) && i["severity"] === "error");
  expect(errors, `${what} is presented with no error`).toEqual([]);
}
/** Keeps bytes in the scenario’s evidence store under their SHA-256 (`<2 hex>/<62 hex>`), where a document’s asset is read. */
function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The jumper (README: The fixture game): a world at 60 Hz with a static floor, a dynamic ball the press control `jump`
// launches and a dynamic crate; a drawn box painted by the material `paint`; and the logic item `game`, which reads
// `jump` and keeps a score in a state layout it exports.

export const FLICKS = 705_600_000;
export const RATE = 60;
/** One step’s flicks at 60 Hz: the world’s, the logic item’s and one frame’s. */
export const STEP = FLICKS / RATE;
export const WORLD = "lab";
export const LOGIC = "game";
export const BALL = "ball";
export const CRATE = "crate";
export const JUMP = "jump";
export const GRAVITY = -9.81;
/** The arrays the logic item writes, as `<item>.<name>`. */
export const A = { score: `${LOGIC}.score`, presses: `${LOGIC}.presses`, pressed_at: `${LOGIC}.pressed_at`, rule: `${LOGIC}.rule`, since: `${LOGIC}.since` } as const;
const WRITES = ["score", "presses", "pressed_at", "rule", "since"] as const;
/** The material’s colour before and after criterion 1’s patch, and the path a frame reads it at. */
export const RED = [0.8, 0.1, 0.1, 1];
export const BLUE = [0.1, 0.2, 0.9, 1];
export const PAINT_PATH = "items/paint/params/base_color";

/** A program of the game (README: Programs): its rule (1: a press scores 1; 2: a press scores 10 and the program
 * records its first step), its state layout (`A`, or `B` with a field inserted before the score) and its pages. */
export interface Version { rule: 1 | 2; layout: "A" | "B"; pages: number }
export const V1: Version = { rule: 1, layout: "A", pages: 1 };
export const V2: Version = { rule: 2, layout: "A", pages: 1 };
export const V3: Version = { rule: 1, layout: "B", pages: 1 };
/** Criterion 8’s 64 MiB game (1,024 pages, each holding a nonzero byte). */
export const BIG1: Version = { rule: 1, layout: "A", pages: 1024 };
export const BIG2: Version = { rule: 2, layout: "A", pages: 1024 };

/** The fixture’s choices: the program, the world’s gravity, whether the crate is there, the material’s colour, the span, or another world in place of `lab`’s own. */
export interface Game { version: Version; gravity?: number; crate?: boolean; color?: number[]; span?: string; world?: JsonObject }

const box = (half: number[]): JsonObject => ({ kind: "box", half });
/** The world `lab`: the static `floor` (top at y 0), the dynamic `ball` (radius 0.25 m, never sleeping, no damping)
 * resting on it at x 0, and the dynamic `crate` (0.5 m) resting at x 2; each `jump` entry launches the ball at 5 m/s up. */
export function labWorld(gravity = GRAVITY, crate = true): JsonObject {
  const use = (shape: string): JsonObject[] => [{ shape, contact_material: "m" }];
  const bodies: JsonObject = {
    floor: { kind: "static", shapes: use("floor"), pose: { pos: [0, -0.5, 0] } },
    [BALL]: { kind: "dynamic", shapes: use("ball"), pose: { pos: [0, 0.25, 0] }, sleep: false, damping: { linear: 0, angular: 0 } },
  };
  if (crate) bodies[CRATE] = { kind: "dynamic", shapes: use("crate"), pose: { pos: [2, 0.25, 0] } };
  return {
    kind: "physics.world@1", dimensions: 3, step_rate: RATE, substeps: 4, gravity: [0, gravity, 0], seed: 1500, mode: "dynamic",
    capacity: { bodies: 8, shapes: 8, joints: 0, contacts: 64, particles: 0 },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { floor: box([10, 0.5, 10]), ball: { kind: "sphere", radius: 0.25 }, crate: box([0.25, 0.25, 0.25]) },
    bodies,
    inputs: { [JUMP]: { kind: "launch", targets: [BALL], on: { control: JUMP, each: "entry" }, data: { linear: [0, 5, 0] } } },
  };
}

const LICENSE: JsonObject = { id: "CC0-1.0", terms: "Public domain dedication.", shareable: true, credit: "Test fixture made by the #1500 acceptance tests." };
const item = (id: string, order: string, rest: JsonObject): JsonObject => ({ id, name: id, order, ...rest });
/** The jumper’s document around a program by hash and a world (README: The fixture game). */
export function gameDocument(program: string, g: Game, world: JsonObject = g.world ?? labWorld(g.gravity, g.crate ?? true)): JsonObject {
  const params: JsonObject = { program, step_rate: RATE, reads: [JUMP], writes: Object.fromEntries(WRITES.map((w) => [w, { type: "i32" }])) };
  if (g.version.pages > 1) params["budget"] = { memory: g.version.pages / 16 };
  return {
    format: 1, profile: "scene", title: "The jumper", description: "A ball you make jump, its score and its world: a #1500 acceptance fixture.",
    size: [640, 360], camera: "cam", seed: 1500, transport: { span: g.span ?? "11s", frame_rate: [RATE, 1] },
    requires: { modules: { scene3d: "^1", logic: "^1", physics: "^1" } },
    controls: { [JUMP]: { kind: "press", class: "document", label: "Jump", role: "button" } },
    worlds: { [WORLD]: world },
    items: {
      cam: item("cam", "a000", { kind: "camera@1", params: { projection: "perspective", position: [1, 3, 9], target: [1, 1, 0], fov: 45 } }),
      paint: item("paint", "a001", { kind: "material@1", params: { base_color: g.color ?? RED } }),
      shown: item("shown", "a002", { kind: "mark.box@1", params: { size: [0.5, 0.5, 0.5] }, material: "paint" }),
      [LOGIC]: item(LOGIC, "a003", { kind: "logic@1", params }),
    },
    assets: { game_program: { sha256: program, license: LICENSE } },
  };
}

// The programs, assembled here as WebAssembly bytes (no assembler is built): one memory whose maximum is its minimum,
// the immutable i32 globals `reads_at` 0, `writes_at` 4096 and `layout_at` 2048, `init(seed: i64)` and `step(k: i64)`,
// no imports, no mutable global, and one active data segment at 2048: the layout’s bytes after a little-endian u32 of
// their length. The state lives in memory at the layout’s offsets.
interface Offsets { jump: number; writes: Record<(typeof WRITES)[number], number> }
const uleb = (n: number): number[] => { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
function sleb(n: number): number[] {
  const o: number[] = [];
  let v = BigInt(n);
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0);
    o.push(done ? b : b | 0x80);
    if (done) return o;
  }
}
export const LAYOUT_AT = 2048;
const FIELDS = { A: ["score", "presses", "pressed_at", "since"], B: ["lives", "score", "presses", "pressed_at", "since"] } as const;
/** A state layout’s field offsets (each an i32 from 8192 on, in table order). */
function fieldsOf(layout: "A" | "B"): Record<string, number> {
  return Object.fromEntries(FIELDS[layout].map((n, i) => [n, 8192 + 4 * i]));
}
/** A state layout’s bytes: a field table (Logic: saves across changes), `A` version 1, `B` version 2. */
export function layoutBytes(layout: "A" | "B"): Buffer {
  const at = fieldsOf(layout);
  return Buffer.from(JSON.stringify({ name: "jumper", version: layout === "A" ? 1 : 2, fields: FIELDS[layout].map((name) => ({ name, offset: at[name], type: "i32", count: 1 })) }), "utf8");
}
/** A state layout’s hash, as a save binds it: the SHA-256 of its bytes. */
export const layoutHash = (layout: "A" | "B"): string => sha256(layoutBytes(layout));

function programBytes(v: Version, at: Offsets | null): Buffer {
  const name = (s: string): number[] => [...uleb(s.length), ...Buffer.from(s, "utf8")];
  const vec = (xs: number[][]): number[] => [...uleb(xs.length), ...xs.flat()];
  const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body];
  const fn = (locals: number[][], code: number[]): number[] => { const b = [...vec(locals), ...code, 0x0b]; return [...uleb(b.length), ...b]; };
  const i32 = (n: number): number[] => [0x41, ...sleb(n)];
  const load = (a: number): number[] => [...i32(a), 0x28, 0x02, 0x00];
  const store = (a: number, value: number[]): number[] => [...i32(a), ...value, 0x36, 0x02, 0x00];
  const W = 4096;
  const f = fieldsOf(v.layout);
  const J = 1; // local: the presses this step read (local 0 is k)
  const kWrapped = [0x20, 0x00, 0xa7]; // i32.wrap_i64(k)
  const points = v.rule === 1 ? 1 : 10;
  const step = at === null ? [] : [
    ...load(at.jump), 0x21, J,
    0x20, J, 0x04, 0x40, // if the step read a press
    ...store(f["score"]!, [...load(f["score"]!), 0x20, J, ...i32(points), 0x6c, 0x6a]),
    ...store(f["presses"]!, [...load(f["presses"]!), 0x20, J, 0x6a]),
    ...store(f["pressed_at"]!, kWrapped),
    0x0b,
    // rule 2 keeps the step of its first call (plus one, so 0 means none yet) in `since`
    ...(v.rule === 2 ? [...load(f["since"]!), 0x45, 0x04, 0x40, ...store(f["since"]!, [...kWrapped, ...i32(1), 0x6a]), 0x0b] : []),
    ...store(W + at.writes.score, load(f["score"]!)),
    ...store(W + at.writes.presses, load(f["presses"]!)),
    ...store(W + at.writes.pressed_at, load(f["pressed_at"]!)),
    ...store(W + at.writes.rule, i32(v.rule)),
    ...store(W + at.writes.since, [...load(f["since"]!), ...i32(1), 0x6b]),
  ];
  // init: with more than one page, a nonzero byte at the end of every page, so the whole memory holds data.
  const P = 1; // local: the page (local 0 is the seed)
  const init = v.pages <= 1 ? [] : [
    0x03, 0x40, // loop
    0x20, P, ...i32(16), 0x74, ...i32(65535), 0x6a, ...i32(1), 0x3a, 0x00, 0x00, // store8 at (p << 16) + 65535
    0x20, P, ...i32(1), 0x6a, 0x22, P, ...i32(v.pages), 0x49, 0x0d, 0x00, // p += 1; again while p < pages
    0x0b,
  ];
  const lb = layoutBytes(v.layout);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(lb.length);
  const data = [...len, ...lb];
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7e, 0x00]])),
    ...section(3, vec([[0x00], [0x00]])),
    ...section(5, vec([[0x01, ...uleb(v.pages), ...uleb(v.pages)]])),
    ...section(6, vec([[0x7f, 0x00, ...i32(0), 0x0b], [0x7f, 0x00, ...i32(W), 0x0b], [0x7f, 0x00, ...i32(LAYOUT_AT), 0x0b]])),
    ...section(7, vec([[...name("memory"), 0x02, 0x00], [...name("reads_at"), 0x03, 0x00], [...name("writes_at"), 0x03, 0x01], [...name("layout_at"), 0x03, 0x02], [...name("init"), 0x00, 0x00], [...name("step"), 0x00, 0x01]])),
    ...section(10, vec([fn(v.pages <= 1 ? [] : [[1, 0x7f]], init), fn([[1, 0x7f]], step)])),
    ...section(11, vec([[0x00, ...i32(LAYOUT_AT), 0x0b, ...uleb(data.length), ...data]])),
  ]);
}

/** The item’s region map as `deep_query`’s logic read reports it for the probe (its step empty), once per process. */
let offsets: Offsets | undefined;
function offsetsOf(bin: string, evidence: string): Offsets {
  if (offsets) return offsets;
  const probe = gameDocument(putEvidence(evidence, programBytes(V1, null)), { version: V1 });
  const r = runShow(bin, evidence, [present(probe), { call: "deep_query", session: SESSION, doc: DOC, what: "logic", items: [LOGIC], steps: [] }], "the region-map probe");
  presented(r[0], "the jumper with the probe as its program");
  const read = obj(obj(obj(r[1], "deep_query")["logic"], `deep_query’s logic read: ${show(r[1], 800)}`)[LOGIC], `deep_query: logic.${LOGIC}`);
  const entries = arr(obj(read["region_map"], "the region map")["entries"], "the region map’s entries").map((e, i) => obj(e, `the region map’s entry ${i}`));
  const at = (region: string, n: string): number => {
    const e = entries.find((x) => x["region"] === region && x["name"] === n);
    expect(e, `the region map has the ${region} entry ${n}: ${show(entries, 800)}`).toBeTruthy();
    return num(e!["offset"], `the ${region} entry ${n}’s offset`);
  };
  offsets = { jump: at("reads", JUMP), writes: Object.fromEntries(WRITES.map((w) => [w, at("writes", w)])) as Offsets["writes"] };
  return offsets;
}
/** The jumper’s document: its program built against the item’s region map and kept in `evidence`. */
export function gameDoc(bin: string, evidence: string, g: Game): JsonObject {
  return gameDocument(putEvidence(evidence, programBytes(g.version, offsetsOf(bin, evidence))), g);
}

// ---------------------------------------------------------------------------------------------------
// `play_frames` (README: The surface under test).

/** A press latched in frame k is stamped at step k + 1 (Input track: the playhead’s step plus the one-step input lead
 * while silent, later than the first step not yet run), so its entry’s time is (k + 1) steps. */
export const stampOf = (frame: number): number => frame + 1;

export interface Script {
  frames: number;
  /** Frames whose latch takes one press of `jump`. */
  presses?: number[];
  /** Whole revisions of the document, each arriving while its frame is drawn. */
  revise?: { frame: number; document: JsonObject }[];
  /** Frames whose playhead moves to a step. */
  seeks?: { frame: number; to: number }[];
  /** The frames whose rows the reply lists (absent: every frame). */
  rows?: number[];
  paths?: string[];
}
export function playCall(s: Script): JsonObject {
  const events: JsonObject[] = [
    ...(s.presses ?? []).map((frame) => ({ frame, press: JUMP })),
    ...(s.revise ?? []).map((r) => ({ frame: r.frame, revise: r.document })),
    ...(s.seeks ?? []).map((x) => ({ frame: x.frame, seek: x.to })),
  ];
  return { call: "play_frames", doc: DOC, frames: s.frames, events, ...(s.rows ? { rows: s.rows } : {}), ...(s.paths ? { paths: s.paths } : {}) };
}

/** One row of a play (README: Row). */
export interface Row { frame: number; step: number; rev: number; from: number; deep: Record<string, string>; arrays: Record<string, number[]>; worlds: JsonObject; values: JsonObject }
/** One join (README: Join). */
export interface Join { frame: number; step: number; rev: number; outcome: string; worlds: JsonObject; differs: JsonObject[]; line: string; ns: number }
export interface Played { rows: Map<number, Row>; joins: Join[] }

const HASH16 = /^[0-9a-f]{16}$/;
function rowOf(v: JsonValue, what: string): Row {
  const o = obj(v, what);
  const deep = obj(o["deep_hash"], `${what}: deep_hash`);
  for (const [id, h] of Object.entries(deep)) expect(String(h), `${what}: deep_hash.${id} is a full-state hash (16 lowercase hex)`).toMatch(HASH16);
  const arrays = obj(o["arrays"], `${what}: arrays`);
  return {
    frame: num(o["frame"], `${what}: frame`), step: num(o["step"], `${what}: step`), rev: num(o["rev"], `${what}: rev`), from: num(o["from"], `${what}: from`),
    deep: deep as Record<string, string>,
    arrays: Object.fromEntries(Object.entries(arrays).map(([k, a]) => [k, arr(a, `${what}: arrays.${k}`).map((x, i) => num(x, `${what}: arrays.${k}[${i}]`))])),
    worlds: obj(o["worlds"], `${what}: worlds`), values: isObject(o["values"]) ? o["values"] : {},
  };
}
function joinOf(v: JsonValue, what: string): Join {
  const o = obj(v, what);
  return {
    frame: num(o["frame"], `${what}: frame`), step: num(o["step"], `${what}: step`), rev: num(o["rev"], `${what}: rev`), outcome: str(o["outcome"], `${what}: outcome`),
    worlds: obj(o["worlds"], `${what}: worlds`), differs: arr(o["differs"] ?? [], `${what}: differs`).map((d, i) => obj(d, `${what}: differs[${i}]`)),
    line: typeof o["line"] === "string" ? o["line"] : "", ns: num(o["ns"], `${what}: ns`),
  };
}
export function playedOf(reply: JsonObject | undefined, what: string): Played {
  const r = obj(reply, `${what}: play_frames`);
  expect(r["ok"], `${what}: play_frames plays (README: play_frames): ${show(r, 2500)}`).toBe(true);
  const rows = arr(r["frames"], `${what}: frames`).map((x, i) => rowOf(x, `${what}: frames[${i}]`));
  return { rows: new Map(rows.map((x) => [x.frame, x])), joins: arr(r["joins"], `${what}: joins`).map((j, i) => joinOf(j, `${what}: joins[${i}]`)) };
}
export function rowAt(p: Played, frame: number, what: string): Row {
  const r = p.rows.get(frame);
  expect(r, `${what}: the play lists frame ${frame}`).toBeDefined();
  return r!;
}

/** One process: the document presented, then `script` played, then the calls `after`; the play and their replies. */
export function play(bin: string, evidence: string, document: JsonObject, script: Script, what: string, planted?: Planted, after: JsonObject[] = []): { played: Played; after: JsonObject[] } {
  const r = runShow(bin, evidence, [present(document), playCall(script), ...after], what, planted);
  presented(r[0], `${what}: the jumper`);
  return { played: playedOf(r[1], what), after: r.slice(2) };
}

/** A body’s position in a row’s or a join’s `worlds`. */
export function posOf(worlds: JsonObject, body: string, what: string): number[] {
  const b = obj(obj(worlds[WORLD], `${what}: worlds.${WORLD}`)[body], `${what}: worlds.${WORLD}.${body}`);
  const p = arr(b["pos"], `${what}: ${body}.pos`).map((x, i) => num(x, `${what}: ${body}.pos[${i}]`));
  expect(p.length, `${what}: ${body}.pos holds three numbers`).toBe(3);
  return p;
}
/** The first element of a logic array in a row. */
export function valueOf(row: Row, name: string, what: string): number {
  const a = row.arrays[name];
  expect(a?.length, `${what}: frame ${row.frame} lists ${name}: ${JSON.stringify(row.arrays)}`).toBeGreaterThan(0);
  return a![0]!;
}

// ---------------------------------------------------------------------------------------------------
// Judges, computed here, each run on planted output it must fail.

/** Every body of every world `b` holds, held by `a` too, within 1e-6 in each position and quaternion component. */
export function sameBodies(a: JsonObject, b: JsonObject, what: string): string[] {
  const out: string[] = [];
  for (const [w, bodies] of Object.entries(b)) {
    if (!isObject(bodies)) continue;
    for (const [id, body] of Object.entries(bodies)) {
      const got = isObject(a[w]) ? (a[w] as JsonObject)[id] : undefined;
      if (!isObject(got) || !isObject(body)) { out.push(`${what}: ${w}.${id} is missing`); continue; }
      for (const f of ["pos", "rot"] as const) {
        const x = Array.isArray(got[f]) ? got[f] as number[] : [];
        const y = Array.isArray(body[f]) ? body[f] as number[] : [];
        if (x.length !== y.length || y.length === 0 || x.some((v, i) => Math.abs(v - y[i]!) > 1e-6)) out.push(`${what}: ${w}.${id}.${f} is ${JSON.stringify(x)}, not ${JSON.stringify(y)}`);
      }
    }
  }
  return out;
}

/**
 * A run that carried on from a join at step `at` (criteria 1, 2 and 3): one join, at step `at`, carried; the frame after
 * it shows step `at` + 1 of a run carried on from there, under the new revision; and, given an unpatched run, every
 * carried state’s full-state hash at `at` + 1 equal to that run’s. A failure names the step.
 */
export function judgeCarried(p: Played, at: number, unpatched?: Played): string[] {
  const out: string[] = [];
  const j = p.joins.find((x) => x.step === at);
  if (!j) return [`step ${at + 1}: no join at step ${at}; joins ${JSON.stringify(p.joins.map((x) => [x.step, x.outcome]))}`];
  if (j.outcome !== "carried") out.push(`step ${at + 1}: the join at step ${at} ${j.outcome}, not carried on (${j.line})`);
  const next = p.rows.get(at + 1);
  const before = p.rows.get(at);
  if (!next || !before) return [...out, `step ${at + 1}: the play lists no frame for step ${at} or ${at + 1}`];
  if (next.step !== at + 1) out.push(`step ${at + 1}: the frame after the join shows step ${next.step}`);
  if (next.from !== at + 1) out.push(`step ${at + 1}: the frame comes from a run from step ${next.from}, not one carried on from the join at step ${at}`);
  if (next.rev === before.rev) out.push(`step ${at + 1}: the frame draws revision ${next.rev}, the one before the patch`);
  if (unpatched) {
    const want = unpatched.rows.get(at + 1);
    if (!want) out.push(`step ${at + 1}: the unpatched run lists no frame there`);
    else for (const [id, h] of Object.entries(want.deep)) if (next.deep[id] !== h) out.push(`step ${at + 1}: ${id}’s full-state hash is ${next.deep[id] ?? "missing"}, and the unpatched run’s is ${h}`);
  }
  return out;
}

/**
 * A run that restarted at a join at step `at` (criteria 4 and 5): one join, at step `at`, restarted; the frame after it,
 * at step `at` + 1, from a run that began at step 0, equal in every carried state’s full-state hash and every array to
 * `fresh`, a run of the new revision from step 0 on the same presses. A failure names the step.
 */
export function judgeRestarted(p: Played, at: number, fresh: Played): string[] {
  const out: string[] = [];
  const j = p.joins.find((x) => x.step === at);
  if (!j) return [`step ${at + 1}: no join at step ${at}`];
  if (j.outcome !== "restarted") out.push(`step ${at + 1}: the join at step ${at} ${j.outcome}, where it restarts at step 0`);
  const next = p.rows.get(at + 1);
  const want = fresh.rows.get(at + 1);
  if (!next || !want) return [...out, `step ${at + 1}: a play lists no frame there`];
  if (next.from !== 0) out.push(`step ${at + 1}: the frame comes from a run carried on from step ${next.from}, not one restarted at step 0`);
  for (const [id, h] of Object.entries(want.deep)) if (next.deep[id] !== h) out.push(`step ${at + 1}: ${id}’s full-state hash is ${next.deep[id] ?? "missing"}, and a fresh run of the new revision’s is ${h}`);
  for (const [n, v] of Object.entries(want.arrays)) if (JSON.stringify(next.arrays[n]) !== JSON.stringify(v)) out.push(`step ${at + 1}: ${n} is ${JSON.stringify(next.arrays[n])}, and a fresh run of the new revision’s is ${JSON.stringify(v)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Budgets on the reference Mac (scripts/benchmark.mjs’s judgeLimit, as #189’s criterion 11 judges its budgets).

/** The reference Mac’s legs: BLOCKED on any other host, before they build or measure, never skipped. */
export function onReferenceMacOnly(leg: string): void {
  if (process.platform !== "darwin") blocked(`${leg} is pinned to the reference Mac; this host is ${process.platform}/${process.arch}`);
}
type JudgeLimit = (a: { limit: number; runs: number[]; fingerprint: JsonValue; loads: { start: number; end: number }[] }) => { status: string; reason?: string };
/** The repo’s budget judge on five readings after a warm-up; anything but PASS fails, naming the judge’s reason. */
export async function judgeBudget(limit: number, reading: () => number, what: string): Promise<void> {
  const bench = await import(pathToFileURL(join(REPO, "scripts", "benchmark.mjs")).href) as { fingerprint: () => JsonValue; judgeLimit: JudgeLimit };
  reading(); // warm-up, not judged
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < 5; i++) { const start = loadavg()[0]!; runs.push(reading()); loads.push({ start, end: loadavg()[0]! }); }
  const verdict = bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
  expect(verdict.status, `${what}: ${verdict.status} under ${limit} (runs ${JSON.stringify(runs)}, ${availableParallelism()} cores): ${verdict.reason ?? ""}`).toBe("PASS");
}

// ---------------------------------------------------------------------------------------------------
// Criteria 9 and 10’s run: 40 scripted presses while 20 patches that keep the layout land, 20 of the presses sent in
// the frame a patch lands.

/** The frames a patch lands in: every 30th, from 30 to 600. */
export const PATCH_FRAMES = Array.from({ length: 20 }, (_, i) => 30 * (i + 1));
/** The 40 presses: one in each patch’s frame, and one 15 frames before each. */
export const PRESS_FRAMES = PATCH_FRAMES.flatMap((f) => [f - 15, f]);
/** Each patch’s rule: the patches alternate the game’s two programs, rule 2 first, so each is a new revision. */
export const PATCH_RULES = PATCH_FRAMES.map((_, i) => (i % 2 === 0 ? 2 : 1));
export const PRESS_RUN_FRAMES = 620;
/** One process: the game under rule 1 presented, then 620 frames with the 40 presses and the 20 patches, then `after`. */
export function pressRun(bin: string, evidence: string, what: string, planted?: Planted, after: JsonObject[] = []): { played: Played; after: JsonObject[] } {
  const docs = { 1: gameDoc(bin, evidence, { version: V1 }), 2: gameDoc(bin, evidence, { version: V2 }) };
  const revise = PATCH_FRAMES.map((frame, i) => ({ frame, document: docs[PATCH_RULES[i] as 1 | 2] }));
  return play(bin, evidence, docs[1], { frames: PRESS_RUN_FRAMES, presses: PRESS_FRAMES, revise }, what, planted, after);
}
