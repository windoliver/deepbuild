// The reviewed CPU reference of the lobes AC1 names, from their published texts (REDRAFT.md: The CPU reference):
// glTF 2.0's metallic-roughness BRDF (Appendix B: GGX, height-correlated Smith, α = roughness², Schlick's Fresnel at
// v·h, the dielectric's fresnel_mix over a Lambertian diffuse at F0 0.04) with the design's compensation on direct
// light (Material: "× (1 + F0 × (1 ÷ E − 1)) on direct light, with E the table's directional albedo"), as #422's
// suite holds the base to; KHR_materials_sheen (the Charlie distribution, its Λ fit for visibility, and the albedo
// scaling of the layers below); KHR_materials_anisotropy (α_t = mix(α, 1, strength²), α_b = α, the anisotropic GGX
// and its height-correlated visibility along the tangent turned by the rotation); KHR_materials_diffuse_transmission
// (the diffuse lobe mixed by its factor with a Lambertian transmission of its color, for light from the back). Every
// number here is in f64; tables come from quadrature, never from the renderer.

import { add, cross, dot, scale, sub, unit, type Rgb, type V3 } from './helpers.ts';

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------------
// GGX (glTF 2.0, Appendix B)

export function ggxD(nh: number, a: number): number { const a2 = a * a; const d = nh * nh * (a2 - 1) + 1; return a2 / (Math.PI * d * d); }
export function smithV(nl: number, nv: number, a: number): number {
  const a2 = a * a;
  return 0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
}
/** E(μo, α): the directional albedo of the isotropic GGX lobe with F = 1, by a 1024 × 64 midpoint rule over the half
 * vector, importance-mapped by D (h's pdf is D(h)·(n·h)), as #422's suite computes it. */
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
/** A function of μ in [0, 1] tabulated at 129 points and read linearly. */
function table(f: (mu: number) => number): (mu: number) => number {
  const N = 128;
  const t = Array.from({ length: N + 1 }, (_, i) => f(Math.max(i / N, 5e-4)));
  return (mu) => { const x = Math.min(Math.max(mu, 0), 1) * N; const i = Math.min(Math.floor(x), N - 1); return t[i]! + (t[i + 1]! - t[i]!) * (x - i); };
}
const albedoTables = new Map<number, (mu: number) => number>();
/** E(μ) of the isotropic lobe at `roughness` (α = roughness²), the table the compensation reads. */
export function albedoAt(roughness: number): (mu: number) => number {
  let t = albedoTables.get(roughness);
  if (!t) { const a = roughness * roughness; t = table((mu) => albedo(mu, a)); albedoTables.set(roughness, t); }
  return t;
}

// ---------------------------------------------------------------------------------------------------
// KHR_materials_anisotropy: the anisotropic GGX and its height-correlated Smith visibility.

export function anisoD(nh: number, th: number, bh: number, at: number, ab: number): number {
  const s = (th * th) / (at * at) + (bh * bh) / (ab * ab) + nh * nh;
  return 1 / (Math.PI * at * ab * s * s);
}
export function anisoV(nl: number, nv: number, tv: number, bv: number, tl: number, bl: number, at: number, ab: number): number {
  const gv = nl * Math.hypot(at * tv, ab * bv, nv);
  const gl = nv * Math.hypot(at * tl, ab * bl, nl);
  return 0.5 / (gv + gl);
}

// ---------------------------------------------------------------------------------------------------
// KHR_materials_sheen: the Charlie distribution (Estevez and Kulla), its fitted Λ for visibility, and E by quadrature.

/** Sheen roughness r gives α_g = r² (clamped away from 0 as the extension's reference implementation does). */
const sheenAlpha = (r: number): number => Math.max(r, 1e-6) ** 2;
export function sheenD(nh: number, r: number): number {
  const inv = 1 / sheenAlpha(r);
  const sin2 = Math.max(0, 1 - nh * nh);
  return ((2 + inv) * Math.pow(sin2, inv * 0.5)) / (2 * Math.PI);
}
function sheenL(x: number, ag: number): number {
  const t = (1 - ag) * (1 - ag);
  const a = mix(21.5473, 25.3245, t); const b = mix(3.82987, 3.32435, t); const c = mix(0.19823, 0.16801, t);
  const d = mix(-1.9776, -1.27393, t); const e = mix(-4.32054, -4.85967, t);
  return a / (1 + b * Math.pow(x, c)) + d * x + e;
}
function sheenLambda(cos: number, ag: number): number {
  return Math.abs(cos) < 0.5 ? Math.exp(sheenL(cos, ag)) : Math.exp(2 * sheenL(0.5, ag) - sheenL(1 - cos, ag));
}
/** V = G ÷ (4 n·l n·v) with G = 1 ÷ (1 + Λ(n·v) + Λ(n·l)). */
export function sheenV(nl: number, nv: number, r: number): number {
  const ag = sheenAlpha(r);
  return 1 / ((1 + sheenLambda(nv, ag) + sheenLambda(nl, ag)) * 4 * nv * nl);
}
/** E_sheen(μ): the directional albedo of the sheen lobe of color 1, ∫ D·V·(n·l) dω over l, by a 256 × 128 rule. */
function sheenAlbedo(mu: number, r: number): number {
  const NU = 256; const NP = 128;
  const v: V3 = [Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu];
  let sum = 0;
  for (let i = 0; i < NU; i++) {
    const cl = (i + 0.5) / NU; const sl = Math.sqrt(1 - cl * cl);
    for (let k = 0; k < NP; k++) {
      const phi = (2 * Math.PI * (k + 0.5)) / NP;
      const l: V3 = [sl * Math.cos(phi), sl * Math.sin(phi), cl];
      const h = unit(add(l, v));
      sum += sheenD(h[2], r) * sheenV(cl, mu, r) * cl;
    }
  }
  return (sum * 2 * Math.PI) / (NU * NP);
}
const sheenTables = new Map<number, (mu: number) => number>();
export function sheenAlbedoAt(r: number): (mu: number) => number {
  let t = sheenTables.get(r);
  if (!t) { t = table((mu) => sheenAlbedo(mu, r)); sheenTables.set(r, t); }
  return t;
}

