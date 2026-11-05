// The CPU references #428's criteria are held to (README: The CPU references), written here from the published texts and
// never taken from the renderer: glTF 2.0's BRDF (Appendix B) with the design's direct-light compensation; the lobes of
// KHR_materials_sheen (Charlie sheen with Estevez and Kulla's visibility, albedo scaling), KHR_materials_anisotropy,
// KHR_materials_diffuse_transmission, KHR_materials_specular, KHR_materials_iridescence (Belcour and Barla's thin-film
// Fresnel as the extension gives it), KHR_materials_volume and KHR_materials_dispersion (the raster transmission model
// of the glTF Sample Viewer, which those extensions' implementation notes point to); the energy-preserving Oren-Nayar
// lobe KHR_materials_diffuse_roughness specifies (Portsmouth, Kutz and Hill's EON, as OpenPBR 1.1 writes it); the
// design's mirrored-view retroreflection and hashed flake cells, in f64; a mip chain and its trilinear lookup; a glTF
// reader and a ray tracer over a sample's own triangles; PNG reading. Nothing here imports vitest, so a check can run
// these references on its own. Copied pieces (the GGX lobe and its albedo, the pinhole, PNG reading) come from #422's
// and #423's helpers, since suites don't import each other.

import { inflateSync } from 'node:zlib';

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------------------------------
// Vectors, rotations (Units and axes: R = Rz·Ry·Rx in degrees), #378's pinhole and the orthographic view.

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
export const max3 = (c: readonly number[]): number => Math.max(c[0]!, c[1]!, c[2]!);
export const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const map3 = (f: (c: number) => number): Rgb => [f(0), f(1), f(2)];

export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}
/** The direction toward a sun aimed by `rot` (it shines along its own −Z). */
export const towardSun = (rot: V3): V3 => scale(rotate(rot, [0, 0, -1]), -1);

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
export const focalOf = (cam: Pinhole): number => basis(cam).focal;
/** The unit ray through frame point (px, py), pixel corners at integers (a pixel's centre is x + 0.5). */
export function rayAt(cam: Pinhole, px: number, py: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (px - cam.size[0] / 2) / focal)), scale(u, -(py - cam.size[1] / 2) / focal)));
}
export const pixelRay = (cam: Pinhole, x: number, y: number): V3 => rayAt(cam, x + 0.5, y + 0.5);
/** Where a world point lands in the frame (pixel corners at integers). */
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z];
}
/** Where a ray from `o` along unit `d` first meets the sphere at `c` of radius `r`, or null. */
export function hitSphere(o: V3, d: V3, c: V3, r: number): V3 | null {
  const oc = sub(o, c); const b = dot(oc, d); const disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? add(o, scale(d, t)) : null;
}
/** An orthographic view along −Z at `target`, `viewWidth` m across `size` (README: Assumed surfaces). */
export interface Ortho { target: V3; viewWidth: number; size: [number, number] }
export const orthoScale = (o: Ortho): number => o.size[0] / o.viewWidth;
/** The world point on the plane z = `z` under frame point (px, py), pixel corners at integers. */
export function orthoPoint(o: Ortho, px: number, py: number, z: number): V3 {
  const k = orthoScale(o);
  return [o.target[0] + (px - o.size[0] / 2) / k, o.target[1] - (py - o.size[1] / 2) / k, z];
}
export function orthoProject(o: Ortho, p: readonly number[]): [number, number] {
  const k = orthoScale(o);
  return [o.size[0] / 2 + (p[0]! - o.target[0]) * k, o.size[1] / 2 - (p[1]! - o.target[1]) * k];
}

// ---------------------------------------------------------------------------------------------------
// GGX with height-correlated Smith visibility, α = roughness² (glTF 2.0, Appendix B), its directional albedo E by
// quadrature, and the design's compensation on direct light: × (1 + F0 × (1 ÷ E − 1)) (Material).

export function ggxD(nh: number, a: number): number { const a2 = a * a; const d = nh * nh * (a2 - 1) + 1; return a2 / (Math.PI * d * d); }
export function smithV(nl: number, nv: number, a: number): number {
  const a2 = a * a;
  return 0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
}
/** E(μo, α): the GGX lobe's directional albedo with F = 1, by a 1024 × 64 midpoint rule over h importance-mapped by D. */
export function albedo(mu: number, a: number): number {
  if (a <= 0) return 1;
  const NU = 1024; const NP = 64; const a2 = a * a;
  const v: V3 = [Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu];
  let sum = 0;
  for (let j = 0; j < NU; j++) {
    const u = (j + 0.5) / NU;
    const c2 = (1 - u) / (1 + (a2 - 1) * u); const ct = Math.sqrt(c2); const st = Math.sqrt(Math.max(0, 1 - c2));
    for (let k = 0; k < NP; k++) {
      const phi = (2 * Math.PI * (k + 0.5)) / NP;
      const h: V3 = [st * Math.cos(phi), st * Math.sin(phi), ct];
      const vh = dot(v, h); if (vh <= 0) continue;
      const nl = 2 * vh * h[2] - v[2]; if (nl <= 0) continue;
      sum += (smithV(nl, mu, a) * nl * 4 * vh) / ct;
    }
  }
  return sum / (NU * NP);
}
const tables = new Map<string, number[]>();
/** A function of μ in [0, 1] tabulated at 129 points (keyed by `key`) and read linearly. */
function tabled(key: string, f: (mu: number) => number): (mu: number) => number {
  let t = tables.get(key);
  if (!t) { t = Array.from({ length: 129 }, (_, i) => f(Math.max(i / 128, 5e-4))); tables.set(key, t); }
  const tt = t;
  return (mu) => { const x = Math.min(Math.max(mu, 0), 1) * 128; const i = Math.min(Math.floor(x), 127); return tt[i]! + (tt[i + 1]! - tt[i]!) * (x - i); };
}
export const albedoOf = (a: number): ((mu: number) => number) => tabled(`ggx:${a}`, (mu) => albedo(mu, a));
export const schlick = (f0: number, f90: number, c: number): number => f0 + (f90 - f0) * Math.pow(Math.max(0, 1 - c), 5);

/** KHR_materials_anisotropy's lobe: GGX with αt = mix(α, 1, strength²), αb = α, and its height-correlated visibility. */
export function anisoDV(t: V3, b: V3, n: V3, h: V3, v: V3, l: V3, at: number, ab: number): number {
  const a2 = at * ab;
  const f: V3 = [ab * dot(t, h), at * dot(b, h), a2 * dot(n, h)];
  const w2 = a2 / dot(f, f);
  const D = (a2 * w2 * w2) / Math.PI;
  const gv = dot(n, l) * Math.hypot(at * dot(t, v), ab * dot(b, v), dot(n, v));
  const gl = dot(n, v) * Math.hypot(at * dot(t, l), ab * dot(b, l), dot(n, l));
  return D * (0.5 / (gv + gl));
}

// ---------------------------------------------------------------------------------------------------
// KHR_materials_sheen: the Charlie distribution, Estevez and Kulla's visibility (the extension's fitted Λ), and the
// sheen lobe's directional albedo E by quadrature for its albedo scaling.

