//! The first-party data layouts (canvas primitives: Logic: data layouts; #415): `nav.graph@1`,
//! `nav.graph@2`, `table.layout@1`, `fn.table@1` and `pages@1`, entries of the core's
//! `data.layout@1` that this module fills. Each has its documented bytes, a validator under the
//! one subset (as WebAssembly text; the engine assembles it), malformed twins it must refuse,
//! fixtures it must admit, and a reading of an offset as the field it lies in, so a refusal names
//! the field. A validator treats its asset as untrusted: every field that sizes or indexes another
//! is checked against the bytes and counts it points into before anything is read through it.
//!
//! What each validator returned on its twins and fixtures is `layouts/judged.json`, the
//! reference's answers, which the seal's kit reads and the engine's tests rerun.

use serde_json::{json, Value};

/// A pack layout's cap (Pack: `layouts`); `pages@1` has its own, past it.
pub const PACK_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// The bytes a validator's memory holds past its asset.
pub const SCRATCH: u64 = 4 * 1024 * 1024;
/// A world page, and pages@1's cap of 4,096 of them after its 12-byte header.
pub const PAGE: u64 = 65_536;
pub const PAGES_CAP: u64 = 4_096;
pub const PAGES_MAX_BYTES: u64 = 12 + PAGES_CAP * (4 + PAGE);
/// A nav.graph polygon's vertex cap, and nav.graph@2's tag cap.
pub const NAV_VERTEX_CAP: u32 = 32;
pub const NAV_TAG_CAP: u32 = 32;

/// The judged twins and fixtures, by layout: `{name: {program, twins: [{asset, valid, offset}],
/// fixtures: [{asset, valid, offset}]}}`.
pub const JUDGED: &str = include_str!("../layouts/judged.json");

/// Planted wrong validators, reachable only through a startup argument (#415's suite).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// pages@1 under a pack layout's 64 MiB cap instead of its own.
    pub pages_pack_cap: bool,
    /// nav.graph's validators without the check of the link count against the bytes after the
    /// nodes, reading as many links as the header says.
    pub trusts_link_count: bool,
}

/// One first-party layout.
pub struct Layout {
    pub name: &'static str,
    pub max_bytes: u64,
    pub doc: &'static str,
    /// The validator, as WebAssembly text, with any planted fault.
    pub program: fn(Planted) -> String,
    pub twins: fn() -> Vec<Vec<u8>>,
    pub fixtures: fn() -> Vec<Vec<u8>>,
    /// The field an offset of an asset lies in, named by the doc's fields with record indexes.
    pub field: fn(&[u8], u64) -> String,
}

impl Layout {
    /// Its cap under a planted fault.
    pub fn cap(&self, p: Planted) -> u64 {
        if p.pages_pack_cap && self.name == "pages@1" {
            PACK_MAX_BYTES
        } else {
            self.max_bytes
        }
    }

    /// Its `data.layout@1` entry: the validator by its sha256, the cap, the twins and fixtures
    /// by sha256, the doc, and what the reference's validator returned on each.
    pub fn entry(&self) -> Value {
        let judged: Value = serde_json::from_str(JUDGED).expect("layouts/judged.json is JSON");
        let j = &judged[self.name];
        let shas = |b: Vec<Vec<u8>>| {
            b.iter()
                .map(|b| crate::rewrite::hash(b))
                .collect::<Vec<_>>()
        };
        json!({
            "validator": j["program"].clone(),
            "max_bytes": self.max_bytes,
            "twins": shas((self.twins)()),
            "fixtures": shas((self.fixtures)()),
            "doc": self.doc,
            "judged": j["twins"].clone(),
            "admitted": j["fixtures"].clone(),
        })
    }
}

pub fn first_party() -> Vec<Layout> {
    vec![
        Layout {
            name: "fn.table@1",
            max_bytes: 16 + 16 * 4_096,
            doc: FN_TABLE_DOC,
            program: |_| fn_table(),
            twins: || vec![fn_table_bytes(&[0.0, 2.0, 1.0], &[0.0, 0.5, 1.0])],
            fixtures: || vec![fn_table_bytes(&[0.0, 1.0, 2.0], &[0.0, 0.5, 1.0])],
            field: fn_table_field,
        },
        Layout {
            name: "nav.graph@1",
            max_bytes: PACK_MAX_BYTES,
            doc: NAV1_DOC,
            program: |p| nav_graph(1, p.trusts_link_count),
            twins: || nav_twins(1),
            fixtures: || vec![nav_level(1)],
            field: |b, o| nav_field(b, o, false),
        },
        Layout {
            name: "nav.graph@2",
            max_bytes: PACK_MAX_BYTES,
            doc: NAV2_DOC,
            program: |p| nav_graph(2, p.trusts_link_count),
            twins: || nav_twins(2),
            fixtures: || vec![nav_level(2)],
            field: |b, o| nav_field(b, o, true),
        },
        Layout {
            name: "pages@1",
            max_bytes: PAGES_MAX_BYTES,
            doc: PAGES_DOC,
            program: |_| pages(),
            twins: || vec![pages_bytes(&[0, 5, 5])],
            fixtures: || vec![pages_bytes(&[0, 5, 7])],
            field: pages_field,
        },
        Layout {
            name: "table.layout@1",
            max_bytes: PACK_MAX_BYTES,
            doc: TABLE_DOC,
            program: |_| table_layout(),
            twins: || vec![catalog(true)],
            fixtures: || vec![catalog(false)],
            field: table_field,
        },
    ]
}

