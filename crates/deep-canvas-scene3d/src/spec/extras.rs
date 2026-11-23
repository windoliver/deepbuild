//! Issue #420: the builder params beyond each kind's first ones.

use super::*;

/// The builder params beyond each kind's first ones (Builder: the ten trusted builders).
pub(super) fn extras(kind: &str) -> Vec<P> {
    match kind {
        "slab@1" => vec![
            ranged(
                p("bevel", "m", "m", json!(0), G, json!(0), json!(0.05)),
                0.0,
                100.0,
            ),
            p(
                "groove",
                "{depth, width}",
                "m",
                Value::Null,
                G,
                json!({"depth": 0.05, "width": 0.2}),
                json!({"depth": 0.08, "width": 0.3}),
            )
            .takes("{depth: m, width: m}"),
            p(
                "along",
                "{path, from, to}",
                "",
                Value::Null,
                G,
                json!({"path": [[0, 0, 0], [2, 0, 0]]}),
                json!({"path": [[0, 0, 0], [2, 0, 1]], "from": 0.25}),
            )
            .takes("{path: [vec3] | curve ID, from: 0..1, to: 0..1}"),
        ],
        "lathe@1" => vec![
            p(
                "ribs",
                "{count, depth, span}",
                "m",
                Value::Null,
                G,
                json!({"count": 8, "depth": 0.02, "span": 0.5}),
                json!({"count": 6, "depth": 0.03, "span": 0.25}),
            )
            .takes("{count: integer, depth: m, span: 0..1}"),
            p(
                "bands",
                "[{y0, y1, material}]",
                "m",
                json!([]),
                G,
                json!([]),
                json!([{"y0": 0, "y1": 0.5, "material": "wood"}]),
            )
            .takes("[{y0: m, y1: m, material}]"),
            p(
                "thread",
                "{pitch, depth}",
                "m",
                Value::Null,
                G,
                json!({"pitch": 0.1, "depth": 0.01}),
                json!({"pitch": 0.2, "depth": 0.02}),
            )
            .takes("{pitch: m, depth: m}"),
            p(
                "rim",
                "polygon",
                "",
                Value::Null,
                G,
                json!([[1, 0], [0, 1], [-1, 0], [0, -1]]),
                json!([[1, 0], [0.3, 0.95], [-0.8, 0.6], [-0.8, -0.6], [0.3, -0.95]]),
            ),
        ],
        "extrude@1" => vec![ranged(
            p("bevel", "m", "m", json!(0), G, json!(0), json!(0.05)),
            0.0,
            100.0,
        )],
        "tube@1" => vec![
            ranged(
                p("bend", "m", "m", json!(0), G, json!(0), json!(0.2)),
                0.0,
                100.0,
            ),
            p(
                "normal",
                "vec3",
                "",
                Value::Null,
                G,
                json!([1, 0, 0]),
                json!([0, 0, 1]),
            ),
        ],
        "plate@1" => vec![
            p(
                "height",
                "field, m",
                "m",
                Value::Null,
                G,
                json!(0),
                json!({"wave": {"amplitude": 0.1, "wavelength": 1}}),
            )
            .takes("m | {wave: {amplitude: m, wavelength: m, direction?: deg}} | {noise: {amplitude: m, scale: m, seed?: u64}}"),
            // #2014: a terrain plate's height field, size and spacing (Builder plate: terrain).
            p(
                "terrain",
                "terrain",
                "m",
                Value::Null,
                G,
                json!({"height": 0, "size": [4, 4]}),
                json!({"height": "position.x * 0.25", "size": [4, 4], "spacing": 0.5}),
            )
            .takes("{height: m | expr | {wave} | {noise}, size: [m, m], spacing?: m, tile?: m, lod_levels?: u8 ≤ 6}"),
            // #1381: a terrain plate's horizon table, baked with it (Builder plate: terrain).
            p(
                "horizon",
                "horizon",
                "",
                Value::Null,
                G,
                json!({"azimuths": 16, "size": 17}),
                json!({"azimuths": 16, "size": 33}),
            )
            .takes("{azimuths: 16, size: 2..257 = 257}"),
            // #537: a terrain plate's overlays tint its cover and rebuild nothing (Builder plate: terrain overlays).
            p(
                "overlays",
                "[overlay] ≤ 2",
                "",
                Value::Null,
                S,
                Value::Null,
                json!([]),
            )
            .takes("[{grid: <logic>.<name>, size: [cols, rows: u16], origin?: [m, m], cell?: m, roles: [role | none] ≤ 16, opacity?: 0..1}] ≤ 2"),
        ],
        _ => Vec::new(),
    }
}
