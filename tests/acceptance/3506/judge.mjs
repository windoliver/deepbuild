// The judges of the #3506 acceptance tests: each decides a criterion from what a test read, and returns its findings
// as sentences that start with one of the four states (FAIL: the program says otherwise; BLOCKED: a reading is
// missing or unrun; INCONCLUSIVE: what was read can't decide; INVALID: not in the shape the README gives). No judge
// draws, reads a file or starts a process: drive.mjs does.
//
// Nothing here is a value from a run. The numbers are the issue's (215 MB; one 4-sample depth a view; one resolved
// image; 16 bytes a pixel of the view and of its mirror's view) and the fixture's own size.

/** Each criterion's ID: the first 8 hex digits of the SHA-256 of its text, as scripts/proof-change.mjs reads it. */
export const AC = { 1: '#3506.86abd572', 2: '#3506.0dcb130c', 3: '#3506.55c33ada', 4: '#3506.39b8e6ca', 5: '#3506.25e79c7f' };

/** #3031's frames: 300 of them, 5 a second (docs/spikes/3031/count.mjs). */
export const FRAMES = 300;
export const FPS = 5;
/** Criterion 1's line: at least 215 MB less, in the MB #3031's listing reads (10^6 B). */
export const LESS = 215_000_000;
/** What the issue says the merge base holds: 1,794 MB. A reading, said beside the run, not a line. */
export const BASE_SAID = 1_794_000_000;

export const stateOf = (problem) => /^(FAIL|BLOCKED|INCONCLUSIVE|INVALID)\b/.exec(problem)?.[1] ?? 'FAIL';
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const grouped = (n) => Math.round(n).toLocaleString('en-US');
const by = ([w, h]) => `${w} × ${h}`;

/** The view's size and its mirror's view's, which draws at half the size (#3031's listing: 3456 × 2234 and 1728 × 1117). */
export const views = (size) => ({ view: size, "mirror's view": size.map((v) => Math.floor(v / 2)) });

/**
 * What every listing must be before a criterion is read from it: the every-pass fixture at its size, with each of the
 * passes that make the pairs on (#3031's `on`), and a total from the device. Otherwise the reading isn't of the
 * fixture the criterion names: INVALID.
 */
