//! The core's op table (canvas primitives: Step and the closed step list; Every public step): the
//! base entries of the registry `gpu.step@1`, which the core's GPU layer declares (issue #200),
//! each with its ports, its cost weight, its texture fetches, whether it can be exact and the
//! operator kinds it may appear in. No pack, plug-in or document adds an entry; a canvas module
//! adds one through the registry, with its exactness fixture and planted twin.
//!
//! Each base step also has its exactness fixture, cases whose expected values come from WGSL's
//! definitions (the i32 add's from the WebGPU CTS: 2147483647 + 1 is -2147483648), and its planted
//! twin, a wrong evaluation the fixture must refuse ([`base_entries`], [`exactness`]).

use serde_json::Value;

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
    /// root, 8 for a transcendental (estimates until measured); 180 per noise octave, measured
    /// by the calibration run (a noise octave is nine integer hashes and its gradients).
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
/// A storage statement's ports: the buffer, the index and the value.
const W: &[&str] = &["buf", "i", "v"];
/// A seeded step's ports: the point and the seed.
const NOISE: &[&str] = &["p", "seed"];

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
    d("atomic_add@1", W, 2.0, true, COMPUTE),
    d("atomic_and@1", W, 2.0, true, COMPUTE),
    d("atomic_max@1", W, 2.0, true, COMPUTE),
    d("atomic_min@1", W, 2.0, true, COMPUTE),
    d("atomic_or@1", W, 2.0, true, COMPUTE),
    d("atomic_xor@1", W, 2.0, true, COMPUTE),
    d("bitcast@1", X, 0.0, true, ALL),
    d("blend@1", &["base", "over"], 20.0, false, MATERIAL | PASS),
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
    // Fractal noise: `octaves` (1 to 8, a literal) of noise@1, so its weight is per octave.
    d("fbm@1", NOISE, 180.0, false, ALL),
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
    // Gradient noise on the integer lattice hash: one octave.
    d("noise@1", NOISE, 180.0, false, ALL),
    // A geometry step: the surface's normal in `space` (object, world or view).
    d("normal@1", NONE, 0.0, false, MATERIAL),
    d("normalize@1", X, 6.0, false, ALL),
    d("not@1", X, 1.0, true, ALL),
    d("or@1", A, 1.0, true, ALL),
    d("pixel@1", NONE, 0.0, true, MATERIAL | PASS),
    d("pow@1", A, 8.0, false, ALL),
    d("rand@1", &["key"], 7.0, false, ALL),
    tex("read@1", &["buf", "i"], true, ALL),
    d("rem@1", A, 4.0, true, ALL),
    d("repeat@1", NONE, 0.0, true, ALL),
    // A look role's color, theme-resolved: the check binds it as an input (`x`); status roles are
    // never reachable.
    d("role@1", X, 0.0, false, MATERIAL | PASS),
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
    d("write@1", W, 1.0, true, COMPUTE),
    d("xor@1", A, 1.0, true, ALL),
];

/// The entry for `name@major`, if the table has it.
pub fn def(name: &str) -> Option<&'static Def> {
    TABLE
        .binary_search_by(|d| d.name.cmp(name))
        .ok()
        .map(|i| &TABLE[i])
}

/// A value a step reads or writes in its fixture: `{"i": n}` an i32, `{"u": n}` a u32, `{"f": x}`
/// an f32 (held in f64), `{"b": x}` a bool, `{"v": [..]}`, `{"uv": [..]}` and `{"bv": [..]}`
/// vectors, `{"m": [column, ..]}` a matrix, `{"tex": [row, ..]}` a texture and `{"buf": [..]}` a
/// storage buffer.
#[derive(Clone, Debug, PartialEq)]
pub enum V {
    I(i32),
    U(u32),
    F(f64),
    B(bool),
    Vf(Vec<f64>),
    UVec(Vec<u32>),
    BVec(Vec<bool>),
    Mat(Vec<Vec<f64>>),
    Tex(Vec<Vec<f64>>),
    Buf(Vec<f64>),
}

impl V {
    /// A typed value from its fixture form.
    pub fn read(v: &Value) -> Result<V, String> {
        let (key, x) = v
            .as_object()
            .and_then(|o| o.iter().next())
            .ok_or_else(|| format!("{v} is not a typed value"))?;
        let nums = |x: &Value| -> Result<Vec<f64>, String> {
            x.as_array()
                .map(|a| a.iter().filter_map(Value::as_f64).collect())
                .ok_or_else(|| format!("{x} is not a list"))
        };
        let rows = |x: &Value| -> Result<Vec<Vec<f64>>, String> {
            x.as_array()
                .ok_or_else(|| format!("{x} is not a list of lists"))?
                .iter()
                .map(nums)
                .collect()
        };
        Ok(match key.as_str() {
            "i" => V::I(
                x.as_i64()
                    .and_then(|n| i32::try_from(n).ok())
                    .ok_or("not an i32")?,
            ),
            "u" => V::U(
                x.as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or("not a u32")?,
            ),
            "f" => V::F(x.as_f64().ok_or("not a number")?),
            "b" => V::B(x.as_bool().ok_or("not a bool")?),
            "v" => V::Vf(nums(x)?),
            "uv" => V::UVec(nums(x)?.into_iter().map(|n| n as u32).collect()),
            "bv" => V::BVec(
                x.as_array()
                    .map(|a| a.iter().filter_map(Value::as_bool).collect())
                    .ok_or("not a list")?,
            ),
            "m" => V::Mat(rows(x)?),
            "tex" => V::Tex(rows(x)?),
            "buf" => V::Buf(nums(x)?),
            other => return Err(format!("`{other}` is not a type a fixture writes")),
        })
    }