/// The first-party layout `name`.
pub fn named(name: &str) -> Option<Layout> {
    first_party().into_iter().find(|l| l.name == name)
}

// ---- the validators' shared text

/// The module around a validator body: its memory (the runner sizes it to the asset plus 4 MiB),
/// `in_at` 0 and `$ok`, whether the f32 at an offset is finite.
fn module(locals: &str, body: &str) -> String {
    format!(
        r#"(module
  (memory (export "memory") 64 64)
  (global (export "in_at") i32 (i32.const 0))
  (func $ok (param $at i32) (result i32)
    (i32.ne (i32.and (i32.load (local.get $at)) (i32.const 0x7f800000)) (i32.const 0x7f800000)))
  (func $ok64 (param $at i32) (result i32)
    (i64.ne (i64.and (i64.load (local.get $at)) (i64.const 0x7ff0000000000000)) (i64.const 0x7ff0000000000000)))
  (func (export "validate") (param $n i64) (result i64)
    (local $len i32) {locals}
    (if (i64.gt_u (local.get $n) (i64.const 0x7fffffff)) (then (return (i64.const 0))))
    (local.set $len (i32.wrap_i64 (local.get $n)))
{body}
    (i64.const -1)))
"#
    )
}

/// Refuses at `at` (an i32 expression).
fn bad(at: &str) -> String {
    format!("(return (i64.extend_i32_u {at}))")
}

/// Refuses at `at` unless `n` bytes from it lie inside the asset.
fn need(at: &str, n: &str) -> String {
    format!(
        "(if (i32.gt_u (i32.add {at} {n}) (local.get $len)) (then {}))",
        bad(at)
    )
}

/// A fixed field at `at`: present, and `test` (reading `(local.get $v)`) holds, else refused there.
fn fixed(at: u32, n: u32, read: &str, test: &str) -> String {
    let a = format!("(i32.const {at})");
    format!(
        "    {}\n    (local.set $v ({read} {a}))\n    (if (i32.eqz {test}) (then {}))\n",
        need(&a, &format!("(i32.const {n})")),
        bad(&a)
    )
}

const P: &str = "(local.get $p)";

fn at_p(plus: u32) -> String {
    format!("(i32.add (local.get $p) (i32.const {plus}))")
}

// ---- nav.graph@1 and nav.graph@2

const NAV1_DOC: &str = "A navigation graph, little-endian. Header (72 bytes): magic `NAVG` at 0; version u32 = 1 at 4; form u32 at 8 (0 grid, 1 mesh); capsule.radius, capsule.height, climb, slope (deg) and cell, 5 f32 at 12, finite; source, the sha256 of the world's static shapes, 32 bytes at 32; node_count u32 at 64, its smallest nodes fitting the bytes after the header; link_count u32 at 68, exactly that many links after the nodes. Nodes in order: floor f32 (finite), then in the grid form cell_x i32 and cell_y i32, in the mesh form vertex_count u32 (1 to 32) and that many vertices of 3 finite f32. Links sorted by (a, b), strictly: a u32, b u32 (each below node_count), cost f32, rise f32 (finite): 16 bytes. Fields are named header.<name>, nodes[i].floor, nodes[i].vertex_count, nodes[i].polygon[j], nodes[i].cell_x, links[i].a, links[i].b, links[i].cost, links[i].rise.";

const NAV2_DOC: &str = "nav.graph@1's bytes with version 2 and tags and typed links. After link_count, header.tag_count u32 at 72 (at most 32) and that many tag names of 32 bytes, tags[i], UTF-8 padded with zeros. Each node ends with nodes[i].tags u32, one bit per tag, no bit at or past tag_count. Each link ends with links[i].kind u8 (0 walk, 1 jump, 2 drop, 3 wall), links[i].face u8 (on a wall link 0 to 5: +x, -x, +y, -y, +z, -z on the box's own axes; else 0), links[i].reserved u16 = 0 and links[i].shape u32 (a wall link's box ID; else 0): 24 bytes a link. A node's smallest size grows by 4 bytes.";