export function charlieD(r: number, nh: number): number {
  const a = Math.max(r, 1e-6) ** 2; const inv = 1 / a;
  return ((2 + inv) * Math.pow(Math.max(0, 1 - nh * nh), inv * 0.5)) / (2 * Math.PI);
}
function lambdaHelper(x: number, a: number): number {
  const t = (1 - a) * (1 - a);
  const mix = (p: number, q: number): number => p + (q - p) * t;
  return mix(21.5473, 25.3245) / (1 + mix(3.82987, 3.32435) * Math.pow(x, mix(0.19823, 0.16801))) + mix(-1.9776, -1.27393) * x + mix(-4.32054, -4.85967);
}
const lambdaSheen = (c: number, a: number): number => (Math.abs(c) < 0.5 ? Math.exp(lambdaHelper(c, a)) : Math.exp(2 * lambdaHelper(0.5, a) - lambdaHelper(1 - c, a)));
export function sheenV(nl: number, nv: number, r: number): number {
  const a = Math.max(r, 1e-6) ** 2;
  return Math.min(Math.max(1 / ((1 + lambdaSheen(nv, a) + lambdaSheen(nl, a)) * (4 * nv * nl)), 0), 1);
}
/** E_sheen(μ, r): ∫ D·V·(n·l) over the hemisphere of l, for a sheen color of 1 (128 × 128 midpoint rule). */
export const sheenE = (r: number): ((mu: number) => number) => tabled(`sheen:${r}`, (mu) => {
  const v: V3 = [Math.sqrt(1 - mu * mu), 0, mu];
  const NT = 128; const NP = 128; let sum = 0;
  for (let i = 0; i < NT; i++) {
    const th = ((i + 0.5) / NT) * (Math.PI / 2); const st = Math.sin(th); const ct = Math.cos(th);
    for (let k = 0; k < NP; k++) {
      const ph = ((k + 0.5) / NP) * 2 * Math.PI;
      const l: V3 = [st * Math.cos(ph), st * Math.sin(ph), ct];
      const h = unit(add(l, v));
      sum += charlieD(r, h[2]) * sheenV(ct, mu, r) * ct * st;
    }
  }
  return sum * (Math.PI / 2 / NT) * ((2 * Math.PI) / NP);
});

// ---------------------------------------------------------------------------------------------------
// KHR_materials_iridescence: the thin film's Fresnel (Belcour and Barla 2017, as the extension specifies it).

