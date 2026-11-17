use super::*;

/// The look module.
pub fn look() -> Module {
    Module {
        manifest: manifest("look", &[]),
        register: register_look,
    }
}

/// A planted implementation of look@1 (#418's `test-look-finish-off`): declared bit and
/// canonical, under its own name, whose finish at identity moves one value of one role, so the
/// kit's bit part fails it and a release build refuses it.
pub fn look_finish_off() -> Module {
    let mut m = manifest("look", &[]);
    m.implementation = deep_canvas::registry::Implementation::reference(
        "look.finish_off",
        Semver::parse("1.0.0").expect("a version"),
    );
    Module {
        manifest: m,
        register: |r| look_with(r, finish_off),
    }
}

/// A look as the frame reads it: each role's color, the status map, and the type its text is set
/// in (#239).
#[derive(Debug)]
pub struct LookValue {
    pub palette: Palette,
    pub status: Option<Status>,
    pub ty: scene::Type,
}

impl Canonical for Status {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.colors, &self.glyphs, self.core_min_px, &self.outline).encode(out);
        self.min_distance.encode(out);
    }
}

impl deep_canvas::schedule::Canonical for LookValue {
    fn encode(&self, out: &mut Vec<u8>) {
        // A look that sets no font role apart from the bundled ones keys as it did before #239.
        if self.ty.fonts.is_empty() {
            deep_canvas::schedule::Canonical::encode(&(&self.palette, &self.status), out);
        } else {
            let fonts: Vec<(&String, &str)> = self.ty.fonts.iter().map(|(k, v)| (k, *v)).collect();
            deep_canvas::schedule::Canonical::encode(&(&self.palette, &self.status, &fonts), out);
        }
    }
}

fn register_look(r: &mut Registrar) {
    look_with(r, finish);
}

/// #463: a pack's `looks` (Pack: art@1 painterly looks), each a look@1 by its ID, checked as
/// a film resolves one (roles, fonts, the status distance where status shows), stating its GPU ms
/// at 1080p in 2D and 3D (`cost: {"2d", "3d"}`) and its known limits (`limits`).
fn pack_looks(manifest: &Value) -> Vec<(String, String)> {
    let Some(looks) = manifest["looks"].as_object() else {
        return vec![(
            String::new(),
            "looks maps each look's ID to its look@1".into(),
        )];
    };
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    let mut out = Vec::new();
    for (id, def) in looks {
        if let Err(r) =
            crate::look::resolve_in(def, &bundled, crate::look::Distance::WhereStatusShows)
        {
            out.push((id.clone(), r.to_json().to_string()));
            continue;
        }
        let ms = |d: &str| def["cost"][d].as_f64().is_some_and(|v| v > 0.0);
        if !(ms("2d") && ms("3d")) {
            out.push((
                format!("{id}/cost"),
                format!("{id} states its GPU ms at 1080p in 2d and 3d"),
            ));
        }
        let limits = def["limits"].as_array();
        if !limits.is_some_and(|l| !l.is_empty() && l.iter().all(Value::is_string)) {
            out.push((
                format!("{id}/limits"),
                format!("{id} states its known limits"),
            ));
        }
    }
    out
}

fn look_with(r: &mut Registrar, finish: fn(&mut View<'_>) -> Result<(), OpError>) {
    r.pack_field("looks", pack_looks);
    r.array("look.palette", "palette", "document", "shading", "items");
    // #418: a finish swatch, `look.finish@1`: the look's roles through the look's finish at the
    // item's settings (its tone map, exposure and grade, and the deband, ao and bloom it names),
    // each role's swatch as the finish leaves it. An implementation whose finish moves a pixel at
    // identity differs here from the reference's.
    r.kind(finish_kind(), &[], "");
    r.array("look.finish", "palette", "item", "shading", "items");
    // The status map every status mark draws from, into the core's array (The status-color rule).
    r.contribution(
        "look.status",
        "status",
        "document",
        "shading",
        "items",
        "core.status",
    );
    r.operator(
        "palette",
        "items",
        &["look"],
        &["look.palette", "look.status"],
    )
    .document()
    .run(palette);
    r.operator(
        "finish",
        "items",
        &["self", "look.palette"],
        &["look.finish"],
    )
    .applies(is_finish)
    .run(finish);
    r.fixture("roles", roles_board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/ink/params/box", "value": [86, 40, 56, 40]},
    }));
    // The finish at its identity defaults, and under each tone map with a grade, the deband, ao
    // and bloom: the analytic fixtures the issue's proof names, evaluated headless.
    r.fixture("finish", finish_board(), None).sidecar(json!({
        "codes": [],
        "covers": {"kinds": ["look.finish@1"], "fields": [
            "look.finish@1/params/tone_map", "look.finish@1/params/exposure",
            "look.finish@1/params/grade", "look.finish@1/params/deband",
            "look.finish@1/params/deband_lsb", "look.finish@1/params/ao",
            "look.finish@1/params/bloom",
        ]},
    }));
}