    fn f(&self) -> Result<f64, String> {
        match self {
            V::F(x) => Ok(*x),
            V::I(n) => Ok(f64::from(*n)),
            V::U(n) => Ok(f64::from(*n)),
            other => Err(format!("{other:?} is not a scalar")),
        }
    }

    fn lanes(&self) -> Result<Vec<f64>, String> {
        match self {
            V::Vf(v) => Ok(v.clone()),
            V::UVec(v) => Ok(v.iter().map(|n| f64::from(*n)).collect()),
            other => Ok(vec![other.f()?]),
        }
    }
}

/// The WGSL meaning of each base step, on fixture values, with `env` holding what a nullary,
/// derivative or texture step reads, and `to` a conversion's target type.
fn base(step: &str, a: &[V], env: &Value, to: Option<&str>) -> Result<V, String> {
    use V::*;
    let name = step.split('@').next().unwrap_or(step);
    let arg = |i: usize| {
        a.get(i)
            .cloned()
            .ok_or_else(|| format!("{step} lacks argument {i}"))
    };
    let env_v = |k: &str| -> Result<V, String> {
        env.get(k)
            .ok_or_else(|| format!("{step} reads `{k}`, which its fixture's env lacks"))
            .and_then(V::read)
    };
    let env_nums = |k: &str| -> Result<Vec<f64>, String> {
        env.get(k)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .ok_or_else(|| format!("{step} reads `{k}`, which its fixture's env lacks"))
    };
    let float1 = |f: fn(f64) -> f64| -> Result<V, String> { Ok(F(f(arg(0)?.f()?))) };
    // A binary op over two values of one scalar type: i32 and u32 wrap.
    let num2 = |fi: fn(i32, i32) -> i32,
                fu: fn(u32, u32) -> u32,
                ff: fn(f64, f64) -> f64|
     -> Result<V, String> {
        Ok(match (arg(0)?, arg(1)?) {
            (I(x), I(y)) => I(fi(x, y)),
            (U(x), U(y)) => U(fu(x, y)),
            (Vf(x), Vf(y)) => Vf(x.iter().zip(&y).map(|(p, q)| ff(*p, *q)).collect()),
            (x, y) => F(ff(x.f()?, y.f()?)),
        })
    };
    let cmp =
        |f: fn(f64, f64) -> bool| -> Result<V, String> { Ok(B(f(arg(0)?.f()?, arg(1)?.f()?))) };
    let bits2 = |fb: fn(bool, bool) -> bool, fu: fn(u32, u32) -> u32| -> Result<V, String> {
        Ok(match (arg(0)?, arg(1)?) {
            (B(x), B(y)) => B(fb(x, y)),
            (I(x), I(y)) => I(fu(x as u32, y as u32) as i32),
            (U(x), U(y)) => U(fu(x, y)),
            (x, y) => {
                return Err(format!(
                    "{step} takes bools or integers, not {x:?} and {y:?}"
                ))
            }
        })
    };
    Ok(match name {
        "abs" => match arg(0)? {
            I(x) => I(x.wrapping_abs()),
            U(x) => U(x),
            x => F(x.f()?.abs()),
        },
        "acos" => float1(crate::ops::acos)?,
        "asin" => float1(crate::ops::asin)?,
        "atan" => float1(crate::ops::atan)?,
        "atan2" => F(crate::ops::atan2(arg(0)?.f()?, arg(1)?.f()?)),
        "cos" => float1(crate::ops::cos)?,
        "sin" => float1(crate::ops::sin)?,
        "tan" => float1(crate::ops::tan)?,
        "exp" => float1(crate::ops::exp)?,
        "exp2" => F(crate::ops::pow(2.0, arg(0)?.f()?)),
        "log" => float1(crate::ops::log)?,
        "log2" => float1(crate::ops::log2)?,
        "pow" => F(crate::ops::pow(arg(0)?.f()?, arg(1)?.f()?)),
        "sqrt" => float1(crate::ops::sqrt)?,
        "inverse_sqrt" => F(1.0 / crate::ops::sqrt(arg(0)?.f()?)),
        "add" => num2(i32::wrapping_add, u32::wrapping_add, |x, y| x + y)?,
        "sub" => num2(i32::wrapping_sub, u32::wrapping_sub, |x, y| x - y)?,
        "mul" => num2(i32::wrapping_mul, u32::wrapping_mul, |x, y| x * y)?,
        // An integer divided by zero, or i32's least by -1, is its dividend; its remainder 0.
        "div" => num2(
            |x, y| x.checked_div(y).unwrap_or(x),
            |x, y| x.checked_div(y).unwrap_or(x),
            |x, y| x / y,
        )?,
        "rem" => num2(
            |x, y| x.checked_rem(y).unwrap_or(0),
            |x, y| x.checked_rem(y).unwrap_or(0),
            |x, y| x - y * (x / y).trunc(),
        )?,
        "mod" => F({
            let (x, y) = (arg(0)?.f()?, arg(1)?.f()?);
            x - y * (x / y).floor()
        }),
        "min" => num2(i32::min, u32::min, f64::min)?,
        "max" => num2(i32::max, u32::max, f64::max)?,
        "neg" => match arg(0)? {
            I(x) => I(x.wrapping_neg()),
            x => F(-x.f()?),
        },
        "sign" => match arg(0)? {
            I(x) => I(x.signum()),
            x => {
                let v = x.f()?;
                F(if v > 0.0 {
                    1.0
                } else if v < 0.0 {
                    -1.0
                } else {
                    0.0
                })
            }
        },
        "floor" => float1(f64::floor)?,
        "ceil" => float1(f64::ceil)?,
        "trunc" => float1(f64::trunc)?,
        "fract" => float1(|x| x - x.floor())?,
        "round" => float1(|x| {
            let r = x.round();
            if (x - x.trunc()).abs() == 0.5 && r % 2.0 != 0.0 {
                r - x.signum()
            } else {
                r
            }
        })?,
        "clamp" => match (arg(0)?, arg(1)?, arg(2)?) {
            (I(x), I(lo), I(hi)) => I(x.max(lo).min(hi)),
            (U(x), U(lo), U(hi)) => U(x.max(lo).min(hi)),
            (x, lo, hi) => F(x.f()?.max(lo.f()?).min(hi.f()?)),
        },
        "mix" => {
            let (x, y, t) = (arg(0)?.f()?, arg(1)?.f()?, arg(2)?.f()?);
            F(x * (1.0 - t) + y * t)
        }
        "smoothstep" => {
            let (lo, hi, x) = (arg(0)?.f()?, arg(1)?.f()?, arg(2)?.f()?);
            let t = ((x - lo) / (hi - lo)).clamp(0.0, 1.0);
            F(t * t * (3.0 - 2.0 * t))
        }
        "select" => match arg(2)? {
            B(true) => arg(1)?,
            B(false) => arg(0)?,
            c => return Err(format!("select's cond is {c:?}, not a bool")),
        },
        "and" => bits2(|x, y| x && y, |x, y| x & y)?,
        "or" => bits2(|x, y| x || y, |x, y| x | y)?,
        "xor" => bits2(|x, y| x != y, |x, y| x ^ y)?,
        "not" => match arg(0)? {
            B(x) => B(!x),
            I(x) => I(!x),
            U(x) => U(!x),
            x => return Err(format!("not takes a bool or an integer, not {x:?}")),
        },
        "shl" | "shr" => {
            let by = match arg(1)? {
                U(n) => n & 31,
                I(n) => (n as u32) & 31,
                x => return Err(format!("{step} shifts by an integer, not {x:?}")),
            };
            match (arg(0)?, name) {
                (U(x), "shl") => U(x << by),
                (U(x), _) => U(x >> by),
                (I(x), "shl") => I(((x as u32) << by) as i32),
                (I(x), _) => I(x >> by),
                (x, _) => return Err(format!("{step} shifts an integer, not {x:?}")),
            }
        }
        "eq" => cmp(|x, y| x == y)?,
        "ne" => cmp(|x, y| x != y)?,
        "lt" => cmp(|x, y| x < y)?,
        "le" => cmp(|x, y| x <= y)?,
        "gt" => cmp(|x, y| x > y)?,
        "ge" => cmp(|x, y| x >= y)?,
        "all" | "any" => match arg(0)? {
            BVec(v) if name == "all" => B(v.iter().all(|b| *b)),
            BVec(v) => B(v.iter().any(|b| *b)),
            B(b) => B(b),
            x => return Err(format!("{step} takes bools, not {x:?}")),
        },
        "bitcast" => match arg(0)? {
            F(x) => U((x as f32).to_bits()),
            U(x) => F(f64::from(f32::from_bits(x))),
            I(x) => F(f64::from(f32::from_bits(x as u32))),
            x => return Err(format!("bitcast takes a scalar, not {x:?}")),
        },
        "convert" => {
            let x = arg(0)?.f()?;
            match to {
                Some("i32") if x.is_nan() => I(0),
                Some("i32") => I(x.trunc().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32),
                Some("u32") if x.is_nan() => U(0),
                Some("u32") => U(x.trunc().clamp(0.0, f64::from(u32::MAX)) as u32),
                Some("f32") => F(x),
                other => return Err(format!("convert to {other:?}")),
            }
        }
        "count_ones" => match arg(0)? {
            U(x) => U(x.count_ones()),
            I(x) => I(x.count_ones() as i32),
            x => return Err(format!("count_ones takes an integer, not {x:?}")),
        },
        "first_leading_bit" => match arg(0)? {
            U(0) => U(u32::MAX),
            U(x) => U(31 - x.leading_zeros()),
            I(0) | I(-1) => I(-1),
            I(x) if x < 0 => I(31 - (!(x as u32)).leading_zeros() as i32),
            I(x) => I(31 - (x as u32).leading_zeros() as i32),
            x => return Err(format!("first_leading_bit takes an integer, not {x:?}")),
        },
        "first_trailing_bit" => match arg(0)? {
            U(0) => U(u32::MAX),
            U(x) => U(x.trailing_zeros()),
            I(0) => I(-1),
            I(x) => I(x.trailing_zeros() as i32),
            x => return Err(format!("first_trailing_bit takes an integer, not {x:?}")),
        },
        "hash" => {
            let mut h = 0u32;
            for (i, x) in a.iter().enumerate() {
                let U(x) = x else {
                    return Err(format!("hash takes u32s, not {x:?}"));
                };
                h = if i == 0 { hash1(*x) } else { hash1(h ^ x) };
            }
            U(h)
        }
        "rand" => match arg(0)? {
            U(k) => F(f64::from(hash1(k) >> 8) * 5.960_464_5e-8),
            x => return Err(format!("rand's key is a u32, not {x:?}")),
        },
        // The fields a seeded step takes beside its ports are in the case's env.
        "noise" | "fbm" => {
            let p = arg(0)?.lanes()?;
            let U(seed) = arg(1)? else {
                return Err(format!("{step}'s seed is a u32"));
            };
            let field = |k: &str, or: f64| env.get(k).and_then(Value::as_f64).unwrap_or(or);
            let period = field("period", 0.0) as u32;
            let at = [
                p.first().copied().unwrap_or(0.0),
                p.get(1).copied().unwrap_or(0.0),
            ];
            F(if name == "noise" {
                noise2(at, seed, period)
            } else {
                fbm2(
                    at,
                    seed,
                    field("octaves", 4.0) as u32,
                    field("lacunarity", 2.0),
                    field("gain", 0.5),
                    period,
                )
            })
        }
        "compose" => Vf(a.iter().map(V::f).collect::<Result<_, _>>()?),
        "split" => arg(0)?,
        // A small array's index clamps into [0, n - 1] (structural steps, #483).
        "index" => {
            let v = arg(0)?.lanes()?;
            let i = (arg(1)?.f()?.max(0.0) as usize).min(v.len().saturating_sub(1));
            F(*v.get(i).ok_or("index into an empty array")?)
        }
        "with" => {
            let mut v = arg(0)?.lanes()?;
            let i = (arg(1)?.f()?.max(0.0) as usize).min(v.len().saturating_sub(1));
            *v.get_mut(i).ok_or("with on an empty array")? = arg(2)?.f()?;
            Vf(v)
        }
        "scan" | "compact" | "sort_by_key" | "iterate" | "load3d" | "sample3d" => {
            structural(name, a, env, "")?
        }
        "dot" => {
            let (x, y) = (arg(0)?.lanes()?, arg(1)?.lanes()?);
            F(x.iter().zip(&y).map(|(p, q)| p * q).sum())
        }
        "length" => F(crate::ops::sqrt(
            arg(0)?.lanes()?.iter().map(|x| x * x).sum(),
        )),
        "distance" => {
            let (x, y) = (arg(0)?.lanes()?, arg(1)?.lanes()?);
            F(crate::ops::sqrt(
                x.iter().zip(&y).map(|(p, q)| (p - q) * (p - q)).sum(),
            ))
        }
        "normalize" => {
            let x = arg(0)?.lanes()?;
            let n = crate::ops::sqrt(x.iter().map(|v| v * v).sum());
            Vf(x.iter().map(|v| v / n).collect())
        }
        "cross" => {
            let (p, q) = (arg(0)?.lanes()?, arg(1)?.lanes()?);
            if p.len() != 3 || q.len() != 3 {
                return Err("cross takes two vec3s".into());
            }
            Vf(vec![
                p[1] * q[2] - p[2] * q[1],
                p[2] * q[0] - p[0] * q[2],
                p[0] * q[1] - p[1] * q[0],
            ])
        }
        "transpose" => match arg(0)? {
            Mat(m) => Mat((0..m.len())
                .map(|r| m.iter().map(|c| c.get(r).copied().unwrap_or(0.0)).collect())
                .collect()),
            x => return Err(format!("transpose takes a matrix, not {x:?}")),
        },
        "blend" => {
            let (b, s) = (arg(0)?.lanes()?, arg(1)?.lanes()?);
            let (Ok(b), Ok(s)) = (<[f64; 3]>::try_from(b), <[f64; 3]>::try_from(s)) else {
                return Err("blend takes two rgbs".into());
            };
            let mode = env["mode"].as_str().and_then(crate::blend::step_mode);
            let mode = mode.ok_or("blend's mode is every group mode but dissolve")?;
            Vf(crate::blend::mix(mode, b, s).to_vec())
        }
        "luminance" => {
            let c = arg(0)?.lanes()?;
            if c.len() < 3 {
                return Err("luminance takes an rgb".into());
            }
            F(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
        }
        "discard_if" => match arg(0)? {
            B(c) => B(c),
            x => return Err(format!("discard_if's cond is {x:?}, not a bool")),
        },
        "ddx" => F(env_v("right")?.f()? - arg(0)?.f()?),
        "ddy" => F(env_v("below")?.f()? - arg(0)?.f()?),
        "fwidth" => {
            let x = arg(0)?.f()?;
            F((env_v("right")?.f()? - x).abs() + (env_v("below")?.f()? - x).abs())
        }
        "const" => env_v("value")?,
        "camera" => Vf(env_nums("camera")?),
        "normal" => Vf(env_nums("normal")?),
        "role" => arg(0)?,
        "pixel" => UVec(env_nums("pixel")?.into_iter().map(|n| n as u32).collect()),
        "screen_size" => Vf(env_nums("size")?),
        "screen_uv" => {
            let (p, s) = (env_nums("pixel")?, env_nums("size")?);
            Vf(p.iter().zip(&s).map(|(p, s)| (p + 0.5) / s).collect())
        }
        "element" | "seed" | "repeat" => U(env
            .get(name)
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| format!("{step} reads `{name}`, which its fixture's env lacks"))?),
        "t" => F(env.get("t").and_then(Value::as_f64).ok_or("t reads `t`")?),
        "load" | "sample" | "size" => {
            let Tex(rows) = arg(0)? else {
                return Err(format!("{step} reads a texture"));
            };
            let h = rows.len();
            let w: usize = rows.first().map_or(0, Vec::len);
            let at = |x: usize, y: usize| rows.get(y).and_then(|r| r.get(x)).copied();
            match name {
                "size" => UVec(vec![w as u32, h as u32]),
                "load" => {
                    let ixy = arg(1)?.lanes()?;
                    F(at(ixy[0] as usize, ixy[1] as usize).ok_or("load past the texture")?)
                }
                _ => {
                    let uv = arg(1)?.lanes()?;
                    let x = ((uv[0] * w as f64).floor() as usize).min(w.saturating_sub(1));
                    let y = ((uv[1] * h as f64).floor() as usize).min(h.saturating_sub(1));
                    F(at(x, y).ok_or("sample past the texture")?)
                }
            }
        }
        "read" => {
            let Buf(b) = arg(0)? else {
                return Err("read reads a storage buffer".into());
            };
            let i = arg(1)?.f()? as usize;
            F(*b.get(i).ok_or("read past the buffer")?)
        }
        // An atomic statement, whose result is never read: u32 words, wrapping.
        "atomic_add" | "atomic_min" | "atomic_max" | "atomic_and" | "atomic_or" | "atomic_xor" => {
            let Buf(mut b) = arg(0)? else {
                return Err(format!("{name} adds into a storage buffer"));
            };
            let i = arg(1)?.f()? as usize;
            let v = arg(2)?.f()? as u32;
            let w = b.get_mut(i).ok_or("an atomic past the buffer")?;
            let x = *w as u32;
            *w = f64::from(match name {
                "atomic_add" => x.wrapping_add(v),
                "atomic_min" => x.min(v),
                "atomic_max" => x.max(v),
                "atomic_and" => x & v,
                "atomic_or" => x | v,
                _ => x ^ v,
            });
            Buf(b)
        }
        "write" | "store" => {
            let Buf(mut b) = arg(0)? else {
                return Err("write writes a storage buffer".into());
            };
            let i = arg(1)?.f()? as usize;
            *b.get_mut(i).ok_or("write past the buffer")? = arg(2)?.f()?;
            Buf(b)
        }
        other => return Err(format!("`{other}` is no base step")),
    })
}