fn nav_graph(version: u32, trusts: bool) -> String {
    let v2 = version == 2;
    let (extra, link) = if v2 { (4, 24) } else { (0, 16) };
    let finite = |at: u32| {
        format!("    {}\n    (if (i32.eqz (call $ok (i32.const {at}))) (then (return (i64.const {at}))))\n", need(&format!("(i32.const {at})"), "(i32.const 4)"))
    };
    let mut b = String::new();
    b += &fixed(
        0,
        4,
        "i32.load",
        "(i32.eq (local.get $v) (i32.const 0x4756414e))",
    );
    b += &fixed(
        4,
        4,
        "i32.load",
        &format!("(i32.eq (local.get $v) (i32.const {version}))"),
    );
    b += &fixed(8, 4, "i32.load", "(i32.le_u (local.get $v) (i32.const 1))");
    b += "    (local.set $form (local.get $v))\n";
    for at in [12, 16, 20, 24, 28] {
        b += &finite(at);
    }
    b += &format!("    {}\n", need("(i32.const 32)", "(i32.const 32)"));
    b += &fixed(64, 4, "i32.load", "(i32.const 1)");
    b += "    (local.set $nc (local.get $v))\n";
    b += &fixed(68, 4, "i32.load", "(i32.const 1)");
    b += "    (local.set $lc (local.get $v))\n";
    if v2 {
        b += &fixed(
            72,
            4,
            "i32.load",
            &format!("(i32.le_u (local.get $v) (i32.const {NAV_TAG_CAP}))"),
        );
        b += "    (local.set $tc (local.get $v))\n";
        b += "    (local.set $hdr (i32.add (i32.const 76) (i32.mul (local.get $tc) (i32.const 32))))\n";
        // The first tag name not wholly inside the asset.
        b += "    (if (i32.gt_u (local.get $hdr) (local.get $len)) (then (return (i64.extend_i32_u (i32.add (i32.const 76) (i32.mul (i32.div_u (i32.sub (local.get $len) (i32.const 76)) (i32.const 32)) (i32.const 32)))))))\n";
    } else {
        b += "    (local.set $hdr (i32.const 72))\n";
    }
    // node_count: its smallest nodes fit the bytes after the header.
    b += &format!(
        "    (local.set $min (i32.add (select (i32.const 20) (i32.const 12) (local.get $form)) (i32.const {extra})))
    (if (i64.gt_u (i64.mul (i64.extend_i32_u (local.get $nc)) (i64.extend_i32_u (local.get $min))) (i64.extend_i32_u (i32.sub (local.get $len) (local.get $hdr))))
      (then (return (i64.const 64))))
    (local.set $p (local.get $hdr))
"
    );
    let tags = if v2 {
        format!(
            "        {}
        (if (i64.ne (i64.shr_u (i64.extend_i32_u (i32.load {P})) (i64.extend_i32_u (local.get $tc))) (i64.const 0)) (then {}))
        (local.set $p {})\n",
            need(P, "(i32.const 4)"),
            bad(P),
            at_p(4)
        )
    } else {
        String::new()
    };
    b += &format!(
        "    (block $nodes_done (loop $nodes
        (br_if $nodes_done (i32.ge_u (local.get $i) (local.get $nc)))
        {need4}
        (if (i32.eqz (call $ok {P})) (then {badp}))
        (local.set $p {p4})
        (if (local.get $form)
          (then
            {need4}
            (local.set $vc (i32.load {P}))
            (if (i32.or (i32.eqz (local.get $vc)) (i32.gt_u (local.get $vc) (i32.const {NAV_VERTEX_CAP}))) (then {badp}))
            (local.set $p {p4})
            {needv}
            (local.set $k (i32.const 0))
            (block $verts_done (loop $verts
              (br_if $verts_done (i32.ge_u (local.get $k) (i32.mul (local.get $vc) (i32.const 3))))
              (if (i32.eqz (call $ok {P})) (then {badp}))
              (local.set $p {p4})
              (local.set $k (i32.add (local.get $k) (i32.const 1)))
              (br $verts))))
          (else
            {need8}
            (local.set $p {p8})))
{tags}        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $nodes)))
",
        need4 = need(P, "(i32.const 4)"),
        need8 = need(P, "(i32.const 8)"),
        needv = need(P, "(i32.mul (local.get $vc) (i32.const 12))"),
        badp = bad(P),
        p4 = at_p(4),
        p8 = at_p(8),
    );
    if !trusts {
        // link_count: exactly that many links after the nodes.
        b += &format!(
            "    (if (i64.ne (i64.mul (i64.extend_i32_u (local.get $lc)) (i64.const {link})) (i64.extend_i32_u (i32.sub (local.get $len) (local.get $p))))
      (then (return (i64.const 68))))\n"
        );
    }
    let typed = if v2 {
        format!(
            "        (local.set $kind (i32.load8_u offset=16 {P}))
        (if (i32.gt_u (local.get $kind) (i32.const 3)) (then {k}))
        (local.set $v (i32.load8_u offset=17 {P}))
        (if (select (i32.gt_u (local.get $v) (i32.const 5)) (i32.ne (local.get $v) (i32.const 0)) (i32.eq (local.get $kind) (i32.const 3))) (then {f}))
        (if (i32.load16_u offset=18 {P}) (then {r}))
        (if (i32.and (i32.ne (local.get $kind) (i32.const 3)) (i32.ne (i32.load offset=20 {P}) (i32.const 0))) (then {s}))\n",
            k = bad(&at_p(16)),
            f = bad(&at_p(17)),
            r = bad(&at_p(18)),
            s = bad(&at_p(20)),
        )
    } else {
        String::new()
    };
    b += &format!(
        "    (local.set $i (i32.const 0))
    (block $links_done (loop $links
        (br_if $links_done (i32.ge_u (local.get $i) (local.get $lc)))
        (local.set $a (i32.load {P}))
        (if (i32.ge_u (local.get $a) (local.get $nc)) (then {badp}))
        (local.set $v (i32.load offset=4 {P}))
        (if (i32.ge_u (local.get $v) (local.get $nc)) (then {b4}))
        (if (i32.eqz (call $ok {p8})) (then {b8}))
        (if (i32.eqz (call $ok {p12})) (then {b12}))
        (local.set $key (i64.or (i64.shl (i64.extend_i32_u (local.get $a)) (i64.const 32)) (i64.extend_i32_u (local.get $v))))
        (if (i32.and (i32.ne (local.get $i) (i32.const 0)) (i64.le_u (local.get $key) (local.get $prev))) (then {badp}))
        (local.set $prev (local.get $key))
{typed}        (local.set $p {pl})
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $links)))
",
        badp = bad(P),
        b4 = bad(&at_p(4)),
        b8 = bad(&at_p(8)),
        b12 = bad(&at_p(12)),
        p8 = at_p(8),
        p12 = at_p(12),
        pl = at_p(link),
    );
    module(
        "(local $v i32) (local $hdr i32) (local $form i32) (local $nc i32) (local $lc i32) (local $tc i32) (local $min i32) (local $p i32) (local $i i32) (local $k i32) (local $vc i32) (local $a i32) (local $kind i32) (local $key i64) (local $prev i64)",
        &b,
    )
}