const sq = (x: number): number => x * x;
function sensitivity(opd: number, shift: Rgb): Rgb {
  const phase = 2 * Math.PI * opd * 1e-9;
  const val = [5.4856e-13, 4.4201e-13, 5.2481e-13]; const pos = [1.681e6, 1.7953e6, 2.2084e6]; const vr = [4.3278e9, 9.3046e9, 6.6121e9];
  const xyz = map3((i) => val[i]! * Math.sqrt(2 * Math.PI * vr[i]!) * Math.cos(pos[i]! * phase + shift[i]!) * Math.exp(-sq(phase) * vr[i]!));
  xyz[0] += 9.747e-14 * Math.sqrt(2 * Math.PI * 4.5282e9) * Math.cos(2.2399e6 * phase + shift[0]) * Math.exp(-4.5282e9 * sq(phase));
  const [x, y, z] = xyz.map((c) => c / 1.0685e-7) as Rgb;
  return [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
}
/** F_iridescence(outside IOR, film IOR, cos θ1 = v·h, film thickness in nm, the base's F0 per channel). */
export function iridescence(outsideIor: number, filmIor: number, cos1: number, thickness: number, baseF0: Rgb): Rgb {
  const t = Math.min(Math.max(thickness / 0.03, 0), 1);
  const eta2 = outsideIor + (filmIor - outsideIor) * (t * t * (3 - 2 * t));
  const sin2Sq = sq(outsideIor / eta2) * (1 - sq(cos1));
  const cos2Sq = 1 - sin2Sq;
  if (cos2Sq < 0) return [1, 1, 1];
  const cos2 = Math.sqrt(cos2Sq);
  const r0 = sq((eta2 - outsideIor) / (eta2 + outsideIor));
  const r12 = schlick(r0, 1, cos1); const t121 = 1 - r12;
  const phi12 = eta2 < outsideIor ? Math.PI : 0; const phi21 = Math.PI - phi12;
  const baseIor = map3((i) => { const s = Math.sqrt(Math.min(Math.max(baseF0[i]!, 0), 0.9999)); return (1 + s) / (1 - s); });
  const r1 = map3((i) => sq((baseIor[i]! - eta2) / (baseIor[i]! + eta2)));
  const r23 = map3((i) => schlick(r1[i]!, 1, cos2));
  const phi23 = map3((i) => (baseIor[i]! < eta2 ? Math.PI : 0));
  const opd = 2 * eta2 * thickness * cos2;
  const phi = map3((i) => phi21 + phi23[i]!);
  const r123 = map3((i) => Math.min(Math.max(r12 * r23[i]!, 1e-5), 0.9999));
  const rs = map3((i) => (sq(t121) * r23[i]!) / (1 - r123[i]!));
  const out = map3((i) => r12 + rs[i]!);
  let cm = map3((i) => rs[i]! - t121);
  for (let m = 1; m <= 2; m++) {
    cm = map3((i) => cm[i]! * Math.sqrt(r123[i]!));
    const sm = sensitivity(m * opd, map3((i) => m * phi[i]!));
    for (let i = 0; i < 3; i++) out[i] = out[i]! + cm[i]! * 2 * sm[i]!;
  }
  return map3((i) => Math.max(out[i]!, 0));
}

// ---------------------------------------------------------------------------------------------------
// The energy-preserving Oren-Nayar lobe (EON) that KHR_materials_diffuse_roughness specifies.

const FON1 = 0.5 - 2 / (3 * Math.PI);
const FON2 = 2 / 3 - 28 / (15 * Math.PI);
/** FON's directional albedo, exact. */
export function fonAlbedo(mu: number, r: number): number {
  const m = Math.min(Math.max(mu, 1e-7), 1);
  const af = 1 / (1 + FON1 * r); const bf = r * af; const si = Math.sqrt(1 - m * m);
  const g = si * (Math.acos(m) - si * m) + (2 / 3) * ((si / m) * (1 - si * si * si) - si);
  return af + (bf / Math.PI) * g;
}
/** f_EON(ρ, r; l, v) about the normal n (no cosine). `compensated: false` is FON's single scattering alone. */
export function eon(rho: Rgb, r: number, n: V3, l: V3, v: V3, compensated = true): Rgb {
  const mi = dot(n, l); const mo = dot(n, v);
  const s = dot(l, v) - mi * mo;
  const st = s > 0 ? s / Math.max(mi, mo) : s;
  const af = 1 / (1 + FON1 * r);
  const eo = fonAlbedo(mo, r); const ei = fonAlbedo(mi, r); const avg = af * (1 + FON2 * r);
  return map3((i) => {
    const ss = (rho[i]! / Math.PI) * af * (1 + r * st);
    if (!compensated) return ss;
    const ms = (rho[i]! * rho[i]! * avg) / (1 - rho[i]! * (1 - avg));
    return ss + (ms / Math.PI) * Math.max(1e-7, 1 - eo) * Math.max(1e-7, 1 - ei) / Math.max(1e-7, 1 - avg);
  });
}

// ---------------------------------------------------------------------------------------------------
// The material the references shade, glTF's model with the lobes this issue adds (Material, KHR extensions).

export interface Lobes {
  base: Rgb; metallic: number; roughness: number;
  /** glTF's specularFactor (the design's specular_level × 2) and specularColorFactor, and the IOR. */
  specular: number; specularColor: Rgb; ior: number;
  sheen: { color: Rgb; roughness: number } | null;
  /** KHR_materials_anisotropy: strength and rotation (radians) about the tangent frame. */
  anisotropy: { strength: number; rotation: number } | null;
  /** KHR_materials_diffuse_transmission: factor and color. */
  translucency: { amount: number; color: Rgb } | null;
  iridescence: { weight: number; ior: number; thickness: number } | null;
  diffuseRoughness: number;
}
export const LOBES: Lobes = {
  base: [1, 1, 1], metallic: 0, roughness: 0.5, specular: 1, specularColor: [1, 1, 1], ior: 1.5,
  sheen: null, anisotropy: null, translucency: null, iridescence: null, diffuseRoughness: 0,
};
/** A shading frame: the shading normal, and the tangent and bitangent the anisotropic lobe reads. */
export interface Frame { n: V3; t: V3; b: V3 }
/** The dielectric's F0 per channel (KHR_materials_specular: min(F0(ior) × specular color, 1)), before the weight. */
export const dielectricF0 = (m: Lobes): Rgb => map3((i) => Math.min(sq((m.ior - 1) / (m.ior + 1)) * m.specularColor[i]!, 1));

/**
 * f(l, v) × |n·l| for one light, glTF's BRDF with the issue's lobes: the metal and dielectric lobes mixed by metallic;
 * the dielectric's fresnel_mix of KHR_materials_specular, (1 − weight × max(F)) × base + weight × F × specular; its
 * iridescent twin by KHR_materials_iridescence's rgb_mix, mixed in by weight; the diffuse Lambert or EON at
 * diffuse_roughness, and KHR_materials_diffuse_transmission's BTDF for a light behind the surface (seen through its
 * mirror direction); the sheen lobe over all of it with its albedo scaling, min(1 − max(c)·E(n·v), 1 − max(c)·E(n·l));
 * each specular lobe compensated on direct light with E at the material's roughness. `retro` mixes in, by its amount,
 * the specular lobe with v mirrored about n (Material: retroreflection).
 */
export function brdfCos(m: Lobes, fr: Frame, v: V3, l: V3, retro = 0, eonCompensated = true): Rgb {
  const n = fr.n; const nv = dot(n, v); const nlRaw = dot(n, l);
  if (nv <= 0) return [0, 0, 0];
  const back = nlRaw < 0;
  if (back && !m.translucency) return [0, 0, 0];
  const ls: V3 = back ? sub(l, scale(n, 2 * nlRaw)) : l;
  const nl = Math.abs(nlRaw);
  if (nl <= 0) return [0, 0, 0];
  const a = Math.max(m.roughness * m.roughness, 1e-7);
  const E = albedoOf(a)(nv);
  const f0 = dielectricF0(m);
  const specOf = (vv: V3): number => {
    const h = unit(add(ls, vv));
    if (m.anisotropy && m.anisotropy.strength > 0) {
      const c = Math.cos(m.anisotropy.rotation); const s = Math.sin(m.anisotropy.rotation);
      const t = unit(add(scale(fr.t, c), scale(fr.b, s))); const b = cross(n, t);
      return anisoDV(t, b, n, h, vv, ls, a + (1 - a) * sq(m.anisotropy.strength), a);
    }
    return ggxD(Math.max(dot(n, h), 0), a) * smithV(nl, Math.max(dot(n, vv), 1e-7), a);
  };
  // Retroreflection mixes, by its amount, the lobe with the same lobe at v mirrored about n, each with its own half
  // vector's Fresnel (Material: retroreflection).
  const mirrored: V3 = sub(scale(n, 2 * nv), v);
  const h = unit(add(ls, v)); const vh = Math.max(dot(v, h), 0);
  const hr = unit(add(ls, mirrored)); const vhr = Math.max(dot(mirrored, hr), 0);
  const dvView = back ? 0 : specOf(v); const dvMirror = back || retro === 0 ? 0 : specOf(mirrored);
  const fOf = (f: number): number => (1 - retro) * schlick(f, 1, vh) + retro * schlick(f, 1, vhr);
  const lobe = (f: number): number => (1 - retro) * dvView * schlick(f, 1, vh) + retro * dvMirror * schlick(f, 1, vhr);
  const diffuse: Rgb = back
    ? map3((i) => (m.translucency!.amount * m.translucency!.color[i]!) / Math.PI)
    : m.diffuseRoughness > 0
      ? eon(m.base, m.diffuseRoughness, n, ls, v, eonCompensated).map((c) => c * (1 - (m.translucency?.amount ?? 0))) as Rgb
      : map3((i) => (m.base[i]! / Math.PI) * (1 - (m.translucency?.amount ?? 0)));
  const fd = map3((i) => m.specular * fOf(f0[i]!));
  const comp = (f: number): number => 1 + f * (1 / E - 1);
  let dielectric = map3((i) => (1 - max3(fd)) * diffuse[i]! + m.specular * lobe(f0[i]!) * comp(m.specular * f0[i]!));
  if (m.iridescence && m.iridescence.weight > 0) {
    // rgb_mix(base, layer, F_iridescence) with F at v·h (KHR_materials_iridescence); retroreflection doesn't mix in here.
    const fi = iridescence(1, m.iridescence.ior, vh, m.iridescence.thickness, f0);
    const irid = map3((i) => (1 - max3(fi)) * diffuse[i]! + fi[i]! * dvView * comp(fi[i]!));
    dielectric = map3((i) => (1 - m.iridescence!.weight) * dielectric[i]! + m.iridescence!.weight * irid[i]!);
  }
  const metal = map3((i) => lobe(m.base[i]!) * comp(m.base[i]!));
  let out = map3((i) => (1 - m.metallic) * dielectric[i]! + m.metallic * metal[i]!);
  if (m.sheen && max3(m.sheen.color) > 0) {
    const e = sheenE(m.sheen.roughness);
    const scaling = Math.min(1 - max3(m.sheen.color) * e(nv), 1 - max3(m.sheen.color) * e(nl));
    const lobe = back ? 0 : charlieD(m.sheen.roughness, Math.max(dot(n, h), 0)) * sheenV(nl, nv, m.sheen.roughness);
    out = map3((i) => m.sheen!.color[i]! * lobe + out[i]! * scaling);
  }
  return map3((i) => out[i]! * nl);
}

// ---------------------------------------------------------------------------------------------------
// Transmission in raster (KHR_materials_transmission, _volume, _dispersion; the glTF Sample Viewer's model, which the
// design's "samples a copy of the opaque scene … at a level its roughness sets" follows: README: Assumed surfaces).

/** GLSL's refract(I, N, eta), or null under total internal reflection. */
export function refract(i: V3, n: V3, eta: number): V3 | null {
  const ni = dot(n, i); const k = 1 - eta * eta * (1 - ni * ni);
  return k < 0 ? null : sub(scale(i, eta), scale(n, eta * ni + Math.sqrt(k)));
}
/** The point a transmissive surface point `p` samples the copy at, for view ray `d`, normal `n`, `ior` and `thickness`
 * (m, in the world): p + normalize(refract(d, n, 1 ÷ ior)) × thickness; with thickness 0 (a thin wall), p itself. */
export function transmittedPoint(p: V3, d: V3, n: V3, ior: number, thickness: number): V3 {
  if (thickness <= 0) return p;
  const t = refract(d, n, 1 / ior);
  return t ? add(p, scale(unit(t), thickness)) : p;
}
/** Each channel's IOR under dispersion (Material: ior − s, ior, ior + s with s = (ior − 1) × 0.025 × dispersion). */
export const channelIors = (ior: number, dispersion: number): Rgb => { const s = (ior - 1) * 0.025 * dispersion; return [ior - s, ior, ior + s]; };
/** Beer-Lambert: the attenuation color raised to path ÷ distance (KHR_materials_volume). */
export const attenuation = (color: Rgb, distance: number, path: number): Rgb =>
  map3((i) => (Number.isFinite(distance) && distance > 0 ? Math.pow(color[i]!, path / distance) : 1));
/** The copy's mip level at roughness r: log2(the copy's larger side) × r × clamp(2·ior − 2, 0, 1). */
export const transmissionLod = (size: [number, number], roughness: number, ior: number): number =>
  Math.log2(Math.max(size[0], size[1])) * roughness * Math.min(Math.max(2 * ior - 2, 0), 1);

/** A linear RGB image: rows top-down. */
export interface Plane { width: number; height: number; data: Float64Array }
export const planeAt = (p: Plane, x: number, y: number): Rgb => { const o = (y * p.width + x) * 3; return [p.data[o]!, p.data[o + 1]!, p.data[o + 2]!]; };
/** A mip chain: each level the 2 × 2 box average of the one above (an odd last row or column averaged with its edge). */
export function mips(p: Plane): Plane[] {
  const out = [p];
  while (out.at(-1)!.width > 1 || out.at(-1)!.height > 1) {
    const a = out.at(-1)!; const w = Math.max(1, a.width >> 1); const h = Math.max(1, a.height >> 1);
    const data = new Float64Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const sx = Math.min(2 * x + dx, a.width - 1); const sy = Math.min(2 * y + dy, a.height - 1);
        s += a.data[(sy * a.width + sx) * 3 + c]!;
      }
      data[(y * w + x) * 3 + c] = s / 4;
    }
    out.push({ width: w, height: h, data });
  }
  return out;
}
function bilinear(p: Plane, u: number, v: number): Rgb {
  const x = u * p.width - 0.5; const y = v * p.height - 0.5;
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const at = (xx: number, yy: number): Rgb => planeAt(p, Math.min(Math.max(xx, 0), p.width - 1), Math.min(Math.max(yy, 0), p.height - 1));
  const [a, b, c, d] = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
  return map3((i) => (a[i]! * (1 - fx) + b[i]! * fx) * (1 - fy) + (c[i]! * (1 - fx) + d[i]! * fx) * fy);
}
/** A trilinear lookup of the chain at uv (0..1, top-left origin) and level `lod`. */
export function trilinear(chain: Plane[], u: number, v: number, lod: number): Rgb {
  const l = Math.min(Math.max(lod, 0), chain.length - 1);
  const l0 = Math.floor(l); const f = l - l0;
  const a = bilinear(chain[l0]!, u, v);
  if (f === 0 || l0 + 1 >= chain.length) return a;
  const b = bilinear(chain[l0 + 1]!, u, v);
  return map3((i) => a[i]! * (1 - f) + b[i]! * f);
}