/// The fixed hash, as the effects module's WGSL writer and CPU reference write it.
/// The structural steps' meanings on fixture values (canvas primitives: Step and the closed step
/// list: structural steps, #483), and their planted twins: `scan` an exclusive prefix sum of u32
/// words wrapping at 2^32 (`inclusive` its twin); `compact` the flagged words in index order
/// (`atomic_order` keeps them in the order a racing counter might hand out, last first);
/// `sort_by_key` the values stably by key (`ties_by_decreasing_index` breaks ties the other way);
/// `iterate` its body (`env.body`, over `prev`) run `count` times, each run reading the last
/// (`first_run` feeds every run the first run's output); `load3d` and `sample3d` a texel of a
/// 3D texture of `env.size` held as a flat buffer (sample3d takes the texel nearest `uvw`).
fn structural(name: &str, a: &[V], env: &Value, twin: &str) -> Result<V, String> {
    let buf = |i: usize| match a.get(i) {
        Some(V::Buf(b)) => Ok(b.iter().map(|x| *x as u32).collect::<Vec<u32>>()),
        other => Err(format!("{name} takes storage, not {other:?}")),
    };
    let words = |w: Vec<u32>| V::Buf(w.into_iter().map(f64::from).collect());
    let count = |i: usize, len: usize| -> Result<usize, String> {
        Ok(match a.get(i) {
            Some(x) => (x.f()? as usize).min(len),
            None => len,
        })
    };
    Ok(match name {
        "scan" => {
            let x = buf(0)?;
            let mut acc = 0u32;
            words(
                x.iter()
                    .map(|v| {
                        let before = acc;
                        acc = acc.wrapping_add(*v);
                        if twin == "inclusive" {
                            acc
                        } else {
                            before
                        }
                    })
                    .collect(),
            )
        }
        "compact" => {
            let (x, f) = (buf(0)?, buf(1)?);
            let n = count(2, x.len().min(f.len()))?;
            let mut kept: Vec<u32> = (0..n).filter(|i| f[*i] != 0).map(|i| x[i]).collect();
            if twin == "atomic_order" {
                kept.reverse();
            }
            words(kept)
        }
        "sort_by_key" => {
            let (k, v) = (buf(0)?, buf(1)?);
            let n = count(2, k.len().min(v.len()))?;
            let mut at: Vec<usize> = (0..n).collect();
            if twin == "ties_by_decreasing_index" {
                at.sort_by(|p, q| k[*p].cmp(&k[*q]).then(q.cmp(p)));
            } else {
                at.sort_by_key(|i| k[*i]);
            }
            words(at.into_iter().map(|i| v[i]).collect())
        }
        "iterate" => {
            let n = a.first().ok_or("iterate takes a count")?.f()? as u32;
            let mut prev = a.get(1).cloned().ok_or("iterate takes a first input")?;
            let body = env.get("body").ok_or("iterate's fixture names no body")?;
            let first = run_body(body, &prev, env)?;
            for k in 0..n {
                prev = if twin == "first_run" && k > 0 {
                    run_body(body, &first, env)?
                } else {
                    run_body(body, &prev, env)?
                };
            }
            prev
        }
        "load3d" | "sample3d" => {
            let Some(V::Buf(raw)) = a.first() else {
                return Err(format!("{name} reads a 3D texture"));
            };
            let size: Vec<usize> = env
                .get("size")
                .and_then(Value::as_array)
                .map(|s| s.iter().filter_map(Value::as_u64).map(|x| x as usize).collect())
                .ok_or_else(|| format!("{name}'s fixture names no size"))?;
            if size.len() != 3 || raw.len() != size[0] * size[1] * size[2] {
                return Err(format!("{name}'s texture isn't its size"));
            }
            let p = a.get(1).ok_or("a 3D texel's place")?.lanes()?;
            let at: Vec<usize> = (0..3)
                .map(|c| {
                    let x = if name == "load3d" {
                        p[c]
                    } else {
                        (p[c] * size[c] as f64).floor()
                    };
                    (x.max(0.0) as usize).min(size[c] - 1)
                })
                .collect();
            V::F(raw[(at[2] * size[1] + at[1]) * size[0] + at[0]])
        }
        other => return Err(format!("`{other}` is no structural step")),
    })
}