fn u32_at(b: &[u8], at: u64) -> Option<u32> {
    let at = usize::try_from(at).ok()?;
    b.get(at..at.checked_add(4)?)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn nav_field(b: &[u8], off: u64, v2: bool) -> String {
    let mut fixed = vec![
        (0, 4, "magic"),
        (4, 4, "version"),
        (8, 4, "form"),
        (12, 4, "capsule.radius"),
        (16, 4, "capsule.height"),
        (20, 4, "climb"),
        (24, 4, "slope"),
        (28, 4, "cell"),
        (32, 32, "source"),
        (64, 4, "node_count"),
        (68, 4, "link_count"),
    ];
    if v2 {
        fixed.push((72, 4, "tag_count"));
    }
    for (at, n, name) in &fixed {
        if off < at + n {
            return format!("header.{name}");
        }
    }
    let mut p = 72u64;
    if v2 {
        let tc = u64::from(u32_at(b, 72).unwrap_or(0).min(NAV_TAG_CAP));
        if off < 76 + 32 * tc {
            return format!("tags[{}]", (off - 76) / 32);
        }
        p = 76 + 32 * tc;
    }
    let mesh = u32_at(b, 8) == Some(1);
    let nc = u64::from(u32_at(b, 64).unwrap_or(0));
    let mut i = 0;
    while i < nc && p <= off {
        if off < p + 4 {
            return format!("nodes[{i}].floor");
        }
        p += 4;
        if mesh {
            if off < p + 4 {
                return format!("nodes[{i}].vertex_count");
            }
            let vc = u64::from(u32_at(b, p).unwrap_or(0));
            p += 4;
            if vc == 0 || vc > u64::from(NAV_VERTEX_CAP) || off < p + 12 * vc {
                return format!("nodes[{i}].polygon[{}]", (off - p) / 12);
            }
            p += 12 * vc;
        } else {
            for c in ["cell_x", "cell_y"] {
                if off < p + 4 {
                    return format!("nodes[{i}].{c}");
                }
                p += 4;
            }
        }
        if v2 {
            if off < p + 4 {
                return format!("nodes[{i}].tags");
            }
            p += 4;
        }
        i += 1;
    }
    if off < p {
        return format!("nodes[{i}]");
    }
    let size = if v2 { 24 } else { 16 };
    let (k, r) = ((off - p) / size, (off - p) % size);
    let part = match r {
        0..=3 => "a",
        4..=7 => "b",
        8..=11 => "cost",
        12..=15 => "rise",
        16 => "kind",
        17 => "face",
        18 | 19 => "reserved",
        _ => "shape",
    };
    format!("links[{k}].{part}")
}

/// The fixture level of #415's suite: five mesh polygons and six sorted links, with three tags
/// and typed links in nav.graph@2.
pub fn nav_level(version: u32) -> Vec<u8> {
    let v2 = version == 2;
    let mut w = Vec::new();
    let u32s = |w: &mut Vec<u8>, v: u32| w.extend(v.to_le_bytes());
    let f32s = |w: &mut Vec<u8>, v: f32| w.extend(v.to_le_bytes());
    w.extend(b"NAVG");
    u32s(&mut w, version);
    u32s(&mut w, 1);
    for v in [0.3, 1.8, 0.4, 45.0, 0.1] {
        f32s(&mut w, v);
    }
    w.extend(crate::rewrite::hash(b"a fixture level").as_bytes()[..32].iter());
    let nodes: [(f32, u32, &[[f32; 3]]); 3] = [
        (
            0.0,
            0b01,
            &[
                [0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
                [2.0, 0.0, 2.0],
                [0.0, 0.0, 2.0],
            ],
        ),
        (
            0.5,
            0b00,
            &[[2.0, 0.5, 0.0], [4.0, 0.5, 0.0], [4.0, 0.5, 2.0]],
        ),
        (
            2.0,
            0b10,
            &[
                [4.0, 2.0, 0.0],
                [6.0, 2.0, 0.0],
                [6.0, 2.0, 2.0],
                [4.0, 2.0, 2.0],
            ],
        ),
    ];
    let links: [(u32, u32, f32, f32, u8, u8, u32); 3] = [
        (0, 1, 2.0, 0.5, 0, 0, 0),
        (1, 0, 2.0, -0.5, 0, 0, 0),
        (1, 2, 2.0, 1.5, 3, 4, 9),
    ];
    u32s(&mut w, nodes.len() as u32);
    u32s(&mut w, links.len() as u32);
    if v2 {
        u32s(&mut w, 2);
        for t in ["near_drop", "inside"] {
            let mut name = [0u8; 32];
            name[..t.len()].copy_from_slice(t.as_bytes());
            w.extend(name);
        }
    }
    for (floor, tags, poly) in nodes {
        f32s(&mut w, floor);
        u32s(&mut w, poly.len() as u32);
        for v in poly {
            for c in v {
                f32s(&mut w, *c);
            }
        }
        if v2 {
            u32s(&mut w, tags);
        }
    }
    for (a, b, cost, rise, kind, face, shape) in links {
        u32s(&mut w, a);
        u32s(&mut w, b);
        f32s(&mut w, cost);
        f32s(&mut w, rise);
        if v2 {
            w.extend([kind, face, 0, 0]);
            u32s(&mut w, shape);
        }
    }
    w
}

/// The level with each malformed field nav.graph's validators must refuse: a link past the node
/// count, a link count past the bytes, a non-finite floor, a polygon of 0 vertices (and in
/// nav.graph@2 a tag bit past the tags and a wall face past 5).
fn nav_twins(version: u32) -> Vec<Vec<u8>> {
    let level = nav_level(version);
    let hdr = if version == 2 { 76 + 64 } else { 72 };
    let links_at = level.len() - 3 * if version == 2 { 24 } else { 16 };
    let set = |at: usize, v: u32| {
        let mut b = level.clone();
        b[at..at + 4].copy_from_slice(&v.to_le_bytes());
        b
    };
    let mut out = vec![
        set(links_at + 4, 3),
        set(68, 4),
        set(hdr, f32::NAN.to_bits()),
        set(hdr + 4, 0),
    ];
    if version == 2 {
        out.push(set(hdr + 4 + 4 + 48, 0b100));
        let mut b = level.clone();
        b[links_at + 2 * 24 + 17] = 6;
        out.push(b);
    }
    out
}

// ---- pages@1

const PAGES_DOC: &str = "A world's pages, little-endian: magic `PAGS` at 0, version u32 = 1 at 4, page_count u32 at 8 (at most 4,096; exactly that many pages follow), then per page pages[i].number u32 and its 65,536 bytes, pages[i].data: page i's number at 12 + 65,540 i. Numbers strictly increase, in page order. Its own cap is a header and 4,096 pages, 268,451,852 bytes, past a pack layout's 64 MiB.";

fn pages() -> String {
    let mut b = String::new();
    b += &fixed(
        0,
        4,
        "i32.load",
        "(i32.eq (local.get $v) (i32.const 0x53474150))",
    );
    b += &fixed(4, 4, "i32.load", "(i32.eq (local.get $v) (i32.const 1))");
    b += &fixed(
        8,
        4,
        "i32.load",
        &format!("(i32.le_u (local.get $v) (i32.const {PAGES_CAP}))"),
    );
    b += &format!(
        "    (if (i64.ne (i64.mul (i64.extend_i32_u (local.get $v)) (i64.const {})) (i64.extend_i32_u (i32.sub (local.get $len) (i32.const 12))))
      (then (return (i64.const 8))))
    (local.set $c (local.get $v))
    (local.set $p (i32.const 12))
    (block $done (loop $page
      (br_if $done (i32.ge_u (local.get $i) (local.get $c)))
      (local.set $v (i32.load {P}))
      (if (i32.and (i32.ne (local.get $i) (i32.const 0)) (i32.le_u (local.get $v) (local.get $prev))) (then {}))
      (local.set $prev (local.get $v))
      (local.set $p {})
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $page)))
",
        4 + PAGE,
        bad(P),
        at_p(4 + PAGE as u32),
    );
    module(
        "(local $v i32) (local $c i32) (local $p i32) (local $i i32) (local $prev i32)",
        &b,
    )
}