// ---------------------------------------------------------------------------------------------------
// One material's response to one direct light.

/** A material as the reference reads it: linear base color, glTF's specular weight (KHR_materials_specular's
 * strength; the design's specular_level × 2), and the lobes AC1 names. */
export interface Lobes {
  base: Rgb; metallic: number; roughness: number; specularWeight: number;
  /** KHR_materials_sheen: sheenColor (the design's weight × color) and sheenRoughness. */
  sheen?: { color: Rgb; roughness: number };
  /** KHR_materials_anisotropy: strength 0..1 and rotation in degrees from the tangent toward the bitangent. */
  anisotropy?: { strength: number; rotation: number };
  /** KHR_materials_diffuse_transmission: the factor (the design's thin `amount`) and its color. */
  thin?: { amount: number; color: Rgb };
}
const max3 = (c: Rgb): number => Math.max(c[0], c[1], c[2]);
const schlick = (sw: number, vh: number): number => sw * (0.04 + 0.96 * Math.pow(1 - Math.max(vh, 0), 5));

/**
 * f(l, v) × |n·l|: the radiance a unit illuminance from `l` leaves toward `v` at a point of normal `n` and tangent `t`
 * (needed only with anisotropy), all unit vectors in one frame.
 */
export function shade(m: Lobes, n: V3, t: V3 | null, v: V3, l: V3): Rgb {
  const nl = dot(n, l); const nv = dot(n, v);
  if (nv <= 0) return [0, 0, 0];
  const sw = m.specularWeight; const a = m.roughness * m.roughness;
  let out: Rgb = [0, 0, 0];
  if (nl > 0) {
    const h = unit(add(l, v)); const vh = Math.max(dot(v, h), 0); const nh = Math.max(dot(n, h), 0);
    let spec: number;
    if (m.anisotropy && m.anisotropy.strength !== 0) {
      if (!t) throw Error('an anisotropic lobe needs a tangent');
      const s = m.anisotropy.strength; const at = mix(a, 1, s * s); const ab = a;
      const b0 = cross(n, t); const rot = (m.anisotropy.rotation * Math.PI) / 180;
      const ta = unit(add(scale(t, Math.cos(rot)), scale(b0, Math.sin(rot)))); const ba = cross(n, ta);
      spec = anisoD(nh, dot(ta, h), dot(ba, h), at, ab) * anisoV(nl, nv, dot(ta, v), dot(ba, v), dot(ta, l), dot(ba, l), at, ab);
    } else {
      spec = ggxD(nh, a) * smithV(nl, nv, a);
    }
    const e = albedoAt(m.roughness)(nv); const w5 = Math.pow(1 - vh, 5); const F = schlick(sw, vh);
    const keep = 1 - (m.thin?.amount ?? 0);
    out = [0, 1, 2].map((c) => {
      const base = m.base[c]!;
      const dielectric = (1 - F) * keep * (base / Math.PI) + F * spec * (1 + 0.04 * sw * (1 / e - 1));
      const metal = (base + (1 - base) * w5) * spec * (1 + base * (1 / e - 1));
      return ((1 - m.metallic) * dielectric + m.metallic * metal) * nl;
    }) as Rgb;
    if (m.sheen && max3(m.sheen.color) > 0) {
      const E = sheenAlbedoAt(m.sheen.roughness); const k = max3(m.sheen.color);
      const scaling = Math.min(1 - k * E(nv), 1 - k * E(nl));
      const lobe = sheenD(nh, m.sheen.roughness) * sheenV(nl, nv, m.sheen.roughness) * nl;
      const sc = m.sheen.color;
      out = [0, 1, 2].map((c) => sc[c]! * lobe + scaling * out[c]!) as Rgb;
    }
  } else if (nl < 0 && m.thin && m.thin.amount > 0) {
    // Light from the back comes through as a Lambertian lobe of the transmission's color, weighted as glTF's
    // fresnel_mix weights the diffuse base: by 1 − F at the half vector of l mirrored to the front.
    const lm = sub(l, scale(n, 2 * nl)); const h = unit(add(lm, v)); const F = schlick(sw, dot(v, h));
    const amount = m.thin.amount; const col = m.thin.color;
    out = [0, 1, 2].map((c) => (1 - m.metallic) * (1 - F) * amount * (col[c]! / Math.PI) * -nl) as Rgb;
  }
  return out;
}