/// A body node over `prev` (iterate's fixture), as an `impl.body` is over ports.
fn run_body(e: &Value, prev: &V, env: &Value) -> Result<V, String> {
    match e {
        Value::String(p) if p == "prev" => Ok(prev.clone()),
        Value::Number(n) => Ok(V::F(n.as_f64().unwrap_or(0.0))),
        Value::Array(list) => {
            let (op, rest) = list.split_first().ok_or("an empty body node")?;
            let op = op.as_str().ok_or("a body node names a step")?;
            let vals: Vec<V> = rest
                .iter()
                .map(|x| run_body(x, prev, env))
                .collect::<Result<_, _>>()?;
            base(&format!("{op}@1"), &vals, env, None)
        }
        other => Err(format!("{other} is no body node")),
    }
}

pub fn hash1(x: u32) -> u32 {
    let s = x.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    let w = ((s >> ((s >> 28) + 4)) ^ s).wrapping_mul(277_803_737);
    (w >> 22) ^ w
}

/// One lattice corner of noise@1: its gradient, two lanes in [-1, 1) from the hash of the
/// corner (wrapped into `period` cells when it is above 0) and the seed's hash `hs`, dotted with
/// the offset `(dx, dy)` from the corner.
fn corner(hs: u32, cx: i32, cy: i32, period: u32, dx: f64, dy: f64) -> f64 {
    let (x, y) = match i32::try_from(period) {
        Ok(p) if p > 0 => (cx.rem_euclid(p), cy.rem_euclid(p)),
        _ => (cx, cy),
    };
    let h = hash1(hash1(hs ^ x as u32) ^ y as u32);
    let gx = f64::from(h & 0xffff) / 32768.0 - 1.0;
    let gy = f64::from(h >> 16) / 32768.0 - 1.0;
    gx * dx + gy * dy
}