fn pages_field(_: &[u8], off: u64) -> String {
    match off {
        0..=3 => "header.magic".into(),
        4..=7 => "header.version".into(),
        8..=11 => "header.page_count".into(),
        _ => {
            let (i, r) = ((off - 12) / (4 + PAGE), (off - 12) % (4 + PAGE));
            format!("pages[{i}].{}", if r < 4 { "number" } else { "data" })
        }
    }
}

/// A pages@1 asset whose pages carry `numbers`, each page zero after its number.
pub fn pages_bytes(numbers: &[u32]) -> Vec<u8> {
    let mut w = b"PAGS".to_vec();
    w.extend(1u32.to_le_bytes());
    w.extend((numbers.len() as u32).to_le_bytes());
    for n in numbers {
        w.extend(n.to_le_bytes());
        w.resize(w.len() + PAGE as usize, 0);
    }
    w
}

// ---- fn.table@1

const FN_TABLE_DOC: &str = "A function table (Driver: tables), little-endian: magic `FTAB` at 0, version u32 = 1 at 4, mode u32 at 8 (0 linear, 1 monotone), count u32 at 12 (2 to 4,096; exactly that many points follow), then x[i] f64 from 16, strictly increasing, then y[i] f64; every value finite.";

fn fn_table() -> String {
    let mut b = String::new();
    b += &fixed(
        0,
        4,
        "i32.load",
        "(i32.eq (local.get $v) (i32.const 0x42415446))",
    );
    b += &fixed(4, 4, "i32.load", "(i32.eq (local.get $v) (i32.const 1))");
    b += &fixed(8, 4, "i32.load", "(i32.le_u (local.get $v) (i32.const 1))");
    b += &fixed(12, 4, "i32.load", "(i32.and (i32.ge_u (local.get $v) (i32.const 2)) (i32.le_u (local.get $v) (i32.const 4096)))");
    b += &format!(
        "    (if (i64.ne (i64.add (i64.const 16) (i64.mul (i64.extend_i32_u (local.get $v)) (i64.const 16))) (i64.extend_i32_u (local.get $len)))
      (then (return (i64.const 12))))
    (local.set $c (local.get $v))
    (local.set $p (i32.const 16))
    (block $done (loop $x
      (br_if $done (i32.ge_u (local.get $i) (local.get $c)))
      (if (i32.eqz (call $ok64 {P})) (then {b}))
      (local.set $x (f64.load {P}))
      (if (i32.and (i32.ne (local.get $i) (i32.const 0)) (i32.eqz (f64.gt (local.get $x) (local.get $prev)))) (then {b}))
      (local.set $prev (local.get $x))
      (local.set $p {p8})
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $x)))
    (local.set $i (i32.const 0))
    (block $ydone (loop $y
      (br_if $ydone (i32.ge_u (local.get $i) (local.get $c)))
      (if (i32.eqz (call $ok64 {P})) (then {b}))
      (local.set $p {p8})
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $y)))
",
        b = bad(P),
        p8 = at_p(8),
    );
    module("(local $v i32) (local $c i32) (local $p i32) (local $i i32) (local $x f64) (local $prev f64)", &b)
}

