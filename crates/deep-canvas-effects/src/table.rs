//! The core's op table (canvas primitives: Step and the closed step list; Every public step): the
//! base entries of the registry `gpu.step@1`, each with its ports, its cost weight, its texture
//! fetches, whether it can be exact and the operator kinds it may appear in. The table is closed:
//! no pack, plug-in or document adds an entry.

/// The table's version; it enters every operator's pipeline key.
pub const VERSION: u32 = 1;

pub const MATERIAL: u8 = 1;
pub const PASS: u8 = 2;
pub const COMPUTE: u8 = 4;
pub const ALL: u8 = MATERIAL | PASS | COMPUTE;

/// One entry of `gpu.step@1`.
#[derive(Debug)]
pub struct Def {
    /// `name@major`.
    pub name: &'static str,
    /// Its argument ports, in the order the emitter passes them.
    pub ports: &'static [&'static str],
    /// Cost units per evaluation: about 1 for an add or a compare, 4 for a divide or a square
    /// root, 8 for a transcendental, 16 per noise octave (estimates until measured).
    pub weight: f64,
    pub fetches: u32,
    /// Exact when every value it reads and writes is an integer or a bool.
    pub exact: bool,
    pub kinds: u8,
}

const fn d(
    name: &'static str,
    ports: &'static [&'static str],
    weight: f64,
    exact: bool,
    kinds: u8,
) -> Def {
    Def {
        name,
        ports,
        weight,
        fetches: 0,
        exact,
        kinds,
    }
}

const fn tex(name: &'static str, ports: &'static [&'static str], exact: bool, kinds: u8) -> Def {
    Def {
        name,
        ports,
        weight: 1.0,
        fetches: 1,
        exact,
        kinds,
    }
}

const A: &[&str] = &["a", "b"];
const X: &[&str] = &["x"];
const NONE: &[&str] = &[];

/// The base entries, sorted by name.
pub const TABLE: &[Def] = &[
    d("abs@1", X, 1.0, true, ALL),
    d("acos@1", X, 8.0, false, ALL),
    d("add@1", A, 1.0, true, ALL),
    d("all@1", X, 1.0, true, ALL),
    d("and@1", A, 1.0, true, ALL),
    d("any@1", X, 1.0, true, ALL),
    d("asin@1", X, 8.0, false, ALL),
    d("atan2@1", &["y", "x"], 8.0, false, ALL),
    d("atan@1", X, 8.0, false, ALL),
    d("bitcast@1", X, 0.0, true, ALL),
    d("camera@1", NONE, 0.0, false, MATERIAL | PASS),
    d("ceil@1", X, 1.0, true, ALL),
    d("clamp@1", &["x", "lo", "hi"], 2.0, true, ALL),
    d("compose@1", &["x", "y", "z", "w"], 0.0, true, ALL),
    d("const@1", NONE, 0.0, true, ALL),
    d("convert@1", X, 1.0, true, ALL),
    d("cos@1", X, 8.0, false, ALL),
    d("count_ones@1", X, 1.0, true, ALL),
    d("cross@1", A, 6.0, false, ALL),
    d("ddx@1", X, 1.0, false, MATERIAL | PASS),
    d("ddy@1", X, 1.0, false, MATERIAL | PASS),
    d("discard_if@1", &["cond"], 1.0, true, MATERIAL),
    d("distance@1", A, 6.0, false, ALL),
    d("div@1", A, 4.0, true, ALL),
    d("dot@1", A, 3.0, true, ALL),
    d("element@1", NONE, 0.0, true, COMPUTE),
    d("eq@1", A, 1.0, true, ALL),
    d("exp2@1", X, 8.0, false, ALL),
    d("exp@1", X, 8.0, false, ALL),
    d("first_leading_bit@1", X, 1.0, true, ALL),
    d("first_trailing_bit@1", X, 1.0, true, ALL),
    d("floor@1", X, 1.0, true, ALL),
    d("fract@1", X, 1.0, false, ALL),
    d("fwidth@1", X, 2.0, false, MATERIAL | PASS),
    d("ge@1", A, 1.0, true, ALL),
    d("gt@1", A, 1.0, true, ALL),
    d("hash@1", &["a", "b", "c", "d"], 6.0, true, ALL),
    d("index@1", &["a", "i"], 1.0, true, ALL),
    d("inverse_sqrt@1", X, 4.0, false, ALL),
    d("le@1", A, 1.0, true, ALL),
    d("length@1", X, 6.0, false, ALL),
    tex("load@1", &["tex", "ixy"], true, ALL),
    d("log2@1", X, 8.0, false, ALL),
    d("log@1", X, 8.0, false, ALL),
    d("lt@1", A, 1.0, true, ALL),
    d("luminance@1", &["rgb"], 3.0, false, MATERIAL | PASS),
    d("max@1", A, 1.0, true, ALL),
    d("min@1", A, 1.0, true, ALL),
    d("mix@1", &["a", "b", "t"], 3.0, false, ALL),
    d("mod@1", A, 4.0, false, ALL),
    d("mul@1", A, 1.0, true, ALL),
    d("ne@1", A, 1.0, true, ALL),
    d("neg@1", X, 1.0, true, ALL),
    d("normalize@1", X, 6.0, false, ALL),
    d("not@1", X, 1.0, true, ALL),
    d("or@1", A, 1.0, true, ALL),
    d("pixel@1", NONE, 0.0, true, MATERIAL | PASS),
    d("pow@1", A, 8.0, false, ALL),
    d("rand@1", &["key"], 7.0, false, ALL),
    tex("read@1", &["buf", "i"], true, ALL),
    d("rem@1", A, 4.0, true, ALL),
    d("repeat@1", NONE, 0.0, true, ALL),
    d("round@1", X, 1.0, true, ALL),
    tex("sample@1", &["tex", "uv", "lod"], false, ALL),
    d("screen_size@1", NONE, 0.0, false, MATERIAL | PASS),
    d("screen_uv@1", NONE, 1.0, false, MATERIAL | PASS),
    d("seed@1", NONE, 0.0, true, ALL),
    d("select@1", &["f", "t", "cond"], 1.0, true, ALL),
    d("shl@1", A, 1.0, true, ALL),
    d("shr@1", A, 1.0, true, ALL),
    d("sign@1", X, 1.0, true, ALL),
    d("sin@1", X, 8.0, false, ALL),
    d("size@1", &["tex"], 1.0, true, ALL),
    d("smoothstep@1", &["lo", "hi", "x"], 6.0, false, ALL),
    d("split@1", X, 0.0, true, ALL),
    d("sqrt@1", X, 4.0, false, ALL),
    d("sub@1", A, 1.0, true, ALL),
    d("t@1", NONE, 0.0, false, ALL),
    d("tan@1", X, 8.0, false, ALL),
    d("transpose@1", X, 4.0, false, ALL),
    d("trunc@1", X, 1.0, true, ALL),
    d("write@1", &["buf", "i", "v"], 1.0, true, COMPUTE),
    d("xor@1", A, 1.0, true, ALL),
];

/// The entry for `name@major`, if the table has it.
pub fn def(name: &str) -> Option<&'static Def> {
    TABLE
        .binary_search_by(|d| d.name.cmp(name))
        .ok()
        .map(|i| &TABLE[i])
}

#[cfg(test)]
mod tests {
    #[test]
    fn sorted_for_lookup() {
        let names: Vec<&str> = super::TABLE.iter().map(|d| d.name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
    }
}