/// `noise@1`: 2D gradient noise on the integer lattice hash, about [-1, 1], 0 at every lattice
/// point; with `period` above 0 it repeats every `period` cells on each axis. The effects
/// module's WGSL writer and its f64 interpreter both write this function.
pub fn noise2(p: [f64; 2], seed: u32, period: u32) -> f64 {
    let (ix, iy) = (p[0].floor(), p[1].floor());
    let (fx, fy) = (p[0] - ix, p[1] - iy);
    let (cx, cy) = (ix as i32, iy as i32);
    let hs = hash1(seed);
    let fade = |t: f64| t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    let (ux, uy) = (fade(fx), fade(fy));
    let mix = |a: f64, b: f64, t: f64| a * (1.0 - t) + b * t;
    let (x1, y1) = (cx.wrapping_add(1), cy.wrapping_add(1));
    let bottom = mix(
        corner(hs, cx, cy, period, fx, fy),
        corner(hs, x1, cy, period, fx - 1.0, fy),
        ux,
    );
    let top = mix(
        corner(hs, cx, y1, period, fx, fy - 1.0),
        corner(hs, x1, y1, period, fx - 1.0, fy - 1.0),
        ux,
    );
    mix(bottom, top, uy)
}

/// `fbm@1`: `octaves` of [`noise2`], octave k at `p × lacunarity^k` with seed `seed + k` and
/// weight `gain^k`, over the sum of the weights; a period grows by the lacunarity each octave.
pub fn fbm2(p: [f64; 2], seed: u32, octaves: u32, lacunarity: f64, gain: f64, period: u32) -> f64 {
    let (mut sum, mut amp, mut norm, mut q, mut per) = (0.0, 1.0, 0.0, p, period);
    for k in 0..octaves {
        sum += amp * noise2(q, seed.wrapping_add(k), per);
        norm += amp;
        amp *= gain;
        q = [q[0] * lacunarity, q[1] * lacunarity];
        per = per.wrapping_mul(lacunarity as u32);
    }
    sum / norm
}