fn fn_table_field(b: &[u8], off: u64) -> String {
    match off {
        0..=3 => "header.magic".into(),
        4..=7 => "header.version".into(),
        8..=11 => "header.mode".into(),
        12..=15 => "header.count".into(),
        _ => {
            let c = u64::from(u32_at(b, 12).unwrap_or(0));
            let i = (off - 16) / 8;
            if i < c {
                format!("x[{i}]")
            } else {
                format!("y[{}]", i - c)
            }
        }
    }
}

/// A fn.table@1 asset, mode linear.
pub fn fn_table_bytes(x: &[f64], y: &[f64]) -> Vec<u8> {
    let mut w = b"FTAB".to_vec();
    for v in [1u32, 0, x.len() as u32] {
        w.extend(v.to_le_bytes());
    }
    for v in x.iter().chain(y) {
        w.extend(v.to_le_bytes());
    }
    w
}

// ---- table.layout@1

const TABLE_DOC: &str = "A catalog (Asset: tables: catalogs), little-endian. Header: magic `TBLE` at 0, version u32 = 1 at 4, table_count u32 at 8 (at most 256), pool_at u32 at 12 and pool_count u32 at 16, the shared u32 pool of `refs` columns, inside the asset. Then a directory per table: tables[i].name_hash u32, tables[i].row_count u32, tables[i].column_count u32 (at most 256), and per column tables[i].columns[j].name_hash u32, .type u32 (0 i32, 1 f64, 2 bool, 3 ref, 4 refs, 5 copy), .at u32 (its values' offset, after the directory) and .target u32 (for ref and refs the table it names, below table_count; else 0): 16 bytes. Each column's row_count values lie inside the asset: i32 and copy 4 bytes, f64 8 (finite), bool 1 (0 or 1), ref a u32 row of its target (below its row_count, or 0xFFFFFFFF for a missing ID), refs a u32 offset and count inside the pool. Rows are sorted by the u32 hash of their ID.";