// ---------------------------------------------------------------------------------------------------
// Flakes (Material: flakes): cubes of `size` in the part's own space, each flake's normal tilted from the shading normal
// by an angle whose cosine is uniform from cos tilt to 1 and a direction, both from hash(the part's seed, the cell).

/** The base's 32-bit seed hash: FNV-1a over a value's JSON text (crates/deep-canvas-scene3d light.rs `seed`). */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}
/** The base shader's seeded integer hash of a cell to [0, 1) (scene3d.wgsl `hash3`), exactly, in integers. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul(seed >>> 0, 2654435761 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 16777216;
}
/** Duff et al.'s orthonormal basis about unit n. */
export function onb(n: V3): [V3, V3] {
  const s = n[2] >= 0 ? 1 : -1; const a = -1 / (s + n[2]); const b = n[0] * n[1] * a;
  return [[1 + s * n[0] * n[0] * a, s * b, -s * n[0]], [b, s + n[1] * n[1] * a, -n[1]]];
}
/** A cell's flake normal in the part's own space about the part-space shading normal `n` (README: Assumed surfaces). */
export function flakeNormal(cell: V3, seed: number, tiltDeg: number, n: V3): V3 {
  const u1 = hash3(cell[0], cell[1], cell[2], seed); const u2 = hash3(cell[0], cell[1], cell[2], (seed + 1) >>> 0);
  const ct = 1 - u1 * (1 - Math.cos(rad(tiltDeg))); const st = Math.sqrt(Math.max(0, 1 - ct * ct)); const ph = 2 * Math.PI * u2;
  const [t, b] = onb(n);
  return unit(add(add(scale(t, st * Math.cos(ph)), scale(b, st * Math.sin(ph))), scale(n, ct)));
}
/** The angle from a GGX lobe's peak at which D falls to half of it: sin²θ = (√2 − 1)·α² ÷ (1 − α²). */
export const halfMaxAngle = (a: number): number => Math.asin(Math.sqrt(((Math.SQRT2 - 1) * a * a) / (1 - a * a)));

// ---------------------------------------------------------------------------------------------------
// sRGB, the 8-bit final target's encoding under tone map none.

export const srgb = (x: number): number => { const c = Math.min(Math.max(x, 0), 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export const code = (x: number): number => Math.round(srgb(x) * 255);
export const fromSrgb = (c: number): number => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };

// ---------------------------------------------------------------------------------------------------
// PNG: the renderer's targets, and a glTF's own images (8-bit grey, RGB, palette, grey-alpha or RGBA, no interlace).

export interface Image { width: number; height: number; rgba: Uint8Array; channels: number }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Uint8Array): Image {
  const buf = Buffer.from(file);
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0; let palette = Buffer.alloc(0);
  const data: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at); const type = buf.toString('latin1', at + 4, at + 8); const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (depth !== 8 || channels === undefined || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4; const s = x * channels;
      const px = color === 0 ? [line[s]!, line[s]!, line[s]!, 255] : color === 4 ? [line[s]!, line[s]!, line[s]!, line[s + 1]!]
        : color === 3 ? [palette[line[s]! * 3]!, palette[line[s]! * 3 + 1]!, palette[line[s]! * 3 + 2]!, 255]
          : [line[s]!, line[s + 1]!, line[s + 2]!, channels === 4 ? line[s + 3]! : 255];
      rgba.set(px, o);
    }
    previous = line;
  }
  return { width, height, rgba, channels: color === 6 || color === 4 ? 4 : 3 };
}

// ---------------------------------------------------------------------------------------------------
// glTF: a file's own JSON, accessors, node transforms and images.

export interface Gltf { json: JsonObject; bin: Buffer; files: Record<string, Buffer> }
export function readGltf(bytes: Buffer, files: Record<string, Buffer> = {}): Gltf {
  if (bytes.subarray(0, 4).toString('latin1') !== 'glTF') return { json: JSON.parse(bytes.toString('utf8')) as JsonObject, bin: Buffer.alloc(0), files };
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString('utf8')) as JsonObject;
  const at = 20 + jsonLen;
  const bin = at + 8 <= bytes.length ? bytes.subarray(at + 8, at + 8 + bytes.readUInt32LE(at)) : Buffer.alloc(0);
  return { json, bin, files };
}
export const list = (g: Gltf, key: string): JsonObject[] => ((g.json[key] as JsonValue[] | undefined) ?? []) as JsonObject[];
function viewBytes(g: Gltf, i: number): Buffer {
  const v = list(g, 'bufferViews')[i]!;
  const b = list(g, 'buffers')[v['buffer'] as number]!;
  const buf = typeof b['uri'] === 'string' ? g.files[b['uri']]! : g.bin;
  const off = (v['byteOffset'] as number | undefined) ?? 0;
  return buf.subarray(off, off + (v['byteLength'] as number));
}
export function imageBytes(g: Gltf, i: number): Buffer {
  const im = list(g, 'images')[i]!;
  return typeof im['uri'] === 'string' ? g.files[im['uri']]! : viewBytes(g, im['bufferView'] as number);
}
const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
export function accessor(g: Gltf, i: number): number[][] {
  const a = list(g, 'accessors')[i]!;
  const view = list(g, 'bufferViews')[a['bufferView'] as number]!;
  const bytes = viewBytes(g, a['bufferView'] as number);
  const w = WIDTH[a['type'] as string]!; const ct = a['componentType'] as number;
  const size = ct === 5126 || ct === 5125 ? 4 : ct === 5123 || ct === 5122 ? 2 : 1;
  const stride = (view['byteStride'] as number | undefined) ?? w * size;
  const base = (a['byteOffset'] as number | undefined) ?? 0;
  const norm = a['normalized'] === true;
  const read = (o: number): number => {
    if (ct === 5126) return bytes.readFloatLE(o);
    if (ct === 5125) return bytes.readUInt32LE(o);
    if (ct === 5123) return norm ? bytes.readUInt16LE(o) / 65535 : bytes.readUInt16LE(o);
    if (ct === 5122) return norm ? Math.max(bytes.readInt16LE(o) / 32767, -1) : bytes.readInt16LE(o);
    if (ct === 5121) return norm ? bytes[o]! / 255 : bytes[o]!;
    return norm ? Math.max(bytes.readInt8(o) / 127, -1) : bytes.readInt8(o);
  };
  const rows: number[][] = [];
  for (let r = 0; r < (a['count'] as number); r++) rows.push(Array.from({ length: w }, (_, k) => read(base + r * stride + k * size)));
  return rows;
}
export type M34 = [[number, number, number, number], [number, number, number, number], [number, number, number, number]];
const IDENTITY: M34 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
export function mul(a: M34, b: M34): M34 {
  return [0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]! + (j === 3 ? a[i]![3]! : 0))) as M34;
}
export const apply = (m: M34, p: readonly number[]): V3 => [0, 1, 2].map((i) => m[i]![0]! * p[0]! + m[i]![1]! * p[1]! + m[i]![2]! * p[2]! + m[i]![3]!) as V3;
export const applyDir = (m: M34, p: readonly number[]): V3 => [0, 1, 2].map((i) => m[i]![0]! * p[0]! + m[i]![1]! * p[1]! + m[i]![2]! * p[2]!) as V3;
export const det = (a: M34): number =>
  a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