/// A value moved by one: an integer by one (wrapping), a float by 1.0, a bool flipped, a list's
/// first lane moved.
fn bump(v: V) -> V {
    match v {
        V::I(x) => V::I(x.wrapping_add(1)),
        V::U(x) => V::U(x.wrapping_add(1)),
        V::F(x) => V::F(x + 1.0),
        V::B(x) => V::B(!x),
        V::Vf(mut v) if !v.is_empty() => {
            v[0] += 1.0;
            V::Vf(v)
        }
        V::Buf(mut v) if !v.is_empty() => {
            v[0] += 1.0;
            V::Buf(v)
        }
        V::UVec(mut v) if !v.is_empty() => {
            v[0] = v[0].wrapping_add(1);
            V::UVec(v)
        }
        V::BVec(mut v) if !v.is_empty() => {
            v[0] = !v[0];
            V::BVec(v)
        }
        V::Mat(mut m) if !m.is_empty() && !m[0].is_empty() => {
            m[0][0] += 1.0;
            V::Mat(m)
        }
        other => other,
    }
}

/// A planted twin's wrong evaluation: `saturate` (an integer add, sub or mul that saturates
/// instead of wrapping), `unmasked` (a shift by the whole count, not its low five bits) or
/// `off_by_one` (the result moved by one).
fn twisted(step: &str, a: &[V], env: &Value, to: Option<&str>, perturb: &str) -> Result<V, String> {
    let name = step.split('@').next().unwrap_or(step);
    match (perturb, name, a) {
        ("saturate", "add" | "sub" | "mul", [V::I(x), V::I(y)]) => Ok(V::I(match name {
            "add" => x.saturating_add(*y),
            "sub" => x.saturating_sub(*y),
            _ => x.saturating_mul(*y),
        })),
        ("saturate", "add" | "sub" | "mul", [V::U(x), V::U(y)]) => Ok(V::U(match name {
            "add" => x.saturating_add(*y),
            "sub" => x.saturating_sub(*y),
            _ => x.saturating_mul(*y),
        })),
        ("unmasked", "shl" | "shr", [x, V::U(by)]) if *by >= 32 => Ok(match x {
            V::I(_) => V::I(0),
            _ => V::U(0),
        }),
        ("off_by_one", _, _) => Ok(bump(base(step, a, env, to)?)),
        ("wraps", "index", [arr, i]) => {
            let v = arr.lanes()?;
            let n = v.len().max(1);
            Ok(V::F(v[(i.f()?.max(0.0) as usize) % n]))
        }
        ("ties_by_decreasing_index" | "inclusive" | "atomic_order" | "first_run", _, _) => {
            structural(name, a, env, perturb)
        }
        ("", _, _) | ("saturate" | "unmasked", _, _) => base(step, a, env, to),
        (other, _, _) => Err(format!("`{other}` is no twin")),
    }
}