fn table_layout() -> String {
    let mut b = String::new();
    b += &fixed(
        0,
        4,
        "i32.load",
        "(i32.eq (local.get $v) (i32.const 0x454c4254))",
    );
    b += &fixed(4, 4, "i32.load", "(i32.eq (local.get $v) (i32.const 1))");
    b += &fixed(
        8,
        4,
        "i32.load",
        "(i32.le_u (local.get $v) (i32.const 256))",
    );
    b += "    (local.set $tc (local.get $v))\n";
    b += &fixed(12, 4, "i32.load", "(i32.const 1)");
    b += "    (local.set $pool (local.get $v))\n";
    b += &fixed(16, 4, "i32.load", "(i32.const 1)");
    b += "    (if (i64.gt_u (i64.add (i64.extend_i32_u (local.get $pool)) (i64.mul (i64.extend_i32_u (local.get $v)) (i64.const 4))) (i64.extend_i32_u (local.get $len))) (then (return (i64.const 12))))\n";
    b += "    (local.set $pc (local.get $v))\n";
    // The directory: each table's header and its columns' entries, inside the asset.
    b += &format!(
        "    (local.set $p (i32.const 20))
    (block $dir_done (loop $dir
      (br_if $dir_done (i32.ge_u (local.get $i) (local.get $tc)))
      {need12}
      (local.set $cc (i32.load offset=8 {P}))
      (if (i32.gt_u (local.get $cc) (i32.const 256)) (then {b8}))
      (local.set $p {p12})
      {needc}
      (local.set $j (i32.const 0))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_u (local.get $j) (local.get $cc)))
        (if (i32.gt_u (i32.load offset=4 {P}) (i32.const 5)) (then {b4}))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (local.set $p {p16})
        (br $cols)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $dir)))
    (local.set $end (local.get $p))
    (if (i32.and (i32.ne (local.get $pc) (i32.const 0)) (i32.lt_u (local.get $pool) (local.get $end))) (then (return (i64.const 12))))