/** The inverse transpose of a matrix's 3 × 3 part applied to a normal. */
function normalTo(m: M34, n: readonly number[]): V3 {
  const [a, b, c] = [m[0], m[1], m[2]];
  const cof: V3[] = [
    [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]],
    [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]],
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  ];
  return unit([0, 1, 2].map((i) => cof[0]![i]! * n[0]! + cof[1]![i]! * n[1]! + cof[2]![i]! * n[2]!) as V3);
}
function localOf(n: JsonObject): M34 {
  if (Array.isArray(n['matrix'])) { const c = n['matrix'] as number[]; return [[c[0]!, c[4]!, c[8]!, c[12]!], [c[1]!, c[5]!, c[9]!, c[13]!], [c[2]!, c[6]!, c[10]!, c[14]!]]; }
  const [x, y, z, w] = (n['rotation'] as number[] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (n['scale'] as number[] | undefined) ?? [1, 1, 1];
  const [tx, ty, tz] = (n['translation'] as number[] | undefined) ?? [0, 0, 0];
  const r = [
    [1 - 2 * (y! * y! + z! * z!), 2 * (x! * y! - z! * w!), 2 * (x! * z! + y! * w!)],
    [2 * (x! * y! + z! * w!), 1 - 2 * (x! * x! + z! * z!), 2 * (y! * z! - x! * w!)],
    [2 * (x! * z! - y! * w!), 2 * (y! * z! + x! * w!), 1 - 2 * (x! * x! + y! * y!)],
  ];
  const t = [tx!, ty!, tz!];
  return [0, 1, 2].map((i) => [r[i]![0]! * sx!, r[i]![1]! * sy!, r[i]![2]! * sz!, t[i]!]) as M34;
}
/** Every node of the file's scene with its world matrix (parent × local). */
export function worlds(g: Gltf): Map<number, M34> {
  const nodes = list(g, 'nodes'); const out = new Map<number, M34>();
  const walk = (i: number, parent: M34): void => {
    const w = mul(parent, localOf(nodes[i]!)); out.set(i, w);
    for (const c of ((nodes[i]!['children'] as number[] | undefined) ?? [])) walk(c, w);
  };
  const scene = list(g, 'scenes')[(g.json['scene'] as number | undefined) ?? 0]!;
  for (const root of scene['nodes'] as number[]) walk(root, IDENTITY);
  return out;
}
export const nodeName = (g: Gltf, i: number): string => (list(g, 'nodes')[i]!['name'] as string | undefined) ?? String(i);

// ---------------------------------------------------------------------------------------------------
// A glTF material as the references read it (glTF 2.0 and the KHR_materials_* texts, their defaults).

export interface TexRef { image: number; uv: number; offset: [number, number]; scale: [number, number]; rotation: number }
export interface GltfMaterial {
  index: number; name: string; lobes: Lobes; unlit: boolean; doubleSided: boolean;
  transmission: number; thickness: number; attenuationColor: Rgb; attenuationDistance: number; dispersion: number;
  baseTexture: TexRef | null; normalTexture: TexRef | null; normalScale: number;
  /** Every texture the material samples other than base color and the normal map, by glTF property name. */
  otherTextures: string[];
}
const ext = (m: JsonObject, name: string): JsonObject | null => {
  const e = m['extensions'];
  return e && typeof e === 'object' && !Array.isArray(e) && e[name] && typeof e[name] === 'object' ? (e[name] as JsonObject) : null;
};
const rgbOf = (v: JsonValue | undefined, d: Rgb): Rgb => (Array.isArray(v) ? [Number(v[0]), Number(v[1]), Number(v[2])] : d);
const numOf = (v: JsonValue | undefined, d: number): number => (typeof v === 'number' ? v : d);
export function gltfMaterial(g: Gltf, i: number): GltfMaterial {
  const m = list(g, 'materials')[i] ?? {};
  const pbr = (m['pbrMetallicRoughness'] as JsonObject | undefined) ?? {};
  const textures = list(g, 'textures');
  const tex = (info: JsonValue | undefined): TexRef | null => {
    if (!info || typeof info !== 'object' || Array.isArray(info) || typeof info['index'] !== 'number') return null;
    const tt = ext(info, 'KHR_texture_transform') ?? {};
    return {
      image: textures[info['index']]!['source'] as number, uv: numOf(tt['texCoord'], numOf(info['texCoord'], 0)),
      offset: (tt['offset'] as [number, number] | undefined) ?? [0, 0], scale: (tt['scale'] as [number, number] | undefined) ?? [1, 1], rotation: numOf(tt['rotation'], 0),
    };
  };
  const other: string[] = [];
  if (pbr['metallicRoughnessTexture']) other.push('metallicRoughnessTexture');
  if (m['emissiveTexture']) other.push('emissiveTexture');
  for (const [name, body] of Object.entries((m['extensions'] as JsonObject | undefined) ?? {})) {
    for (const [k, v] of Object.entries((body as JsonObject | null) ?? {})) if (v && typeof v === 'object' && !Array.isArray(v) && typeof v['index'] === 'number') other.push(`${name}/${k}`);
  }
  const sheen = ext(m, 'KHR_materials_sheen'); const aniso = ext(m, 'KHR_materials_anisotropy'); const dt = ext(m, 'KHR_materials_diffuse_transmission');
  const spec = ext(m, 'KHR_materials_specular'); const irid = ext(m, 'KHR_materials_iridescence'); const vol = ext(m, 'KHR_materials_volume');
  const sheenColor = rgbOf(sheen?.['sheenColorFactor'], [0, 0, 0]);
  return {
    index: i, name: (m['name'] as string | undefined) ?? String(i), unlit: ext(m, 'KHR_materials_unlit') !== null, doubleSided: m['doubleSided'] === true,
    lobes: {
      base: rgbOf(pbr['baseColorFactor'], [1, 1, 1]), metallic: numOf(pbr['metallicFactor'], 1), roughness: numOf(pbr['roughnessFactor'], 1),
      specular: numOf(spec?.['specularFactor'], 1), specularColor: rgbOf(spec?.['specularColorFactor'], [1, 1, 1]), ior: numOf(ext(m, 'KHR_materials_ior')?.['ior'], 1.5),
      sheen: sheen && max3(sheenColor) > 0 ? { color: sheenColor, roughness: numOf(sheen['sheenRoughnessFactor'], 0) } : null,
      anisotropy: aniso ? { strength: numOf(aniso['anisotropyStrength'], 0), rotation: numOf(aniso['anisotropyRotation'], 0) } : null,
      translucency: dt ? { amount: numOf(dt['diffuseTransmissionFactor'], 0), color: rgbOf(dt['diffuseTransmissionColorFactor'], [1, 1, 1]) } : null,
      iridescence: irid ? { weight: numOf(irid['iridescenceFactor'], 0), ior: numOf(irid['iridescenceIor'], 1.3), thickness: numOf(irid['iridescenceThicknessMaximum'], 400) } : null,
      diffuseRoughness: numOf(ext(m, 'KHR_materials_diffuse_roughness')?.['diffuseRoughnessFactor'], 0),
    },
    transmission: numOf(ext(m, 'KHR_materials_transmission')?.['transmissionFactor'], 0),
    thickness: numOf(vol?.['thicknessFactor'], 0), attenuationColor: rgbOf(vol?.['attenuationColor'], [1, 1, 1]), attenuationDistance: numOf(vol?.['attenuationDistance'], Infinity),
    dispersion: numOf(ext(m, 'KHR_materials_dispersion')?.['dispersion'], 0),
    baseTexture: tex(pbr['baseColorTexture']), normalTexture: tex(m['normalTexture']),
    normalScale: numOf((m['normalTexture'] as JsonObject | undefined)?.['scale'], 1), otherTextures: other,
  };
}

// ---------------------------------------------------------------------------------------------------
// A ray tracer over a sample's own triangles (scene 0, node world transforms, the accessors' normals, tangents and
// UVs), with a bounding-volume hierarchy, plus flat boxes the test adds (its backdrop).

export interface Tri {
  p: [V3, V3, V3]; n: [V3, V3, V3]; t: [V3, V3, V3] | null; tw: number;
  uv: [[number, number], [number, number], [number, number]][]; node: number; material: number; scale: number;
  /** The node's world determinant is negative, so its winding turns over (glTF: front faces follow the determinant). */
  mirrored: boolean;
}
export interface Hit { tri: Tri; t: number; p: V3; n: V3; geo: V3; front: boolean; uv: [number, number][]; tangent: V3 | null; bw: [number, number, number] }
interface Node { lo: V3; hi: V3; left: Node | null; right: Node | null; tris: Tri[] }
function bounds(tris: Tri[]): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t.p) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]!); hi[k] = Math.max(hi[k]!, p[k]!); }
  return { lo, hi };
}
function build(tris: Tri[]): Node {
  const { lo, hi } = bounds(tris);
  if (tris.length <= 8) return { lo, hi, left: null, right: null, tris };
  const axis = [0, 1, 2].reduce((a, k) => (hi[k]! - lo[k]! > hi[a]! - lo[a]! ? k : a), 0);
  const c = (t: Tri): number => t.p[0][axis]! + t.p[1][axis]! + t.p[2][axis]!;
  const sorted = [...tris].sort((a, b) => c(a) - c(b));
  const mid = sorted.length >> 1;
  return { lo, hi, left: build(sorted.slice(0, mid)), right: build(sorted.slice(mid)), tris: [] };
}
function slab(o: V3, inv: V3, lo: V3, hi: V3, best: number): boolean {
  let t0 = 0; let t1 = best;
  for (let k = 0; k < 3; k++) {
    let a = (lo[k]! - o[k]!) * inv[k]!; let b = (hi[k]! - o[k]!) * inv[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
export interface Traced { root: Node; materials: Map<number, GltfMaterial>; tris: Tri[] }
/** The sample's triangles in world metres (scene 0 at the origin), and `extra` (the test's own backdrop). */
export function traceable(g: Gltf, extra: Tri[] = []): Traced {
  const tris: Tri[] = [...extra];
  const materials = new Map<number, GltfMaterial>();
  for (const [ni, w] of worlds(g)) {
    const mesh = list(g, 'nodes')[ni]!['mesh'];
    if (typeof mesh !== 'number') continue;
    const d = det(w); const s = Math.cbrt(Math.abs(d));
    for (const prim of list(g, 'meshes')[mesh]!['primitives'] as JsonObject[]) {
      if ((prim['mode'] ?? 4) !== 4) continue;
      const at = prim['attributes'] as JsonObject;
      const mi = typeof prim['material'] === 'number' ? prim['material'] : -1;
      if (!materials.has(mi)) materials.set(mi, gltfMaterial(g, mi));
      const pos = accessor(g, at['POSITION'] as number).map((q) => apply(w, q));
      const nor = typeof at['NORMAL'] === 'number' ? accessor(g, at['NORMAL']).map((q) => normalTo(w, q)) : null;
      const tan = typeof at['TANGENT'] === 'number' ? accessor(g, at['TANGENT']) : null;
      const uvs = [0, 1].map((k) => (typeof at[`TEXCOORD_${k}`] === 'number' ? accessor(g, at[`TEXCOORD_${k}`] as number) : null));
      const idx = typeof prim['indices'] === 'number' ? accessor(g, prim['indices']).map((r) => r[0]!) : pos.map((_, k) => k);
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const ids = [idx[k]!, idx[k + 1]!, idx[k + 2]!] as const;
        const p = ids.map((j) => pos[j]!) as [V3, V3, V3];
        const geo = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
        tris.push({
          p, n: (nor ? ids.map((j) => nor[j]!) : [geo, geo, geo]) as [V3, V3, V3],
          t: tan ? (ids.map((j) => unit(applyDir(w, tan[j]!))) as [V3, V3, V3]) : null, tw: tan ? Math.sign(tan[ids[0]]![3]!) * Math.sign(d) : 1,
          uv: uvs.map((u) => (u ? ids.map((j) => [u[j]![0]!, u[j]![1]!]) : [[0, 0], [0, 0], [0, 0]])) as [[number, number], [number, number], [number, number]][],
          node: ni, material: mi, scale: s, mirrored: d < 0,
        });
      }
    }
  }
  return { root: build(tris), materials, tris };
}
/** An axis-aligned rectangle facing +Z at depth z, as two triangles: a backdrop the test adds. `node` is negative. */
export function quad(x0: number, y0: number, x1: number, y1: number, z: number, node: number, material: number): Tri[] {
  const n: V3 = [0, 0, 1];
  const uv = (): Tri['uv'][number] => [[0, 0], [0, 0], [0, 0]];
  const t = (a: V3, b: V3, c: V3): Tri => ({ p: [a, b, c], n: [n, n, n], t: null, tw: 1, uv: [uv(), uv()], node, material, scale: 1, mirrored: false });
  return [t([x0, y0, z], [x1, y0, z], [x1, y1, z]), t([x0, y0, z], [x1, y1, z], [x0, y1, z])];
}
/** The nearest hit along o + t·d that `keep` accepts (single-sided back faces are skipped by the caller's `keep`). */
export function trace(s: Traced, o: V3, d: V3, keep: (h: Hit) => boolean): Hit | null {
  const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  let best: Hit | null = null;
  const stack: Node[] = [s.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (!slab(o, inv, node.lo, node.hi, best ? best.t : Infinity)) continue;
    if (node.left) { stack.push(node.left, node.right!); continue; }
    for (const tri of node.tris) {
      const e1 = sub(tri.p[1], tri.p[0]); const e2 = sub(tri.p[2], tri.p[0]);
      const pv = cross(d, e2); const dt = dot(e1, pv);
      if (Math.abs(dt) < 1e-14) continue;
      const tv = sub(o, tri.p[0]); const u = dot(tv, pv) / dt; if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1); const v = dot(d, qv) / dt; if (v < 0 || u + v > 1) continue;
      const t = dot(e2, qv) / dt; if (t <= 1e-9 || (best && t >= best.t)) continue;
      const bw: [number, number, number] = [1 - u - v, u, v];
      const geo = unit(cross(e1, e2));
      const front = (dot(geo, d) < 0) !== tri.mirrored;
      const ni = unit(add(add(scale(tri.n[0], bw[0]), scale(tri.n[1], bw[1])), scale(tri.n[2], bw[2])));
      const h: Hit = {
        tri, t, p: add(o, scale(d, t)), n: ni, geo, front, bw,
        uv: tri.uv.map((q) => [q[0][0] * bw[0] + q[1][0] * bw[1] + q[2][0] * bw[2], q[0][1] * bw[0] + q[1][1] * bw[1] + q[2][1] * bw[2]] as [number, number]),
        tangent: tri.t ? unit(add(add(scale(tri.t[0], bw[0]), scale(tri.t[1], bw[1])), scale(tri.t[2], bw[2]))) : null,
      };
      if (keep(h)) best = h;
    }
  }
  return best;
}
/** The frame a hit shades in: its normal (flipped to face the viewer on a double-sided back face) and a tangent frame,
 * from the file's TANGENT (w the handedness) or, without one, from the triangle's uv0 gradient, Gram-Schmidt against n. */
export function frameOf(h: Hit, doubleSided: boolean): Frame {
  let n = h.n;
  if (!h.front && doubleSided) n = scale(n, -1);
  let t: V3; let w = h.tri.tw;
  if (h.tangent) t = h.tangent;
  else {
    const [a, b, c] = h.tri.uv[0]!; const e1 = sub(h.tri.p[1], h.tri.p[0]); const e2 = sub(h.tri.p[2], h.tri.p[0]);
    const du1 = b[0] - a[0]; const dv1 = b[1] - a[1]; const du2 = c[0] - a[0]; const dv2 = c[1] - a[1];
    const r = du1 * dv2 - du2 * dv1;
    t = Math.abs(r) > 1e-20 ? scale(sub(scale(e1, dv2), scale(e2, dv1)), 1 / r) : onb(n)[0];
    const bt = Math.abs(r) > 1e-20 ? scale(sub(scale(e2, du1), scale(e1, du2)), 1 / r) : onb(n)[1];
    w = dot(cross(n, t), bt) < 0 ? -1 : 1;
  }
  t = unit(sub(t, scale(n, dot(n, t))));
  return { n, t, b: scale(cross(n, t), w) };
}

/** A decoded texture and its bilinear lookup at uv (glTF: v down, texel centres at (i + 0.5) ÷ size), wrapping. */
export interface Texture { image: Image; srgb: boolean }
export function sampleTexture(tx: Texture, u: number, v: number): Rgb {
  const { width, height, rgba } = tx.image;
  const x = u * width - 0.5; const y = v * height - 0.5;
  const x0 = Math.floor(x); const y0 = Math.floor(y); const fx = x - x0; const fy = y - y0;
  const wrap = (i: number, n: number): number => ((i % n) + n) % n;
  const at = (xx: number, yy: number): Rgb => {
    const o = (wrap(yy, height) * width + wrap(xx, width)) * 4;
    return map3((c) => (tx.srgb ? fromSrgb(rgba[o + c]!) : rgba[o + c]! / 255));
  };
  const [a, b, c, d] = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
  return map3((i) => (a[i]! * (1 - fx) + b[i]! * fx) * (1 - fy) + (c[i]! * (1 - fx) + d[i]! * fx) * fy);
}
/** A texture reference's uv after KHR_texture_transform (offset and scale; a rotated map isn't read by the references). */
export const transformed = (r: TexRef, uv: [number, number]): [number, number] => [r.offset[0] + r.scale[0] * uv[0], r.offset[1] + r.scale[1] * uv[1]];

// ---------------------------------------------------------------------------------------------------
// A Khronos sample's CPU reference per pixel (README: Readings, "within 1% of a CPU reference of the same lobes"): the
// orthographic view the test draws, the sample's own triangles and materials, the test's backdrop and lights. Each
// pixel's reference is the lobes at the ray through its centre; a pixel is judged only where the reference is exact for
// any correct renderer: inside one node, its material's inputs all read here, the specular lobe wider than the pixel,
// every texture magnified, a normal map's tangent-frame convention immaterial, and a transmissive pixel's copy flat.

export interface SunLight { toward: V3; illuminance: number; color: Rgb }
export interface SampleSetup {
  view: Ortho; lights: SunLight[];
  /** The test's backdrop triangles (node −1) and their unlit color at a point. */
  backdrop: Tri[]; backdropColor: (p: V3) => Rgb;
  /** Textures by glTF image index, decoded. */
  textures: Map<number, Texture>;
  /** The materials whose pixels are judged (by glTF index); others draw but aren't judged. */
  judged: Set<number>;
}
export interface RefPixel { x: number; y: number; node: number; material: number; value: Rgb; judged: boolean; why: string }
const RAY_Z = 1000;
function baryOnPlane(tri: Tri, o: V3, d: V3): [number, number, number] {
  const e1 = sub(tri.p[1], tri.p[0]); const e2 = sub(tri.p[2], tri.p[0]);
  const pv = cross(d, e2); const dt = dot(e1, pv);
  const tv = sub(o, tri.p[0]); const u = dot(tv, pv) / dt; const qv = cross(tv, e1); const v = dot(d, qv) / dt;
  return [1 - u - v, u, v];
}
const interp = (t: Tri, bw: readonly number[], k: 'n'): V3 => unit(add(add(scale(t[k][0], bw[0]!), scale(t[k][1], bw[1]!)), scale(t[k][2], bw[2]!)));
const uvAt = (t: Tri, set: number, bw: readonly number[]): [number, number] => {
  const q = t.uv[set]!; return [q[0][0] * bw[0]! + q[1][0] * bw[1]! + q[2][0] * bw[2]!, q[0][1] * bw[0]! + q[1][1] * bw[1]! + q[2][1] * bw[2]!];
};
/** Schüler's cotangent frame from the triangle's position and uv0 gradients about n: the other per-pixel convention. */
function cotangentFrame(tri: Tri, n: V3): Frame {
  const dp1 = sub(tri.p[1], tri.p[0]); const dp2 = sub(tri.p[2], tri.p[0]);
  const [a, b, c] = tri.uv[0]!; const du1 = [b[0] - a[0], b[1] - a[1]]; const du2 = [c[0] - a[0], c[1] - a[1]];
  const p2 = cross(dp2, n); const p1 = cross(n, dp1);
  const t = add(scale(p2, du1[0]!), scale(p1, du2[0]!)); const bt = add(scale(p2, du1[1]!), scale(p1, du2[1]!));
  const k = 1 / Math.sqrt(Math.max(dot(t, t), dot(bt, bt)));
  return { n, t: scale(t, k), b: scale(bt, k) };
}
/** The normal map's perturbed normal in a frame (glTF: (2c − 1), xy × scale, normalized; TBN by the frame's axes). */
function perturbed(fr: Frame, c: Rgb, s: number): V3 {
  const q: V3 = [(2 * c[0] - 1) * s, (2 * c[1] - 1) * s, 2 * c[2] - 1];
  return unit(add(add(scale(fr.t, q[0]), scale(fr.b, q[1])), scale(fr.n, q[2])));
}
export function sampleReference(tr: Traced, s: SampleSetup, pixels: Iterable<[number, number]>): RefPixel[] {
  const v: V3 = [0, 0, 1]; const d: V3 = [0, 0, -1];
  const visible = (h: Hit): boolean => h.tri.node < 0 || h.front || tr.materials.get(h.tri.material)!.doubleSided;
  const opaque = (h: Hit): boolean => visible(h) && (h.tri.node < 0 || tr.materials.get(h.tri.material)!.transmission <= 0);
  const rayAtPx = (px: number, py: number): V3 => orthoPoint(s.view, px, py, RAY_Z);
  // The copy of the opaque scene at a pixel: its colour where the whole pixel sees one flat colour, else null.
  const copyCache = new Map<number, Rgb | null>();
  const copyPixel = (i: number, j: number): Rgb | null => {
    const key = j * s.view.size[0] + i;
    if (copyCache.has(key)) return copyCache.get(key)!;
    let out: Rgb | null = null; let first = true;
    for (const [fx, fy] of [[0.5, 0.5], [0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]] as const) {
      const h = trace(tr, rayAtPx(i + fx, j + fy), d, opaque);
      let c: Rgb | null;
      if (!h) c = [0, 0, 0];
      else if (h.tri.node < 0) c = s.backdropColor(h.p);
      else { const m = tr.materials.get(h.tri.material)!; c = s.lights.length === 0 && !m.unlit ? [0, 0, 0] : null; }
      if (c === null || (!first && (c[0] !== out![0] || c[1] !== out![1] || c[2] !== out![2]))) { out = null; first = false; break; }
      out = c; first = false;
    }
    copyCache.set(key, out);
    return out;
  };
  const copyAt = (qx: number, qy: number): Rgb | null => {
    const x0 = Math.floor(qx - 0.5); const y0 = Math.floor(qy - 0.5);
    const cs = [copyPixel(x0, y0), copyPixel(x0 + 1, y0), copyPixel(x0, y0 + 1), copyPixel(x0 + 1, y0 + 1)];
    if (cs.some((c) => c === null)) return null;
    const a = cs[0]!;
    return cs.every((c) => c![0] === a[0] && c![1] === a[1] && c![2] === a[2]) ? a : null;
  };
  const out: RefPixel[] = [];
  for (const [x, y] of pixels) {
    const o = rayAtPx(x + 0.5, y + 0.5);
    const h = trace(tr, o, d, visible);
    if (!h || h.tri.node < 0) { out.push({ x, y, node: h ? -1 : -2, material: -1, value: h ? s.backdropColor(h.p) : [0, 0, 0], judged: false, why: 'backdrop' }); continue; }
    const m = tr.materials.get(h.tri.material)!;
    const px: RefPixel = { x, y, node: h.tri.node, material: m.index, value: [0, 0, 0], judged: s.judged.has(m.index), why: '' };
    out.push(px);
    const no = (why: string): void => { px.judged = false; px.why = why; };
    if (m.unlit) { px.value = m.lobes.base; no('unlit'); continue; }
    const fr = frameOf(h, m.doubleSided);
    if (m.transmission > 0) {
      // (1 − F(n·v)) × base × the volume's attenuation × the copy at each channel's transmitted point.
      const f0 = dielectricF0(m.lobes);
      const nv = Math.max(dot(fr.n, v), 0);
      const w = 1 - max3(f0.map((f) => m.lobes.specular * schlick(f, 1, nv)));
      const att = attenuation(m.attenuationColor, m.attenuationDistance, m.thickness * h.tri.scale);
      const iors = m.dispersion > 0 ? channelIors(m.lobes.ior, m.dispersion) : [m.lobes.ior, m.lobes.ior, m.lobes.ior];
      for (let c = 0; c < 3; c++) {
        const e = transmittedPoint(h.p, d, fr.n, iors[c]!, m.thickness * h.tri.scale);
        const [qx, qy] = orthoProject(s.view, e);
        const cp = copyAt(qx, qy);
        if (!cp) { no('copy not flat'); break; }
        px.value[c] = m.transmission * w * m.lobes.base[c]! * att[c]! * cp[c]!;
      }
      continue;
    }
    // Opaque lobes under the setup's suns.
    let lobes = m.lobes;
    const fx = baryOnPlane(h.tri, rayAtPx(x + 1.5, y + 0.5), d); const fy = baryOnPlane(h.tri, rayAtPx(x + 0.5, y + 1.5), d);
    if (m.otherTextures.length) no(`samples ${m.otherTextures.join(', ')}`);
    for (const [ref, name] of [[m.baseTexture, 'base color'], [m.normalTexture, 'normal map']] as const) {
      if (!ref) continue;
      const tx = s.textures.get(ref.image);
      if (!tx || ref.rotation !== 0) { no(`${name} not read`); continue; }
      const at = transformed(ref, h.uv[ref.uv]!);
      const ax = transformed(ref, uvAt(h.tri, ref.uv, fx)); const ay = transformed(ref, uvAt(h.tri, ref.uv, fy));
      const foot = Math.max(Math.hypot((ax[0] - at[0]) * tx.image.width, (ax[1] - at[1]) * tx.image.height), Math.hypot((ay[0] - at[0]) * tx.image.width, (ay[1] - at[1]) * tx.image.height));
      if (foot > 1) no(`${name} minified (${foot.toFixed(2)} texels a pixel)`);
      if (name === 'base color') { const c = sampleTexture(tx, at[0], at[1]); lobes = { ...lobes, base: map3((i) => lobes.base[i]! * c[i]!) }; }
    }
    const a = Math.max(m.lobes.roughness ** 2, 1e-7);
    // The anisotropic lobe's narrow axis keeps α (αb = α), so α bounds every lobe here.
    const dn = sq(length(sub(interp(h.tri, fx, 'n'), h.n))) + sq(length(sub(interp(h.tri, fy, 'n'), h.n)));
    if (dn >= (a * a) / 2) no(`lobe narrower than the pixel (α ${a.toFixed(4)}, |Δn|² ${dn.toExponential(2)})`);
    const shade = (f: Frame): Rgb => {
      const acc: Rgb = [0, 0, 0];
      for (const L of s.lights) { const b = brdfCos(lobes, f, v, L.toward); for (let i = 0; i < 3; i++) acc[i] = acc[i]! + b[i]! * L.illuminance * L.color[i]!; }
      return acc;
    };
    if (m.normalTexture && s.textures.has(m.normalTexture.image)) {
      const c = sampleTexture(s.textures.get(m.normalTexture.image)!, ...transformed(m.normalTexture, h.uv[m.normalTexture.uv]!));
      const fa = { ...fr, n: perturbed(fr, c, m.normalScale) }; const cf = cotangentFrame(h.tri, fr.n);
      const va = shade(fa); const vb = shade({ ...cf, n: perturbed(cf, c, m.normalScale) });
      px.value = va;
      if ([0, 1, 2].some((i) => Math.abs(va[i]! - vb[i]!) > 0.005 * Math.max(va[i]!, 1e-9))) no('tangent frame convention matters');
    } else px.value = shade(fr);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// AC3's dispersion line: where a thin vertical line behind a tilted slab shows in each channel along one row.

export interface TiltedSlab { center: V3; rotY: number; size: V3; thickness: number }
/** The frame column (pixel corners at integers) on row `py` where the slab shows a vertical line at world x `lineX`,
 * depth `lineZ`, for `ior`: where the projected transmitted point meets the line's own projection; null if none. */
export function lineColumn(cam: Pinhole, s: TiltedSlab, py: number, lineX: number, lineZ: number, ior: number): number | null {
  const n = rotate([0, s.rotY, 0], [0, 0, 1]);
  const face = add(s.center, rotate([0, s.rotY, 0], [0, 0, s.size[2] / 2]));
  const right = rotate([0, s.rotY, 0], [1, 0, 0]);
  const target = project(cam, [lineX, 0, lineZ])[0];
  const at = (x: number): number | null => {
    const d = rayAt(cam, x, py);
    const t = dot(sub(face, cam.position), n) / dot(d, n);
    if (!(t > 0)) return null;
    const p = add(cam.position, scale(d, t));
    if (Math.abs(dot(sub(p, face), right)) > s.size[0] / 2) return null;
    return project(cam, transmittedPoint(p, d, n, ior, s.thickness))[0] - target;
  };
  let lo = 0; let hi = cam.size[0]; let flo: number | null = null;
  // Scan for a sign change, then bisect.
  for (let x = 0; x < cam.size[0]; x += 1) {
    const f = at(x + 0.5);
    if (f === null) { flo = null; continue; }
    if (flo !== null && Math.sign(f) !== Math.sign(flo)) { lo = x - 0.5; hi = x + 0.5; break; }
    flo = f; lo = x + 0.5;
    if (x === cam.size[0] - 1) return null;
  }
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; const fm = at(mid); const fl = at(lo); if (fm === null || fl === null) return null; if (Math.sign(fm) === Math.sign(fl)) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