/// A step entry's evaluation on one case: its `impl`, `{"base": name}` (with an optional planted
/// `perturb`) or `{"body": expr}` over base steps, where `expr` is a port, a number or
/// `[step, expr..]`; `perturb` the twin's, on top.
pub fn eval(
    value: &Value,
    args: &[V],
    env: &Value,
    to: Option<&str>,
    perturb: &str,
) -> Result<V, String> {
    let imp = value.get("impl").ok_or("the step has no impl")?;
    if let Some(name) = imp.get("base").and_then(Value::as_str) {
        let own = imp.get("perturb").and_then(Value::as_str).unwrap_or("");
        // A twin of a planted step: its own fault, then the twin's on top, moved by one.
        return match (own, perturb) {
            ("", p) => twisted(name, args, env, to, p),
            (o, "") => twisted(name, args, env, to, o),
            (o, _) => Ok(bump(twisted(name, args, env, to, o)?)),
        };
    }
    let body = imp
        .get("body")
        .ok_or("the step's impl has neither base nor body")?;
    let ports: Vec<&str> = value
        .pointer("/signature/ports")
        .and_then(Value::as_array)
        .map(|p| p.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    fn walk(e: &Value, ports: &[&str], args: &[V], env: &Value) -> Result<V, String> {
        match e {
            Value::String(p) => ports
                .iter()
                .position(|q| q == p)
                .and_then(|i| args.get(i).cloned())
                .ok_or_else(|| format!("the body reads `{p}`, which is no port")),
            Value::Number(n) => Ok(V::F(n.as_f64().unwrap_or(0.0))),
            Value::Array(list) => {
                let (op, rest) = list.split_first().ok_or("an empty body node")?;
                let op = op.as_str().ok_or("a body node names a step")?;
                let vals: Vec<V> = rest
                    .iter()
                    .map(|x| walk(x, ports, args, env))
                    .collect::<Result<_, _>>()?;
                base(&format!("{op}@1"), &vals, env, None)
            }
            other => Err(format!("{other} is no body node")),
        }
    }
    let out = walk(body, &ports, args, env)?;
    Ok(if perturb.is_empty() { out } else { bump(out) })
}

/// Whether `got` is the fixture's `want`: integers and bools exactly; floats exactly for an
/// exact step and within 1e-6 of the larger magnitude otherwise.
fn same(got: &V, want: &V, exact: bool) -> bool {
    let close = |x: f64, y: f64| {
        if exact {
            x == y
        } else {
            (x - y).abs() <= 1e-6 * x.abs().max(y.abs()).max(1.0)
        }
    };
    let all =
        |x: &[f64], y: &[f64]| x.len() == y.len() && x.iter().zip(y).all(|(p, q)| close(*p, *q));
    match (got, want) {
        (V::F(x), V::F(y)) => close(*x, *y),
        (V::Vf(x), V::Vf(y)) | (V::Buf(x), V::Buf(y)) => all(x, y),
        (V::Mat(x), V::Mat(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| all(p, q)),
        _ => got == want,
    }
}

/// The step's fixture on its evaluation (`perturb` empty) or a twin's: the first case that
/// gives another value than it says, or why it can't run.
pub fn exactness(value: &Value, perturb: &str) -> Result<(), String> {
    let cases = value
        .get("fixture")
        .and_then(Value::as_array)
        .filter(|c| !c.is_empty())
        .ok_or("no exactness fixture")?;
    let exact = value.get("exact").and_then(Value::as_bool).unwrap_or(false);
    for (i, case) in cases.iter().enumerate() {
        let args: Vec<V> = case
            .get("args")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("case {i} has no args"))?
            .iter()
            .map(V::read)
            .collect::<Result<_, _>>()?;
        let want = V::read(
            case.get("expect")
                .ok_or_else(|| format!("case {i} expects nothing"))?,
        )?;
        let env = case.get("env").cloned().unwrap_or(Value::Null);
        let to = case.get("to").and_then(Value::as_str);
        let got = eval(value, &args, &env, to, perturb)?;
        if !same(&got, &want, exact) {
            return Err(format!(
                "case {i} {}: gives {got:?}, the fixture says {want:?}",
                case.get("args").cloned().unwrap_or(Value::Null)
            ));
        }
    }
    Ok(())
}

/// Each base step's exactness fixture, written from WGSL's definitions (steps.json).
fn fixtures() -> Value {
    serde_json::from_str(include_str!("steps.json")).expect("steps.json is JSON")
}

/// The twin each base step plants: integer add, sub and mul saturate; shifts go unmasked;
/// every other step's result moves by one.
fn twin_of(name: &str) -> &'static str {
    match name {
        "add@1" | "sub@1" | "mul@1" => "saturate",
        "shl@1" | "shr@1" => "unmasked",
        "index@1" => "wraps",
        _ => "off_by_one",
    }
}