fn finish_kind() -> deep_canvas::kinds::Entry {
    use deep_canvas::kinds::{Entry, Param, ParamType, Version};
    let param = |name, ty, default: Value| Param {
        name,
        ty,
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    Entry {
        family: "look",
        name: "finish",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                // The forms each reader takes (#1973): `read_tone_map` takes any object holding
                // `agx`, whatever its value; `read_grade` any white balance; the finish skips a
                // deband_lsb that is no number; ao and bloom as look@1's readers take them.
                param(
                    "tone_map",
                    ParamType::Json(
                        "none | filmic | agx | neutral | {agx} (agx: {white: f32, contrast: f32})",
                    ),
                    json!("none"),
                ),
                // EV100; the default's exposure scale is 1.
                param("exposure", ParamType::Json("EV100"), Value::Null),
                param(
                    "grade",
                    ParamType::Json(
                        "{white_balance, slope: linear RGB, offset: linear RGB, power: linear RGB, saturation: f32} (white_balance: {temperature: K, tint})",
                    ),
                    json!({}),
                ),
                param("deband", ParamType::Str, json!("none")),
                param("deband_lsb", ParamType::Json("0..2 (8-bit steps)"), json!(1)),
                param(
                    "ao",
                    ParamType::Json(
                        "none | {radius, strength, samples, resolution, multi_bounce, specular} (radius: m, samples: 8 | 16, resolution: half | full)",
                    ),
                    json!("none"),
                ),
                param(
                    "bloom",
                    ParamType::Json(
                        "none | {intensity, radius, threshold, tint, dirt} (threshold: EV100 | none, tint: linear RGB, dirt: {texture: sha256 | seeded, intensity})",
                    ),
                    json!("none"),
                ),
            ],
        }],
        migrations: vec![],
    }
}

fn is_finish(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("look.finish@1")
}

/// Swatches of the look's finish: at its identity defaults, then under filmic, AgX and Neutral, a
/// grade, the deband, ao and bloom.
fn finish_board() -> Value {
    let swatch = |id: &str, order: &str, params: Value| {
        json!({"id": id, "kind": "look.finish@1", "name": format!("Finish {id}"), "order": order,
               "params": params})
    };
    json!({
        "format": 1, "profile": "board", "seed": 418, "title": "Finish",
        "requires": {"modules": {"look": "^1"}},
        "description": "The look's roles through its finish: at the identity defaults, under each tone map, a grade, the deband, ambient occlusion and bloom: the look module's finish fixture.",
        "size": [320, 200],
        "items": {
            "identity": swatch("identity", "a0", json!({
                "tone_map": "none", "deband": "none", "ao": "none", "bloom": "none",
                "grade": {"white_balance": {"temperature": 6500, "tint": 0},
                          "slope": [1, 1, 1], "offset": [0, 0, 0], "power": [1, 1, 1], "saturation": 1}})),
            "filmic": swatch("filmic", "a1", json!({"tone_map": "filmic", "exposure": -1.263})),
            "agx": swatch("agx", "a2", json!({"tone_map": {"agx": {"white": 16.29, "contrast": 1.25}}, "exposure": -1.263})),
            "neutral": swatch("neutral", "a3", json!({
                "tone_map": "neutral", "deband": "spatial", "deband_lsb": 1,
                "ao": {"radius": 0.5, "strength": 1, "samples": 8, "resolution": "half",
                       "multi_bounce": true, "specular": true},
                "bloom": {"intensity": 0.04, "radius": 0.85},
                "grade": {"white_balance": {"temperature": 5600, "tint": 0},
                          "slope": [1.05, 1, 0.95], "offset": [0, 0, 0], "power": [1, 1, 1], "saturation": 0.9}})),
        }
    })
}
