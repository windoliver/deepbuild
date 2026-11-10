//! What one item's fill or line asks of the drawn pass: a resolved medium in its colors, seeded
//! from the item's ID, that the GPU layer lays its coverage through (Look `look@1`: drawn fills;
//! light; Paint: noise fill).

use crate::spec::{Dither, Hatch, Ink, Noise, Spatter, Wash};

/// A lamp as evaluated: where it stands in u and its color, 0..1 sRGB-encoded.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lamp {
    pub at: [f64; 2],
    pub color: [f64; 3],
}

/// Strokes laid on the page: what the pass needs of the look's `strokes`.
#[derive(Clone, Debug, PartialEq)]
pub struct Dabs {
    pub density: f64,
    pub size: (f64, f64),
    pub palette: Vec<[f64; 3]>,
    pub layers: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    /// The coverage as it is: a flat fill or a line reading the tooth.
    Plain,
    Ink(Ink),
    Wash(Wash),
    Spatter(Spatter),
    Hatch(Hatch),
    /// A noise field through its ramp, 16 stops in OKLab order as sRGB-encoded colors.
    Noise(Noise, Vec<[f64; 3]>),
    /// An ordered dither between its stops, each as an sRGB-encoded color.
    Dither(Dither, Vec<[f64; 3]>),
    Strokes(Dabs),
    /// A collection on a backlit screen: each lamp's light by its transmission.
    Lit {
        transmission: f64,
        lamps: Vec<Lamp>,
    },
}

impl Kind {
    /// The shader's number for this kind.
    pub fn number(&self) -> u32 {
        match self {
            Kind::Plain => 0,
            Kind::Ink(_) => 1,
            Kind::Wash(_) => 2,
            Kind::Spatter(_) => 3,
            Kind::Hatch(_) => 4,
            Kind::Noise(..) => 5,
            Kind::Strokes(_) => 6,
            Kind::Lit { .. } => 7,
            Kind::Dither(..) => 9,
        }
    }
}

/// An item's medium.
#[derive(Clone, Debug, PartialEq)]
pub struct Medium {
    pub kind: Kind,
    /// sRGB-encoded.
    pub color: [f64; 3],
    pub pressure: Option<f64>,
    pub dry: f64,
    /// Seeded from the item's ID and the look's seed.
    pub seed: u32,
    /// The item's box in u, where it draws.
    pub bounds: [f64; 4],
    /// The members of the collection that resists it.
    pub resist: Vec<String>,
}

impl Medium {
    /// The u a pass past the coverage may reach: a bleed's and a spread's.
    pub fn grow(&self) -> f64 {
        match &self.kind {
            Kind::Wash(w) => w.bleed * 3.0,
            Kind::Ink(i) => i.spread,
            _ => 0.0,
        }
    }
}

/// The medium's words, four vec4s, in the shader's order, and its list.
pub fn words(m: &Medium) -> ([[f32; 4]; 4], Vec<[f32; 4]>) {
    let f = |v: f64| v as f32;
    let mut w = [[0.0f32; 4]; 4];
    let mut list = Vec::new();
    match &m.kind {
        Kind::Plain => {}
        Kind::Ink(i) => {
            w[0] = [f(i.coverage), f(i.starve.0), f(i.starve.1), f(i.pinholes)];
            w[1] = [f(i.streaks.0), f(i.streaks.1), f(i.spread), i.edge as f32];
        }
        Kind::Wash(k) => {
            w[0] = [f(k.pool), f(k.granulation), f(k.blooms.0), f(k.blooms.1)];
            w[1] = [f(k.bleed), f32::from(u8::from(k.wet_in_wet)), 0.0, 0.0];
        }
        Kind::Spatter(s) => {
            w[0] = [f(s.dot.0), f(s.dot.1), f(s.density), f(s.angle)];
            w[1] = [f32::from(u8::from(s.shadow_only)), 0.0, 0.0, 0.0];
        }
        Kind::Hatch(h) => {
            w[0] = [
                f(h.angle),
                f(h.gap),
                f(h.width.max(h.min_width)),
                f32::from(u8::from(h.cross)),
            ];
            let (dot, density) = h.stipple.unwrap_or((0.0, 0.0));
            w[1] = [h.follow as f32, h.by_tone.len() as f32, f(dot), f(density)];
            for b in &h.by_tone {
                list.push([
                    f(b.below),
                    b.passes as f32,
                    f32::from(u8::from(b.cross)),
                    0.0,
                ]);
            }
        }
        Kind::Noise(n, ramp) => {
            w[0] = [f(n.scale), f(n.aspect), n.octaves as f32, f(n.roughness)];
            w[1] = [
                f(n.contrast),
                f(n.brightness),
                f(n.offset[0]),
                f(n.offset[1]),
            ];
            let phase = std::f64::consts::TAU * n.turns / f64::from(n.cycle.max(1));
            let radius = f64::from(n.cycle) / std::f64::consts::TAU;
            let (x, y) = if n.cycle > 0 {
                (
                    radius * deep_canvas::ops::cos(phase),
                    radius * deep_canvas::ops::sin(phase),
                )
            } else {
                (n.turns, 0.0)
            };
            let turn = deep_canvas::ops::rad(n.rotation);
            w[2] = [
                f(deep_canvas::ops::cos(turn)),
                f(deep_canvas::ops::sin(turn)),
                f(x),
                f(y),
            ];
            w[3] = [
                n.kind as f32,
                f32::from(u8::from(n.frame_anchored)),
                n.seed as u32 as f32,
                f(if n.cycle > 0 {
                    phase
                } else {
                    std::f64::consts::TAU * n.turns
                }),
            ];
            list.extend(ramp.iter().map(|c| [f(c[0]), f(c[1]), f(c[2]), 1.0]));
        }
        // The world-to-u transform goes in w[0] beside the page (the GPU layer writes it); w[1] the
        // matrix's side, the stop count and the flags.
        Kind::Dither(d, stops) => {
            w[1] = [
                d.matrix as f32,
                stops.len() as f32,
                f32::from(u8::from(d.by_tone)),
                f32::from(u8::from(d.frame_anchored)),
            ];
            list.extend(stops.iter().map(|c| [f(c[0]), f(c[1]), f(c[2]), 1.0]));
        }
        Kind::Strokes(d) => {
            w[0] = [f(d.density), f(d.size.0), f(d.size.1), d.layers as f32];
            w[1] = [d.palette.len() as f32, 0.0, 0.0, 0.0];
            list.extend(d.palette.iter().map(|c| [f(c[0]), f(c[1]), f(c[2]), 1.0]));
        }
        Kind::Lit {
            transmission,
            lamps,
        } => {
            w[0] = [f(*transmission), lamps.len() as f32, 0.0, 0.0];
            for l in lamps {
                list.push([f(l.at[0]), f(l.at[1]), 0.0, 0.0]);
                list.push([f(l.color[0]), f(l.color[1]), f(l.color[2]), 1.0]);
            }
        }
    }
    (w, list)
}