/// The operator kinds a step may appear in, by name.
fn kinds_of(mask: u8) -> Vec<&'static str> {
    [(MATERIAL, "material"), (PASS, "pass"), (COMPUTE, "compute")]
        .into_iter()
        .filter(|(bit, _)| mask & bit != 0)
        .map(|(_, n)| n)
        .collect()
}

/// Every base step as its `gpu.step@1` entry value: signature, weight, fetches, exactness, its
/// evaluation, its exactness fixture and its planted twin.
pub fn base_entries() -> Vec<(&'static str, Value)> {
    let fixtures = fixtures();
    TABLE
        .iter()
        .map(|d| {
            (
                d.name,
                serde_json::json!({
                    "signature": {"ports": d.ports, "kinds": kinds_of(d.kinds)},
                    "weight": d.weight, "fetches": d.fetches, "exact": d.exact,
                    "impl": {"base": d.name},
                    "fixture": fixtures.get(d.name).cloned().unwrap_or(Value::Null),
                    "twin": {"perturb": twin_of(d.name)},
                }),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorted_for_lookup() {
        let names: Vec<&str> = TABLE.iter().map(|d| d.name).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
    }

    #[test]
    fn every_base_step_holds_its_fixture_and_refuses_its_twin() {
        let all = base_entries();
        assert_eq!(all.len(), TABLE.len());
        for (name, value) in &all {
            assert_eq!(exactness(value, ""), Ok(()), "{name}");
            let twin = value["twin"]["perturb"].as_str().unwrap_or_default();
            assert!(exactness(value, twin).is_err(), "{name}'s twin passes");
        }
    }

    #[test]
    fn the_i32_add_wraps_as_the_cts_says_and_its_saturating_twin_fails() {
        let (_, add) = base_entries()
            .into_iter()
            .find(|(n, _)| *n == "add@1")
            .expect("add@1");
        let got = eval(
            &add,
            &[V::I(2_147_483_647), V::I(1)],
            &Value::Null,
            None,
            "",
        )
        .expect("runs");
        assert_eq!(got, V::I(-2_147_483_648));
        let twin = eval(
            &add,
            &[V::I(2_147_483_647), V::I(1)],
            &Value::Null,
            None,
            "saturate",
        )
        .expect("runs");
        assert_eq!(twin, V::I(2_147_483_647));
        assert!(exactness(&add, "saturate")
            .unwrap_err()
            .contains("2147483647"));
    }
}
