//! Pipelines as the warm-up and the frame count them (canvas primitives: Compile, validate and
//! cache; issue #432): each pipeline's 128-bit key, the items it was made for, their feature set
//! and the target it draws into. A pipeline made while a frame draws is listed in that frame; one
//! the warm-up made at check never is.

/// One pipeline made: its key, the items it was made for, their feature set and its target
/// (`view`, or a shadow map's name).
#[derive(Clone, Debug, PartialEq)]
pub struct Created {
    pub key: u128,
    pub items: Vec<String>,
    pub feature_set: String,
    pub target: String,
}

/// FNV-1a over 128 bits: the pipeline key of what a pipeline is made from.
pub fn key128(parts: &[&[u8]]) -> u128 {
    const OFFSET: u128 = 0x6c62272e07bb014262b821756295c58d;
    const PRIME: u128 = 0x0000000001000000000000000000013b;
    let mut h = OFFSET;
    for p in parts {
        for b in p.iter() {
            h ^= u128::from(*b);
            h = h.wrapping_mul(PRIME);
        }
        // A separator, so ("ab", "c") and ("a", "bc") differ.
        h ^= 0xff;
        h = h.wrapping_mul(PRIME);
    }
    h
}

/// A key as the frame reports it: 32 lowercase hex digits.
pub fn hex(key: u128) -> String {
    format!("{key:032x}")
}

/// The item a solid draws for: an instancer's element (`pegs#100`, `pegs#100#1`) is its
/// instancer's.
pub fn item_of(solid: &str) -> &str {
    solid.split('#').next().unwrap_or(solid)
}

/// The extra lobes a material shades, by name, joined with `+` (Material: lobes).
pub fn lobe_names(l: &deep_canvas_scene3d::light::Lobes) -> Vec<&'static str> {
    let lit = |c: [f64; 3]| c.iter().any(|x| *x > 0.0);
    let mut out = Vec::new();
    for (on, name) in [
        (lit(l.sheen), "sheen"),
        (l.anisotropy != 0.0, "anisotropy"),
        (l.amount > 0.0, "translucency"),
        (l.ior != 1.5, "ior"),
        (l.tinted, "specular_color"),
        (l.transmission > 0.0, "transmission"),
        (l.iridescence > 0.0, "iridescence"),
        (l.diffuse_roughness > 0.0, "rough_diffuse"),
        (l.retroreflection > 0.0, "retroreflection"),
        (l.flake_weight > 0.0, "flakes"),
    ] {
        if on {
            out.push(name);
        }
    }
    out
}

/// A solid's feature set as the view draws it (Material: one pipeline per feature set: pattern,
/// alpha mode, transmission, unlit; lobes), e.g. `opaque+sheen` or `blend+pattern 3`.
pub fn feature_set(s: &deep_canvas_scene3d::scene::Solid) -> String {
    use deep_canvas_scene3d::light::AlphaMode;
    let Some(m) = &s.material else {
        return if s.per_pixel {
            "plain+per_pixel".into()
        } else {
            "plain".into()
        };
    };
    let mut f: Vec<String> = vec![match m.alpha_mode {
        AlphaMode::Opaque => "opaque".into(),
        AlphaMode::Mask => "mask".into(),
        AlphaMode::Blend => "blend".into(),
        AlphaMode::Add => "add".into(),
    }];
    if s.adjust.is_some_and(|a| a.opacity < 1.0) {
        f.push("fade".into());
    }
    if s.per_pixel {
        f.push("per_pixel".into());
    }
    if m.unlit {
        f.push("unlit".into());
    }
    if m.pattern != 0 {
        f.push(format!("pattern {}", m.pattern));
    }
    if s.op.is_some() {
        f.push("operator".into());
    }
    f.extend(lobe_names(&m.lobes).into_iter().map(String::from));
    f.join("+")
}

/// A casting solid's feature set in a shadow map: its caster kind (Light policy: casters).
pub fn caster_set(s: &deep_canvas_scene3d::scene::Solid) -> &'static str {
    let mask = s
        .material
        .as_ref()
        .is_some_and(|m| m.alpha_mode == deep_canvas_scene3d::light::AlphaMode::Mask);
    match (mask, s.batch != 0) {
        (true, _) => "caster+mask",
        (false, true) => "caster+instanced",
        (false, false) => "caster+opaque",
    }
}

/// The log a renderer keeps: everything it made, and from where this frame's list starts. What
/// the warm-up makes at check is kept apart, so no frame lists it.
#[derive(Default)]
pub struct Log {
    made: Vec<(Created, bool)>,
    frame_from: usize,
    /// While the warm-up runs at check: what it makes is never a frame's.
    pub warming: bool,
}

impl Log {
    pub fn push(&mut self, c: Created) {
        self.made.push((c, self.warming));
    }

    /// Starts a frame's list.
    pub fn begin_frame(&mut self) {
        self.frame_from = self.made.len();
    }

    /// What was made since the frame began, the warm-up's left out.
    pub fn this_frame(&self) -> impl Iterator<Item = &Created> {
        self.made[self.frame_from.min(self.made.len())..]
            .iter()
            .filter(|(_, warm)| !warm)
            .map(|(c, _)| c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_differ_by_content_and_split() {
        assert_ne!(key128(&[b"ab", b"c"]), key128(&[b"a", b"bc"]));
        assert_eq!(key128(&[b"x"]), key128(&[b"x"]));
        assert_eq!(hex(1).len(), 32);
        assert_eq!(item_of("pegs#100#1"), "pegs");
    }
}