export function listingProblems(name, listing, size, frames) {
  const problems = [];
  if (!listing || typeof listing !== 'object') return [`INVALID: ${name}: no listing`];
  if (listing.size?.[0] !== size[0] || listing.size?.[1] !== size[1]) problems.push(`INVALID: ${name}: the listing is of ${JSON.stringify(listing.size)}, not ${by(size)}`);
  if (listing.frames !== frames) problems.push(`INVALID: ${name}: the listing is after ${listing.frames} frames, not ${frames}`);
  const off = ['mirror', 'dof', 'motion_blur', 'ao', 'local_tone', 'glass'].filter((k) => listing.on?.[k] !== true);
  if (off.length) problems.push(`INVALID: ${name}: the fixture drew with ${off.join(', ')} off, so it isn't the every-pass scene`);
  if (!Number.isSafeInteger(listing.allocated) || listing.allocated <= 0) problems.push(`BLOCKED: ${name}: the device gave no allocated size (${JSON.stringify(listing.allocated)})`);
  if (!Array.isArray(listing.resources) || listing.resources.length === 0) problems.push(`BLOCKED: ${name}: the device listed nothing`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 1: the device's bytes

/** The change's device holds at least 215 MB less than the merge base's for the same fixture, read the same way. */
export function bytesProblems(base, change) {
  const fall = base.allocated - change.allocated;
  if (fall >= LESS) return [];
  return [`FAIL: the every-pass fixture at 3456 × 2234 holds ${grouped(change.allocated)} B (${mb(change.allocated)}) on the device, ${grouped(base.allocated)} B (${mb(base.allocated)}) on the merge base: ${fall >= 0 ? `${grouped(fall)} B (${mb(fall)}) less` : `${grouped(-fall)} B more`}, not at least 215 MB less`];
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 2: one 4-sample depth a view, one resolved image

/** Metal's pixel formats that hold depth (MTLPixelFormat: Depth16Unorm, Depth32Float, Depth24Unorm_Stencil8, Depth32Float_Stencil8). */
const DEPTH_FORMATS = new Set([250, 252, 255, 260]);
/** The labels a resolved image of motion blur or depth of field goes by: the merge base's two, and the one they share (README). */
export const RESOLVED = ['scene3d resolved', 'scene3d.motion resolved', 'scene3d.dof resolved'];
const named = (r) => `\`${r.label ?? '(no label)'}\` (${mb(r.bytes ?? 0)})`;
const sized = (r, [w, h]) => r.kind === 'texture' && r.width === w && r.height === h;

/**
 * Each view, the view at the fixture's size and its mirror's view at half, holds exactly one 4-sample depth
 * texture; the view, where motion blur and depth of field are both on, holds exactly one texture under the labels of a
 * resolved image, and the mirror's view, where depth of field alone is, at most one. A failure names every target it
 * counted.
 */
export function oneDepthProblems(listing, size) {
  const problems = [];
  for (const [view, at] of Object.entries(views(size))) {
    const depths = listing.resources.filter((r) => sized(r, at) && r.sample_count === 4 && DEPTH_FORMATS.has(r.mtl_pixel_format));
    if (depths.length !== 1) problems.push(`FAIL: the ${view} (${by(at)}) holds ${depths.length} 4-sample depths, not one: ${depths.map(named).join(', ') || 'none'}`);
    const resolved = listing.resources.filter((r) => sized(r, at) && RESOLVED.includes(r.label));
    const most = view === 'view' ? 'exactly one' : 'at most one';
    if (view === 'view' ? resolved.length !== 1 : resolved.length > 1) problems.push(`FAIL: the ${view} (${by(at)}) holds ${resolved.length} resolved images for motion blur and depth of field, not ${most}: ${resolved.map(named).join(', ') || 'none'}`);
  }
  return problems;
}

/** The target a planted renderer that keeps a depth of the occluders' own makes, by the merge base's label. */
export const OCCLUDERS_DEPTH = "scene3d occluders' depth";
/** The planted renderer's listing must fail `oneDepthProblems`, naming its target; otherwise the check can't see it. */
export function plantedDepthProblems(listing, size) {
  const found = oneDepthProblems(listing, size);
  if (found.some((p) => p.startsWith('FAIL:') && p.includes(OCCLUDERS_DEPTH))) return [];
  return [`FAIL: the planted renderer that keeps a depth of the occluders' own wasn't failed naming \`${OCCLUDERS_DEPTH}\`: the check found ${found.length ? found.join('; ') : 'nothing'}`];
}

// ---------------------------------------------------------------------------------------------------------------------
// Criterion 4: the check's estimate

/** The estimate's bytes for a view of `size`: `per_px` for each pixel of its internal size, `fixed` whatever that size. */
export const estimateBytes = (estimate, [w, h]) => estimate.per_px * w * h + estimate.fixed;
/** The occluders' depth the estimate counted: 4 samples of Depth32Float, 16 B a pixel of the view and of its mirror's view. */
export const occludersBytes = (size) => Object.values(views(size)).reduce((sum, [w, h]) => sum + 16 * w * h, 0);

/** The change's estimate is the merge base's less exactly the occluders' depth, at the fixture's size. */
export function estimateProblems(base, change, size) {
  const shape = (e) => e && Number.isFinite(e.per_px) && Number.isSafeInteger(e.fixed);
  if (!shape(base) || !shape(change)) return [`INVALID: the estimate isn't {per_px, fixed}: the merge base's ${JSON.stringify(base)}, the change's ${JSON.stringify(change)}`];
  const before = estimateBytes(base, size);
  const after = estimateBytes(change, size);
  const want = occludersBytes(size);
  const fall = before - after;
  if (Math.abs(fall - want) < 1) return [];
  const mirror = views(size)["mirror's view"];
  return [`FAIL: the check's estimate for the fixture is ${grouped(after)} B (per_px ${change.per_px}, fixed ${grouped(change.fixed)}), ${grouped(before)} B on the merge base (per_px ${base.per_px}, fixed ${grouped(base.fixed)}): it falls by ${grouped(fall)} B, not by the ${grouped(want)} B of the occluders' depth it counted (16 B a pixel of the view's ${by(size)} and of its mirror's view's ${by(mirror)})`];
}

/** The planted estimate that still counts the occluders' depth must fail `estimateProblems`, naming the bytes. */
export function plantedEstimateProblems(base, planted, size) {
  const found = estimateProblems(base, planted, size);
  if (found.some((p) => p.startsWith('FAIL:') && p.includes(`${grouped(occludersBytes(size))} B`))) return [];
  return [`FAIL: the planted estimate that still counts the occluders' depth wasn't failed naming the bytes: the check found ${found.length ? found.join('; ') : 'nothing'}`];
}