",
        need12 = need(P, "(i32.const 12)"),
        needc = need(P, "(i32.mul (local.get $cc) (i32.const 16))"),
        b8 = bad(&at_p(8)),
        b4 = bad(&at_p(4)),
        p12 = at_p(12),
        p16 = at_p(16),
    );
    // Each column's values: inside the asset, after the directory, and each value in range.
    b += &format!(
        "    (local.set $p (i32.const 20))
    (local.set $i (i32.const 0))
    (block $t_done (loop $t
      (br_if $t_done (i32.ge_u (local.get $i) (local.get $tc)))
      (local.set $rows (i32.load offset=4 {P}))
      (local.set $cc (i32.load offset=8 {P}))
      (local.set $p {p12})
      (local.set $j (i32.const 0))
      (block $c_done (loop $c
        (br_if $c_done (i32.ge_u (local.get $j) (local.get $cc)))
        (local.set $ty (i32.load offset=4 {P}))
        (local.set $at (i32.load offset=8 {P}))
        (local.set $w (select (i32.const 8) (select (i32.const 1) (i32.const 4) (i32.eq (local.get $ty) (i32.const 2))) (i32.or (i32.eq (local.get $ty) (i32.const 1)) (i32.eq (local.get $ty) (i32.const 4)))))
        (if (i32.or (i32.lt_u (local.get $at) (local.get $end))
              (i64.gt_u (i64.add (i64.extend_i32_u (local.get $at)) (i64.mul (i64.extend_i32_u (local.get $rows)) (i64.extend_i32_u (local.get $w)))) (i64.extend_i32_u (local.get $len))))
          (then {b8}))
        (if (i32.or (i32.eq (local.get $ty) (i32.const 3)) (i32.eq (local.get $ty) (i32.const 4)))
          (then
            (if (i32.ge_u (i32.load offset=12 {P}) (local.get $tc)) (then {b12}))
            (local.set $target (call $rows_of (i32.load offset=12 {P})))))
        (local.set $r (i32.const 0))
        (block $v_done (loop $vals
          (br_if $v_done (i32.ge_u (local.get $r) (local.get $rows)))
          (local.set $q (i32.add (local.get $at) (i32.mul (local.get $r) (local.get $w))))
          (if (i32.eq (local.get $ty) (i32.const 1)) (then (if (i32.eqz (call $ok64 (local.get $q))) (then {bq}))))
          (if (i32.eq (local.get $ty) (i32.const 2)) (then (if (i32.gt_u (i32.load8_u (local.get $q)) (i32.const 1)) (then {bq}))))
          (if (i32.eq (local.get $ty) (i32.const 3))
            (then (if (i32.and (i32.ge_u (i32.load (local.get $q)) (local.get $target)) (i32.ne (i32.load (local.get $q)) (i32.const -1))) (then {bq}))))
          (if (i32.eq (local.get $ty) (i32.const 4))
            (then (if (i64.gt_u (i64.add (i64.load32_u (local.get $q)) (i64.load32_u offset=4 (local.get $q))) (i64.extend_i32_u (local.get $pc))) (then {bq}))))
          (local.set $r (i32.add (local.get $r) (i32.const 1)))
          (br $vals)))
        (local.set $p {p16})
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $c)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $t)))
",
        p12 = at_p(12),
        p16 = at_p(16),
        b8 = bad(&at_p(8)),
        b12 = bad(&at_p(12)),
        bq = bad("(local.get $q)"),
    );
    let text = module(
        "(local $v i32) (local $tc i32) (local $pool i32) (local $pc i32) (local $p i32) (local $i i32) (local $j i32) (local $cc i32) (local $end i32) (local $rows i32) (local $ty i32) (local $at i32) (local $w i32) (local $target i32) (local $r i32) (local $q i32)",
        &b,
    );
    // The row count of table `t`, walking a directory the first pass found inside the asset.
    text.replacen(
        "  (func (export \"validate\")",
        "  (func $rows_of (param $t i32) (result i32) (local $p i32) (local $i i32)
    (local.set $p (i32.const 20))
    (block $done (loop $walk
      (br_if $done (i32.ge_u (local.get $i) (local.get $t)))
      (local.set $p (i32.add (local.get $p) (i32.add (i32.const 12) (i32.mul (i32.load offset=8 (local.get $p)) (i32.const 16)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $walk)))
    (i32.load offset=4 (local.get $p)))
  (func (export \"validate\")",
        1,
    )
}

fn table_field(b: &[u8], off: u64) -> String {
    let header = ["magic", "version", "table_count", "pool_at", "pool_count"];
    if off < 20 {
        return format!("header.{}", header[(off / 4) as usize]);
    }
    let tc = u64::from(u32_at(b, 8).unwrap_or(0).min(256));
    let mut p = 20u64;
    let mut cols = Vec::new();
    for i in 0..tc {
        if off < p + 12 {
            return format!(
                "tables[{i}].{}",
                ["name_hash", "row_count", "column_count"][((off - p) / 4) as usize]
            );
        }
        let rows = u64::from(u32_at(b, p + 4).unwrap_or(0));
        let cc = u64::from(u32_at(b, p + 8).unwrap_or(0).min(256));
        p += 12;
        for j in 0..cc {
            if off < p + 16 {
                return format!(
                    "tables[{i}].columns[{j}].{}",
                    ["name_hash", "type", "at", "target"][((off - p) / 4) as usize]
                );
            }
            let ty = u32_at(b, p + 4).unwrap_or(0);
            let at = u64::from(u32_at(b, p + 8).unwrap_or(0));
            let w = match ty {
                1 | 4 => 8,
                2 => 1,
                _ => 4,
            };
            cols.push((i, j, at, rows, w));
            p += 16;
        }
    }
    for (i, j, at, rows, w) in cols {
        if off >= at && off < at + rows * w {
            return format!("tables[{i}].columns[{j}].values[{}]", (off - at) / w);
        }
    }
    let pool = u64::from(u32_at(b, 12).unwrap_or(0));
    if off >= pool {
        return format!("pool[{}]", (off - pool) / 4);
    }
    "directory".into()
}

/// A two-table catalog: items with an i32, an f64, a bool and a ref into creatures, and
/// creatures with a refs column into the pool. Its twin's ref names row 2 of a 2-row table.
pub fn catalog(bad_ref: bool) -> Vec<u8> {
    let u32s = |w: &mut Vec<u8>, v: u32| w.extend(v.to_le_bytes());
    // Directory: 20 + (12 + 4×16) + (12 + 16) = 124 bytes; then the values.
    let items_at = 124u32;
    let (i32_at, f64_at, bool_at, ref_at) = (items_at, items_at + 8, items_at + 24, items_at + 26);
    let refs_at = ref_at + 8;
    let pool_at = refs_at + 16;
    let mut w = b"TBLE".to_vec();
    for v in [1, 2, pool_at, 3] {
        u32s(&mut w, v);
    }
    for v in [0x1111_1111, 2, 4] {
        u32s(&mut w, v);
    }
    for (ty, at, target) in [
        (0, i32_at, 0),
        (1, f64_at, 0),
        (2, bool_at, 0),
        (3, ref_at, 1),
    ] {
        for v in [0xA000_0000 + ty, ty, at, target] {
            u32s(&mut w, v);
        }
    }
    for v in [0x2222_2222, 2, 1, 0xB000_0000, 4, refs_at, 0] {
        u32s(&mut w, v);
    }
    for v in [7i32, 9] {
        w.extend(v.to_le_bytes());
    }
    for v in [1.5f64, 2.5] {
        w.extend(v.to_le_bytes());
    }
    w.extend([1u8, 0]);
    for v in [1, if bad_ref { 2 } else { 0 }] {
        u32s(&mut w, v);
    }
    for v in [0, 2, 2, 1] {
        u32s(&mut w, v);
    }
    for v in [0, 1, 0] {
        u32s(&mut w, v);
    }
    w
}
