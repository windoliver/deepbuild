//! Expressions over the closed function list (canvas primitives: The closed function list), the
//! one language drivers, fields, path functions and pack kind rules share: parsed and checked
//! once, then evaluated at a point in pinned f64 math, or bounded over ranges of its variables
//! through each function's interval form ([`crate::interval`]), so a check bounds an expression
//! over a range instead of trusting samples.
//!
//! Values are numbers or vectors of 2 to 4; a complex number is a vec2 read as x + yi. Names a
//! caller binds (a driver's vars, a path function's x) are listed in [`Expr::vars`] in order of
//! first use and passed by index. Tables and eases resolve at compile time, through [`Resolve`].

use std::sync::Arc;

use crate::ease::{self, Named};
use crate::interval::{self as iv, Iv};
use crate::ops;
use crate::table::{EaseTable, Table};

/// The most terms a bounded sum or product takes.
pub const MAX_TERMS: f64 = 256.0;

/// A value: a number, or a vector of 2 to 4 components.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum V {
    S(f64),
    V(u8, [f64; 4]),
}

/// A range of values: a number's range, or a box of components.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum B {
    S(Iv),
    V(u8, [Iv; 4]),
}

impl V {
    pub fn num(&self) -> f64 {
        match *self {
            V::S(x) => x,
            V::V(..) => f64::NAN,
        }
    }

    fn comps(&self) -> (u8, [f64; 4]) {
        match *self {
            V::S(x) => (1, [x, 0.0, 0.0, 0.0]),
            V::V(n, c) => (n, c),
        }
    }

    pub fn is_finite(&self) -> bool {
        let (n, c) = self.comps();
        c[..n as usize].iter().all(|v| v.is_finite())
    }
}

impl B {
    pub fn num(&self) -> Iv {
        match *self {
            B::S(x) => x,
            B::V(..) => Iv::ENTIRE,
        }
    }

    fn comps(&self) -> (u8, [Iv; 4]) {
        match *self {
            B::S(x) => (1, [x, Iv::EMPTY, Iv::EMPTY, Iv::EMPTY]),
            B::V(n, c) => (n, c),
        }
    }

    /// Every component bounded.
    pub fn is_bounded(&self) -> bool {
        let (n, c) = self.comps();
        c[..n as usize]
            .iter()
            .all(|v| v.is_bounded() || v.is_empty())
    }
}

/// What an expression's check refuses: the call or text that breaks it, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub call: String,
    pub why: String,
    /// The canvas module the build lacks that the call needs, when that is why.
    pub missing: Option<String>,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "`{}`: {}", self.call, self.why)
    }
}

/// What a compile looks up: function tables and ease tables by name, a var's declared max (a
/// sum's bound), and the item's seed (`rand`).
pub trait Resolve {
    fn table(&self, _name: &str) -> Option<Table> {
        None
    }
    fn ease_table(&self, _name: &str) -> Option<EaseTable> {
        None
    }
    fn var_max(&self, _name: &str) -> Option<f64> {
        None
    }
    fn seed(&self) -> u64 {
        0
    }
    /// A planted wrong form, for the checks that must fail on one.
    fn planted(&self) -> Option<Planted> {
        None
    }
    /// Whether this build holds `ease@1`; else the module it lacks, which `ease(name, x)` names.
    fn eases(&self) -> Result<(), String> {
        Ok(())
    }
}

/// The planted wrong forms a check must fail on (never in a shipped document's evaluation).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// sin's interval form bounds a range by its values at its ends alone.
    SinBoundsByEnds,
    /// A table sampler that extends its end segments past the ends.
    TableExtrapolates,
    /// A table's interval form from 8 samples between its range's ends.
    TableFormSamples8,
    /// sinc's interval form computed as sin(x) ÷ x.
    SincAsSinOverX,
    /// noise's and fbm's interval forms from 8 samples of the range, their least and greatest.
    NoiseFormSamples8,
    /// #493: every function's interval form from its point values at the range's ends, each
    /// rounded to nearest rather than outward.
    RoundsToNearest,
    /// #1646: cells takes its seed with the time, the var `t`, so a still point's outputs move.
    CellsSeededFromT,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        Some(match name {
            "sin_bounds_by_ends" => Planted::SinBoundsByEnds,
            "table_extrapolates" => Planted::TableExtrapolates,
            "table_form_samples_8" => Planted::TableFormSamples8,
            "sinc_as_sin_over_x" => Planted::SincAsSinOverX,
            "noise_form_samples_8" => Planted::NoiseFormSamples8,
            "rounds_to_nearest" => Planted::RoundsToNearest,
            "cells_seeded_from_t" => Planted::CellsSeededFromT,
            _ => return None,
        })
    }
}

/// Tables and ease tables by `<pack>.<name>`, and vars' declared maxes: what a document's packs
/// and controls give its expressions.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Scope {
    pub tables: std::collections::BTreeMap<String, Table>,
    pub eases: std::collections::BTreeMap<String, EaseTable>,
    pub maxes: std::collections::BTreeMap<String, f64>,
    pub planted: Option<Planted>,
}

/// A pack's table or ease table refused at check, with its name.
#[derive(Clone, Debug, PartialEq)]
pub struct PackRefusal {
    pub name: String,
    pub refusal: crate::table::Refusal,
}

impl Scope {
    /// The tables and ease@1 entries of `packs`, each `{name, tables?: {name: table}, entries?:
    /// {"ease@1": [{name, x, y, mode, overshoot}]}}` as a pinned pack's `pack.json` holds them,
    /// each checked once; the first broken one is refused, naming it.
    pub fn of_packs(packs: &[serde_json::Value]) -> Result<Scope, Box<PackRefusal>> {
        let mut out = Scope::default();
        for p in packs {
            let pack = p
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if let Some(tables) = p.get("tables").and_then(serde_json::Value::as_object) {
                for (name, t) in tables {
                    let full = format!("{pack}.{name}");
                    let table = Table::parse(t).map_err(|refusal| {
                        Box::new(PackRefusal {
                            name: full.clone(),
                            refusal,
                        })
                    })?;
                    out.tables.insert(full, table);
                }
            }
            for e in p
                .pointer("/entries/ease@1")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                let name = e
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("");
                let full = if name.contains('.') {
                    name.to_string()
                } else {
                    format!("{pack}.{name}")
                };
                let table = EaseTable::parse(e).map_err(|refusal| {
                    Box::new(PackRefusal {
                        name: full.clone(),
                        refusal,
                    })
                })?;
                out.eases.insert(full, table);
            }
        }
        Ok(out)
    }
}

impl Resolve for Scope {
    fn table(&self, name: &str) -> Option<Table> {
        self.tables.get(name).cloned()
    }
    fn ease_table(&self, name: &str) -> Option<EaseTable> {
        self.eases.get(name).cloned()
    }
    fn var_max(&self, name: &str) -> Option<f64> {
        self.maxes.get(name).copied()
    }
    fn planted(&self) -> Option<Planted> {
        self.planted
    }
}

/// `x` clamped to [0, 1], as an ease reads its progress.
pub fn clamp01(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    Iv::new(x.lo.clamp(0.0, 1.0), x.hi.clamp(0.0, 1.0))
}

/// A compile that resolves nothing: no tables, no var maxes, seed 0.
pub struct Nothing;
impl Resolve for Nothing {}

/// An ease an expression reads: a named one, or a pack's table.
#[derive(Clone, Debug, PartialEq)]
pub enum Ease {
    Named(Named),
    Table(Arc<EaseTable>),
}

impl Ease {
    pub fn at(&self, x: f64) -> f64 {
        match self {
            Ease::Named(e) => e.at(x),
            Ease::Table(t) => t.at(x),
        }
    }

    pub fn bound(&self, x: Iv) -> Iv {
        match self {
            Ease::Named(e) => e.bound(x),
            Ease::Table(t) => t.table.bound(clamp01(x)),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Node {
    Num(f64),
    Var(usize),
    /// A sum's or product's index, by depth.
    Index(usize),
    Neg(Box<Node>),
    Not(Box<Node>),
    Bin(Op, Box<Node>, Box<Node>),
    If(Box<Node>, Box<Node>, Box<Node>),
    Call(Fun, Vec<Node>),
    Swizzle(Box<Node>, Vec<u8>),
    Table(Arc<Table>, Box<Node>),
    Ease(Ease, Box<Node>),
    /// `sum` (or `prod`, with `product`): over the index from `a` to `b`, each a literal or a
    /// var; `max` the most terms it takes.
    Sum {
        product: bool,
        depth: usize,
        a: Box<Node>,
        b: Box<Node>,
        term: Box<Node>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Rem,
    Pow,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    And,
    Or,
}

/// The closed function list, by name, with its argument counts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fun {
    Min,
    Max,
    Clamp,
    Abs,
    Sign,
    Floor,
    Ceil,
    Fract,
    Round,
    Mod,
    Sqrt,
    Pow,
    Exp,
    Log,
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    Atan2,
    Deg,
    Rad,
    Sinh,
    Cosh,
    Tanh,
    Asinh,
    Acosh,
    Atanh,
    Log2,
    Log10,
    Log1p,
    Expm1,
    Hypot,
    Cbrt,
    Sinc,
    Erf,
    Erfc,
    Gamma,
    Lgamma,
    Factorial,
    Binom,
    Mix,
    Smoothstep,
    Remap,
    Vec(u8),
    Length,
    Distance,
    Dot,
    Cross,
    Normalize,
    Angle,
    Cmul,
    Cdiv,
    Cexp,
    Clog,
    Cpow,
    Csqrt,
    Csin,
    Ccos,
    Conj,
    Cabs,
    Carg,
    Hash,
    Noise,
    Noise3,
    Fbm,
    Cells,
    /// #1646: one of `cells(p, seed)`'s outputs, read by name: 0 f1, 1 f2, 2 id, 3 center.
    CellsOut(u8),
    Rand,
}

const FUNS: &[(&str, Fun, usize, usize)] = &[
    ("min", Fun::Min, 2, 2),
    ("max", Fun::Max, 2, 2),
    ("clamp", Fun::Clamp, 3, 3),
    ("abs", Fun::Abs, 1, 1),
    ("sign", Fun::Sign, 1, 1),
    ("floor", Fun::Floor, 1, 1),
    ("ceil", Fun::Ceil, 1, 1),
    ("fract", Fun::Fract, 1, 1),
    ("round", Fun::Round, 1, 1),
    ("mod", Fun::Mod, 2, 2),
    ("sqrt", Fun::Sqrt, 1, 1),
    ("pow", Fun::Pow, 2, 2),
    ("exp", Fun::Exp, 1, 1),
    ("log", Fun::Log, 1, 1),
    ("sin", Fun::Sin, 1, 1),
    ("cos", Fun::Cos, 1, 1),
    ("tan", Fun::Tan, 1, 1),
    ("asin", Fun::Asin, 1, 1),
    ("acos", Fun::Acos, 1, 1),
    ("atan", Fun::Atan, 1, 1),
    ("atan2", Fun::Atan2, 2, 2),
    ("deg", Fun::Deg, 1, 1),
    ("rad", Fun::Rad, 1, 1),
    ("sinh", Fun::Sinh, 1, 1),
    ("cosh", Fun::Cosh, 1, 1),
    ("tanh", Fun::Tanh, 1, 1),
    ("asinh", Fun::Asinh, 1, 1),
    ("acosh", Fun::Acosh, 1, 1),
    ("atanh", Fun::Atanh, 1, 1),
    ("log2", Fun::Log2, 1, 1),
    ("log10", Fun::Log10, 1, 1),
    ("log1p", Fun::Log1p, 1, 1),
    ("expm1", Fun::Expm1, 1, 1),
    ("hypot", Fun::Hypot, 2, 2),
    ("cbrt", Fun::Cbrt, 1, 1),
    ("sinc", Fun::Sinc, 1, 1),
    ("erf", Fun::Erf, 1, 1),
    ("erfc", Fun::Erfc, 1, 1),
    ("gamma", Fun::Gamma, 1, 1),
    ("lgamma", Fun::Lgamma, 1, 1),
    ("factorial", Fun::Factorial, 1, 1),
    ("binom", Fun::Binom, 2, 2),
    ("mix", Fun::Mix, 3, 3),
    ("smoothstep", Fun::Smoothstep, 3, 3),
    ("remap", Fun::Remap, 5, 5),
    ("vec2", Fun::Vec(2), 1, 2),
    ("vec3", Fun::Vec(3), 1, 3),
    ("vec4", Fun::Vec(4), 1, 4),
    ("length", Fun::Length, 1, 1),
    ("distance", Fun::Distance, 2, 2),
    ("dot", Fun::Dot, 2, 2),
    ("cross", Fun::Cross, 2, 2),
    ("normalize", Fun::Normalize, 1, 1),
    ("angle", Fun::Angle, 2, 2),
    ("cmul", Fun::Cmul, 2, 2),
    ("cdiv", Fun::Cdiv, 2, 2),
    ("cexp", Fun::Cexp, 1, 1),
    ("clog", Fun::Clog, 1, 1),
    ("cpow", Fun::Cpow, 2, 2),
    ("csqrt", Fun::Csqrt, 1, 1),
    ("csin", Fun::Csin, 1, 1),
    ("ccos", Fun::Ccos, 1, 1),
    ("conj", Fun::Conj, 1, 1),
    ("cabs", Fun::Cabs, 1, 1),
    ("carg", Fun::Carg, 1, 1),
    ("hash", Fun::Hash, 1, 4),
    ("noise", Fun::Noise, 1, 2),
    ("noise3", Fun::Noise3, 1, 2),
    ("fbm", Fun::Fbm, 1, 5),
    ("cells", Fun::Cells, 1, 2),
    ("rand", Fun::Rand, 1, 3),
];

/// Every name of the closed function list an expression may call, the forms `table`, `ease`,
/// `sum` and `prod` with them.
pub fn functions() -> Vec<&'static str> {
    let mut out: Vec<&str> = FUNS.iter().map(|(n, ..)| *n).collect();
    out.extend(["table", "ease", "sum", "prod"]);
    out.sort_unstable();
    out
}

/// A parsed, checked expression.
#[derive(Clone, Debug, PartialEq)]
pub struct Expr {
    root: Node,
    /// The free names it reads, in order of first use; each evaluation passes their values.
    pub vars: Vec<String>,
    /// Its nodes once every sum expands: each sum counts its term's nodes times its count.
    pub size: usize,
    pub text: String,
    planted: Option<Planted>,
}

// ---- tokens

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Name(String),
    Sym(&'static str),
}

/// The tokens of a text, read one at a time as the parser asks, so a refusal partway reads no
/// further: nothing grows with the text past where it stops.
struct Lexer<'a> {
    text: &'a str,
    /// The byte at which the next token starts its search, and the chars before it.
    at: usize,
    chars: usize,
}

impl Lexer<'_> {
    fn ahead(&self, k: usize) -> Option<char> {
        self.text[self.at..].chars().nth(k)
    }

    fn bump(&mut self) {
        if let Some(c) = self.ahead(0) {
            self.at += c.len_utf8();
            self.chars += 1;
        }
    }

    /// The next token and its offset in chars, or `None` at the end.
    fn next(&mut self) -> Result<Option<(Tok, usize)>, Refusal> {
        while self.ahead(0).is_some_and(char::is_whitespace) {
            self.bump();
        }
        let Some(c) = self.ahead(0) else {
            return Ok(None);
        };
        let (from, start) = (self.at, self.chars);
        if c.is_ascii_digit() || (c == '.' && self.ahead(1).is_some_and(|d| d.is_ascii_digit())) {
            while self
                .ahead(0)
                .is_some_and(|d| d.is_ascii_digit() || d == '.')
            {
                self.bump();
            }
            if matches!(self.ahead(0), Some('e' | 'E')) {
                let mut j = 1;
                if matches!(self.ahead(j), Some('+' | '-' | '−')) {
                    j += 1;
                }
                if self.ahead(j).is_some_and(|d| d.is_ascii_digit()) {
                    for _ in 0..j {
                        self.bump();
                    }
                    while self.ahead(0).is_some_and(|d| d.is_ascii_digit()) {
                        self.bump();
                    }
                }
            }
            let s: String = self.text[from..self.at]
                .chars()
                .map(|c| if c == '−' { '-' } else { c })
                .collect();
            let n: f64 = s.parse().map_err(|_| Refusal {
                call: s.clone(),
                why: "is not a number".into(),
                missing: None,
            })?;
            return Ok(Some((Tok::Num(n), start)));
        }
        if c.is_alphabetic() || c == '_' {
            while self
                .ahead(0)
                .is_some_and(|d| d.is_alphanumeric() || d == '_')
            {
                self.bump();
            }
            return Ok(Some((Tok::Name(self.text[from..self.at].into()), start)));
        }
        let two = match (c, self.ahead(1)) {
            ('=', Some('=')) => Some("=="),
            ('!', Some('=')) => Some("!="),
            ('<', Some('=')) => Some("<="),
            ('>', Some('=')) => Some(">="),
            ('&', Some('&')) => Some("&&"),
            ('|', Some('|')) => Some("||"),
            _ => None,
        };
        if let Some(s) = two {
            self.bump();
            self.bump();
            return Ok(Some((Tok::Sym(s), start)));
        }
        let one = match c {
            '+' => "+",
            '-' | '−' => "-",
            '*' | '·' | '×' => "*",
            '/' | '÷' => "/",
            '%' => "%",
            '^' => "^",
            '<' => "<",
            '>' => ">",
            '!' => "!",
            '?' => "?",
            ':' => ":",
            '(' => "(",
            ')' => ")",
            ',' => ",",
            '.' => ".",
            '≤' => "<=",
            '≥' => ">=",
            '≠' => "!=",
            _ => {
                return Err(Refusal {
                    call: self.text.into(),
                    why: format!("unexpected `{c}`"),
                    missing: None,
                })
            }
        };
        self.bump();
        Ok(Some((Tok::Sym(one), start)))
    }
}

// ---- parse

/// A node as parsed, before names bind.
#[derive(Clone, Debug)]
enum P {
    Num(f64),
    Name(String),
    Neg(Box<P>),
    Not(Box<P>),
    Bin(Op, Box<P>, Box<P>),
    If(Box<P>, Box<P>, Box<P>),
    /// A call, with its text.
    Call(String, Vec<P>, String),
    Swizzle(Box<P>, String),
}

/// The most levels a parse nests: parentheses, unary operators, the conditional's branches, a
/// power's exponent and a call's arguments each take one. Binding, evaluating and dropping the
/// tree recurse over the same levels, so none of them can overflow the stack.
pub(crate) const MAX_NEST: usize = 64;

struct Parser<'a> {
    lexer: Lexer<'a>,
    /// The tokens read so far; the parser goes back only within a `dotted` name.
    toks: Vec<(Tok, usize)>,
    /// A token that couldn't be read: the parse ends there, and compiling refuses with it.
    bad: Option<Refusal>,
    at: usize,
    text: &'a str,
    depth: usize,
    /// The nodes made so far, and the most it may make (see `Expr::compile`).
    nodes: usize,
    max_nodes: usize,
    cap: usize,
}

impl Parser<'_> {
    fn peek(&mut self) -> Option<&Tok> {
        if self.at == self.toks.len() && self.bad.is_none() {
            match self.lexer.next() {
                Ok(Some(t)) => self.toks.push(t),
                Ok(None) => {}
                Err(r) => self.bad = Some(r),
            }
        }
        self.toks.get(self.at).map(|(t, _)| t)
    }

    fn sym(&mut self, s: &str) -> bool {
        matches!(self.peek(), Some(Tok::Sym(x)) if *x == s)
    }

    fn eat(&mut self, s: &str) -> bool {
        if self.sym(s) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn fail(&self, why: impl Into<String>) -> Refusal {
        Refusal {
            call: self.text.into(),
            why: why.into(),
            missing: None,
        }
    }

    fn offset(&mut self) -> usize {
        self.peek();
        self.toks
            .get(self.at)
            .map_or_else(|| self.text.chars().count(), |(_, o)| *o)
    }

    /// `f` one level deeper, refused past [`MAX_NEST`] before it reads anything.
    fn nest<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, Refusal>) -> Result<T, Refusal> {
        if self.depth == MAX_NEST {
            return Err(self.fail(format!("nests past the cap of {MAX_NEST} levels")));
        }
        self.depth += 1;
        let p = f(self);
        self.depth -= 1;
        p
    }

    /// A new node, counted against the most the parse may make.
    fn node(&mut self, p: P) -> Result<P, Refusal> {
        self.count()?;
        Ok(p)
    }

    fn count(&mut self) -> Result<(), Refusal> {
        self.nodes += 1;
        if self.nodes > self.max_nodes {
            return Err(self.fail(format!(
                "takes more than {} nodes as written, twice the cap of {}",
                self.max_nodes, self.cap
            )));
        }
        Ok(())
    }

    fn expr(&mut self) -> Result<P, Refusal> {
        let c = self.or()?;
        if self.eat("?") {
            let a = self.nest(Self::expr)?;
            if !self.eat(":") {
                return Err(self.fail("a `?` without its `:`"));
            }
            let b = self.nest(Self::expr)?;
            return self.node(P::If(Box::new(c), Box::new(a), Box::new(b)));
        }
        Ok(c)
    }

    fn binary(
        &mut self,
        ops: &[(&str, Op)],
        next: fn(&mut Self) -> Result<P, Refusal>,
    ) -> Result<P, Refusal> {
        let mut left = next(self)?;
        'outer: loop {
            for (s, op) in ops {
                if self.eat(s) {
                    let right = next(self)?;
                    left = self.node(P::Bin(*op, Box::new(left), Box::new(right)))?;
                    continue 'outer;
                }
            }
            return Ok(left);
        }
    }

    fn or(&mut self) -> Result<P, Refusal> {
        self.binary(&[("||", Op::Or)], Self::and)
    }

    fn and(&mut self) -> Result<P, Refusal> {
        self.binary(&[("&&", Op::And)], Self::equality)
    }

    fn equality(&mut self) -> Result<P, Refusal> {
        self.binary(&[("==", Op::Eq), ("!=", Op::Ne)], Self::compare)
    }

    fn compare(&mut self) -> Result<P, Refusal> {
        self.binary(
            &[("<=", Op::Le), (">=", Op::Ge), ("<", Op::Lt), (">", Op::Gt)],
            Self::sum,
        )
    }

    fn sum(&mut self) -> Result<P, Refusal> {
        self.binary(&[("+", Op::Add), ("-", Op::Sub)], Self::product)
    }

    fn product(&mut self) -> Result<P, Refusal> {
        let mut left = self.unary()?;
        loop {
            let op = if self.eat("*") {
                Op::Mul
            } else if self.eat("/") {
                Op::Div
            } else if self.eat("%") {
                Op::Rem
            } else if matches!(self.peek(), Some(Tok::Name(_))) || self.sym("(") {
                // A number or a closing paren next to a name or a paren multiplies: 2k, 2(x + 1).
                Op::Mul
            } else {
                return Ok(left);
            };
            let right = self.unary()?;
            left = self.node(P::Bin(op, Box::new(left), Box::new(right)))?;
        }
    }

    fn unary(&mut self) -> Result<P, Refusal> {
        if self.eat("-") {
            let a = self.nest(Self::unary)?;
            return self.node(P::Neg(Box::new(a)));
        }
        if self.eat("+") {
            return self.nest(Self::unary);
        }
        if self.eat("!") {
            let a = self.nest(Self::unary)?;
            return self.node(P::Not(Box::new(a)));
        }
        self.power()
    }

    fn power(&mut self) -> Result<P, Refusal> {
        let base = self.postfix()?;
        if self.eat("^") {
            // Right-associative, and binding tighter than a leading minus: −x^2 is −(x²).
            let exp = self.nest(Self::unary)?;
            return self.node(P::Bin(Op::Pow, Box::new(base), Box::new(exp)));
        }
        Ok(base)
    }

    fn postfix(&mut self) -> Result<P, Refusal> {
        let mut e = self.atom()?;
        while self.sym(".") {
            self.at += 1;
            match self.peek().cloned() {
                Some(Tok::Name(s)) => {
                    self.at += 1;
                    e = self.node(P::Swizzle(Box::new(e), s))?;
                }
                _ => return Err(self.fail("a `.` names no component")),
            }
        }
        Ok(e)
    }

    fn atom(&mut self) -> Result<P, Refusal> {
        let start = self.offset();
        match self.peek().cloned() {
            Some(Tok::Num(n)) => {
                self.at += 1;
                self.node(P::Num(n))
            }
            Some(Tok::Sym("(")) => {
                self.at += 1;
                let e = self.nest(Self::expr)?;
                if !self.eat(")") {
                    return Err(self.fail("missing `)`"));
                }
                Ok(e)
            }
            Some(Tok::Name(name)) => {
                self.at += 1;
                if !self.eat("(") {
                    return self.node(P::Name(name));
                }
                let args = self.nest(|p| p.args(&name))?;
                let end = self.offset();
                let call: String = self.text.chars().skip(start).take(end - start).collect();
                self.node(P::Call(name, args, call.trim().to_string()))
            }
            Some(Tok::Sym(s)) => Err(self.fail(format!("unexpected `{s}`"))),
            None => Err(self.fail("the expression ends early")),
        }
    }

    /// A call's arguments after its `(`, through its `)`.
    fn args(&mut self, name: &str) -> Result<Vec<P>, Refusal> {
        let mut args = Vec::new();
        if self.eat(")") {
            return Ok(args);
        }
        loop {
            // `table` and `ease` name a pack's entry as `<pack>.<name>`.
            if (name == "table" || name == "ease") && args.is_empty() {
                if let Some(n) = self.dotted()? {
                    args.push(P::Name(n));
                    if self.eat(",") {
                        continue;
                    }
                    if self.eat(")") {
                        break;
                    }
                    return Err(self.fail("missing `)`"));
                }
            }
            args.push(self.expr()?);
            if self.eat(",") {
                continue;
            }
            if self.eat(")") {
                break;
            }
            return Err(self.fail("missing `)`"));
        }
        Ok(args)
    }

    /// A name with dots (`physics.drag`), if the next tokens are one followed by `,` or `)`. Each
    /// part counts as a node while it reads, and the name as one node once it is one.
    fn dotted(&mut self) -> Result<Option<String>, Refusal> {
        let (save, nodes) = (self.at, self.nodes);
        let mut out = String::new();
        while let Some(Tok::Name(n)) = self.peek().cloned() {
            self.count()?;
            out.push_str(&n);
            self.at += 1;
            if self.sym(".") {
                out.push('.');
                self.at += 1;
                continue;
            }
            break;
        }
        if !out.is_empty() && !out.ends_with('.') && (self.sym(",") || self.sym(")")) {
            self.nodes = nodes + 1;
            return Ok(Some(out));
        }
        (self.at, self.nodes) = (save, nodes);
        Ok(None)
    }
}

// ---- bind and check

struct Binder<'a> {
    resolve: &'a dyn Resolve,
    vars: Vec<String>,
    /// The sum indices in scope, innermost last.
    indices: Vec<String>,
    depth: usize,
}

fn refuse(call: &str, why: impl Into<String>) -> Refusal {
    Refusal {
        call: call.into(),
        why: why.into(),
        missing: None,
    }
}

fn swizzle(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() || s.len() > 4 {
        return None;
    }
    let sets = ["xyzw", "rgba"];
    sets.iter().find_map(|set| {
        s.chars()
            .map(|c| set.find(c).map(|i| i as u8))
            .collect::<Option<Vec<u8>>>()
    })
}

impl Binder<'_> {
    /// The node and its size (nodes once its sums expand).
    fn bind(&mut self, p: &P) -> Result<(Node, usize), Refusal> {
        Ok(match p {
            P::Num(n) => (Node::Num(*n), 1),
            P::Name(n) => {
                if let Some(d) = self.indices.iter().rposition(|i| i == n) {
                    return Ok((Node::Index(d), 1));
                }
                match n.as_str() {
                    "pi" | "π" => return Ok((Node::Num(ops::PI), 1)),
                    "tau" | "τ" => return Ok((Node::Num(ops::TAU), 1)),
                    _ => {}
                }
                let i = match self.vars.iter().position(|v| v == n) {
                    Some(i) => i,
                    None => {
                        self.vars.push(n.clone());
                        self.vars.len() - 1
                    }
                };
                (Node::Var(i), 1)
            }
            P::Neg(a) => {
                let (a, s) = self.bind(a)?;
                (Node::Neg(Box::new(a)), s + 1)
            }
            P::Not(a) => {
                let (a, s) = self.bind(a)?;
                (Node::Not(Box::new(a)), s + 1)
            }
            P::Bin(op, a, b) => {
                let (a, sa) = self.bind(a)?;
                let (b, sb) = self.bind(b)?;
                (Node::Bin(*op, Box::new(a), Box::new(b)), sa + sb + 1)
            }
            P::If(c, a, b) => {
                let (c, sc) = self.bind(c)?;
                let (a, sa) = self.bind(a)?;
                let (b, sb) = self.bind(b)?;
                (
                    Node::If(Box::new(c), Box::new(a), Box::new(b)),
                    sc + sa + sb + 1,
                )
            }
            P::Swizzle(a, s) => {
                // #1646: cells(p, seed) states its outputs, read by name.
                if let P::Call(name, args, call) = &**a {
                    let out = ["f1", "f2", "id", "center"].iter().position(|o| o == s);
                    if let (true, Some(k)) = (name == "cells", out) {
                        let (Node::Call(_, nodes), size) = self.call(name, args, call)? else {
                            unreachable!("cells binds to a call");
                        };
                        return Ok((Node::Call(Fun::CellsOut(k as u8), nodes), size));
                    }
                }
                let (a, sa) = self.bind(a)?;
                let Some(idx) = swizzle(s) else {
                    return Err(refuse(s, "is no swizzle of x, y, z, w (or r, g, b, a)"));
                };
                (Node::Swizzle(Box::new(a), idx), sa + 1)
            }
            P::Call(name, args, call) => self.call(name, args, call)?,
        })
    }

    fn call(&mut self, name: &str, args: &[P], call: &str) -> Result<(Node, usize), Refusal> {
        match name {
            "table" => {
                let [P::Name(t), x] = args else {
                    return Err(refuse(
                        call,
                        "takes a table's name and a value: table(name, x)",
                    ));
                };
                let Some(table) = self.resolve.table(t) else {
                    return Err(refuse(call, format!("names no function table `{t}`")));
                };
                let (x, s) = self.bind(x)?;
                return Ok((Node::Table(Arc::new(table), Box::new(x)), s + 1));
            }
            "ease" => {
                let [P::Name(e), x] = args else {
                    return Err(refuse(
                        call,
                        "takes an ease's name and a value: ease(name, x)",
                    ));
                };
                if let Err(module) = self.resolve.eases() {
                    return Err(Refusal {
                        missing: Some(module.clone()),
                        ..refuse(
                            call,
                            format!("ease@1 is the `{module}` module's, which this build lacks"),
                        )
                    });
                }
                let ease = match ease::parse(e, None) {
                    Ok(Some(n)) => Ease::Named(n),
                    _ => match self.resolve.ease_table(e) {
                        Some(t) => Ease::Table(Arc::new(t)),
                        None => {
                            return Err(refuse(call, format!("names no entry `{e}` of ease@1")))
                        }
                    },
                };
                let (x, s) = self.bind(x)?;
                return Ok((Node::Ease(ease, Box::new(x)), s + 1));
            }
            "sum" | "prod" => return self.sum(name == "prod", args, call),
            _ => {}
        }
        let Some((_, fun, lo, hi)) = FUNS.iter().find(|(n, ..)| *n == name) else {
            return Err(refuse(
                call,
                format!("`{name}` is not on the closed function list"),
            ));
        };
        if args.len() < *lo || args.len() > *hi {
            return Err(refuse(
                call,
                format!(
                    "`{name}` takes {lo}{} arguments, not {}",
                    if hi > lo {
                        format!(" to {hi}")
                    } else {
                        String::new()
                    },
                    args.len()
                ),
            ));
        }
        let mut nodes = Vec::new();
        let mut size = 1;
        for a in args {
            let (n, s) = self.bind(a)?;
            size += s;
            nodes.push(n);
        }
        if *fun == Fun::Cells && self.resolve.planted() == Some(Planted::CellsSeededFromT) {
            let (t, _) = self.bind(&P::Name("t".into()))?;
            nodes.push(t);
        }
        if *fun == Fun::Factorial {
            if let Some(n) = constant(&nodes[0]) {
                if n != n.trunc() {
                    return Err(refuse(
                        call,
                        format!("factorial takes a whole number, not {n}"),
                    ));
                }
                if !(0.0..=iv::FACTORIAL_MAX).contains(&n) {
                    return Err(refuse(call, format!("factorial takes 0 to 170, not {n}")));
                }
            }
        }
        Ok((Node::Call(*fun, nodes), size))
    }

    /// A sum's bound: a literal, or a var with a declared max; its least and greatest values.
    fn sum_bound(&mut self, p: &P, call: &str) -> Result<(Node, f64, f64), Refusal> {
        match p {
            P::Num(n) => Ok((Node::Num(*n), *n, *n)),
            P::Neg(a) if matches!(**a, P::Num(_)) => {
                let P::Num(n) = **a else { unreachable!() };
                Ok((Node::Num(-n), -n, -n))
            }
            P::Name(v) if !self.indices.contains(v) => {
                let Some(max) = self.resolve.var_max(v) else {
                    return Err(refuse(call, format!("its bound `{v}` has no declared max")));
                };
                let (n, _) = self.bind(p)?;
                Ok((n, f64::NEG_INFINITY, max))
            }
            _ => Err(refuse(
                call,
                "a sum's bound is a literal or a var with a declared max",
            )),
        }
    }

    fn sum(&mut self, product: bool, args: &[P], call: &str) -> Result<(Node, usize), Refusal> {
        let [P::Name(k), a, b, term] = args else {
            return Err(refuse(
                call,
                "takes an index, two bounds and a term: sum(k, a, b, term)",
            ));
        };
        let (a, a_lo, _) = self.sum_bound(a, call)?;
        let (b, _, b_hi) = self.sum_bound(b, call)?;
        let (a_lo, b_hi) = (a_lo.ceil(), b_hi.floor());
        if !a_lo.is_finite() {
            return Err(refuse(call, "its lower bound has no declared least value"));
        }
        let count = (b_hi - a_lo + 1.0).max(0.0);
        if count > MAX_TERMS {
            return Err(refuse(
                call,
                format!("takes {count} terms, past the cap of {MAX_TERMS}"),
            ));
        }
        self.indices.push(k.clone());
        let depth = self.indices.len() - 1;
        self.depth = self.depth.max(self.indices.len());
        let bound = self.bind(term);
        self.indices.pop();
        let (term, s) = bound?;
        Ok((
            Node::Sum {
                product,
                depth,
                a: Box::new(a),
                b: Box::new(b),
                term: Box::new(term),
            },
            s * count as usize + 3,
        ))
    }
}

/// A node's value when it reads nothing.
fn constant(n: &Node) -> Option<f64> {
    match n {
        Node::Num(x) => Some(*x),
        Node::Neg(a) => constant(a).map(|v| -v),
        Node::Bin(op, a, b) => {
            let (a, b) = (constant(a)?, constant(b)?);
            Some(match op {
                Op::Add => a + b,
                Op::Sub => a - b,
                Op::Mul => a * b,
                Op::Div => a / b,
                _ => return None,
            })
        }
        _ => None,
    }
}

/// The most nested sums an expression takes.
const MAX_DEPTH: usize = 8;

impl Expr {
    /// `text` parsed and checked, with `cap` the most nodes it may take once its sums expand
    /// (64 ops for a driver, 256 nodes for a field, 512 for a path function).
    pub fn compile(text: &str, resolve: &dyn Resolve, cap: usize) -> Result<Expr, Refusal> {
        // Every node bound counts against `cap` once its sums expand, and a parsed tree has at
        // most twice its bound nodes (a `table` name or a sum's index is a node only as written),
        // unless an empty sum drops a term; so past twice the cap nothing is bound or kept, and
        // binding, evaluating and dropping a tree recurse at most that deep.
        let mut p = Parser {
            lexer: Lexer {
                text,
                at: 0,
                chars: 0,
            },
            toks: Vec::new(),
            bad: None,
            at: 0,
            text,
            depth: 0,
            nodes: 0,
            max_nodes: cap.saturating_mul(2),
            cap,
        };
        let parsed = p.expr();
        // Past a refusal nothing more is read, so what follows it never replaces it.
        let trailing = parsed.is_ok() && p.peek().is_some();
        if let Some(bad) = p.bad {
            return Err(bad);
        }
        let parsed = parsed?;
        if trailing {
            return Err(p.fail("trailing text after the expression"));
        }
        let mut b = Binder {
            resolve,
            vars: Vec::new(),
            indices: Vec::new(),
            depth: 0,
        };
        let (root, size) = b.bind(&parsed)?;
        if b.depth > MAX_DEPTH {
            return Err(refuse(text, format!("nests sums past {MAX_DEPTH} deep")));
        }
        if size > cap {
            return Err(refuse(
                text,
                format!("takes {size} nodes once its sums expand, past the cap of {cap}"),
            ));
        }
        Ok(Expr {
            root,
            vars: b.vars,
            size,
            text: text.into(),
            planted: resolve.planted(),
        })
    }

    /// The value with `vars` (one per [`Expr::vars`]).
    pub fn eval(&self, vars: &[V]) -> V {
        let mut cx = Cx {
            vars,
            idx: [0.0; MAX_DEPTH],
            planted: self.planted,
        };
        point(&self.root, &mut cx)
    }

    /// The value as a number, with numbers for its vars.
    pub fn eval_num(&self, vars: &[f64]) -> f64 {
        // A path function calls this per sample: the usual few vars sit on the stack.
        let mut few = [V::S(0.0); 8];
        if vars.len() <= few.len() {
            for (slot, x) in few.iter_mut().zip(vars) {
                *slot = V::S(*x);
            }
            return self.eval(&few[..vars.len()]).num();
        }
        let v: Vec<V> = vars.iter().map(|x| V::S(*x)).collect();
        self.eval(&v).num()
    }

    /// The interval form: a range certain to hold every value the expression takes while each
    /// var ranges over its bound in `vars`.
    pub fn bound(&self, vars: &[B]) -> B {
        let mut cx = Cx {
            vars,
            idx: [0.0; MAX_DEPTH],
            planted: self.planted,
        };
        range(&self.root, &mut cx)
    }

    /// The interval form as a number's range, with ranges for its vars.
    pub fn bound_num(&self, vars: &[Iv]) -> Iv {
        let v: Vec<B> = vars.iter().map(|x| B::S(*x)).collect();
        self.bound(&v).num()
    }
}

// ---- point evaluation

/// One evaluation's state: its vars, the sums' indices in scope and any planted form.
struct Cx<'a, T> {
    vars: &'a [T],
    idx: [f64; MAX_DEPTH],
    planted: Option<Planted>,
}

/// A call's arguments, at most five, without allocating.
const ARGS: usize = 5;

fn truth(b: bool) -> f64 {
    f64::from(u8::from(b))
}

/// A comparison or a logical value of `a` and `b`, NaN where either is: an undefined value
/// never decides one, as its interval form never counts it.
fn decide(a: f64, b: f64, f: impl Fn(f64, f64) -> bool) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        truth(f(a, b))
    }
}

/// `f` of two numbers, NaN where either is (`f64::min` and `max` would return the other).
fn nan2(f: fn(f64, f64) -> f64) -> impl Fn(f64, f64) -> f64 {
    move |x, y| {
        if x.is_nan() || y.is_nan() {
            f64::NAN
        } else {
            f(x, y)
        }
    }
}

fn map1(v: V, f: impl Fn(f64) -> f64) -> V {
    match v {
        V::S(x) => V::S(f(x)),
        V::V(n, c) => V::V(n, [f(c[0]), f(c[1]), f(c[2]), f(c[3])]),
    }
}

fn map2(a: V, b: V, f: impl Fn(f64, f64) -> f64) -> V {
    match (a, b) {
        (V::S(x), V::S(y)) => V::S(f(x, y)),
        (V::V(n, c), V::S(y)) => V::V(n, [f(c[0], y), f(c[1], y), f(c[2], y), f(c[3], y)]),
        (V::S(x), V::V(n, c)) => V::V(n, [f(x, c[0]), f(x, c[1]), f(x, c[2]), f(x, c[3])]),
        (V::V(n, c), V::V(m, d)) if n == m => V::V(
            n,
            [f(c[0], d[0]), f(c[1], d[1]), f(c[2], d[2]), f(c[3], d[3])],
        ),
        _ => V::S(f64::NAN),
    }
}

fn c2(v: V) -> (f64, f64) {
    match v {
        V::V(2, c) => (c[0], c[1]),
        V::S(x) => (x, 0.0),
        _ => (f64::NAN, f64::NAN),
    }
}

fn v2(x: f64, y: f64) -> V {
    V::V(2, [x, y, 0.0, 0.0])
}

fn cmul((a, b): (f64, f64), (c, d): (f64, f64)) -> (f64, f64) {
    (a * c - b * d, a * d + b * c)
}

fn cdiv((a, b): (f64, f64), (c, d): (f64, f64)) -> (f64, f64) {
    let q = c * c + d * d;
    ((a * c + b * d) / q, (b * c - a * d) / q)
}

fn cexp((a, b): (f64, f64)) -> (f64, f64) {
    let e = ops::exp(a);
    (e * ops::cos(b), e * ops::sin(b))
}

fn clog((a, b): (f64, f64)) -> (f64, f64) {
    (ops::log(ops::hypot(a, b)), atan2(b, a))
}

/// atan2 with zero one value on either axis: −0 reads as 0, so the angle on the negative x axis
/// is π and at the origin 0, as its interval form and IEEE 1788 take it.
fn atan2(y: f64, x: f64) -> f64 {
    ops::atan2(y + 0.0, x + 0.0)
}

/// z to a whole power by squaring, or through exp(w · log z).
fn cpow(z: (f64, f64), w: V) -> (f64, f64) {
    if let V::S(n) = w {
        if n == n.trunc() && n.abs() <= 1024.0 {
            let mut k = n.abs() as u32;
            let mut base = z;
            let mut acc = (1.0, 0.0);
            let mut first = true;
            while k > 0 {
                if k & 1 == 1 {
                    acc = if first { base } else { cmul(acc, base) };
                    first = false;
                }
                k >>= 1;
                if k > 0 {
                    base = cmul(base, base);
                }
            }
            return if n < 0.0 { cdiv((1.0, 0.0), acc) } else { acc };
        }
    }
    if z == (0.0, 0.0) {
        return (0.0, 0.0);
    }
    cexp(cmul(c2(w), clog(z)))
}

fn csqrt((a, b): (f64, f64)) -> (f64, f64) {
    let r = ops::hypot(a, b);
    let re = ops::sqrt(0.5 * (r + a));
    let im = ops::sqrt(0.5 * (r - a));
    (re, if b < 0.0 { -im } else { im })
}

/// A value's components, on the stack: a slice of at most four numbers.
struct Comps(u8, [f64; 4]);

impl std::ops::Deref for Comps {
    type Target = [f64];
    fn deref(&self) -> &[f64] {
        &self.1[..self.0 as usize]
    }
}

fn comps(v: V) -> Comps {
    let (n, c) = v.comps();
    Comps(n, c)
}

fn vec_of(c: &[f64]) -> V {
    match c.len() {
        1 => V::S(c[0]),
        2..=4 => {
            let mut a = [0.0; 4];
            a[..c.len()].copy_from_slice(c);
            V::V(c.len() as u8, a)
        }
        _ => V::S(f64::NAN),
    }
}

fn point(n: &Node, cx: &mut Cx<'_, V>) -> V {
    match n {
        Node::Num(x) => V::S(*x),
        Node::Var(i) => cx.vars.get(*i).copied().unwrap_or(V::S(f64::NAN)),
        Node::Index(d) => V::S(cx.idx[*d]),
        Node::Neg(a) => map1(point(a, cx), |x| -x),
        Node::Not(a) => {
            let v = point(a, cx).num();
            V::S(decide(v, 0.0, |v, _| v == 0.0))
        }
        Node::Bin(op, a, b) => {
            let (a, b) = (point(a, cx), point(b, cx));
            match op {
                Op::Add => map2(a, b, |x, y| x + y),
                Op::Sub => map2(a, b, |x, y| x - y),
                Op::Mul => map2(a, b, |x, y| x * y),
                Op::Div => map2(a, b, |x, y| x / y),
                Op::Rem => map2(a, b, |x, y| x % y),
                Op::Pow => map2(a, b, |x, y| {
                    if y == y.trunc() && y.abs() <= 1024.0 {
                        ops::powi(x, y as i32)
                    } else {
                        ops::pow(x, y)
                    }
                }),
                Op::Eq => V::S(decide(a.num(), b.num(), |x, y| x == y)),
                Op::Ne => V::S(decide(a.num(), b.num(), |x, y| x != y)),
                Op::Lt => V::S(decide(a.num(), b.num(), |x, y| x < y)),
                Op::Le => V::S(decide(a.num(), b.num(), |x, y| x <= y)),
                Op::Gt => V::S(decide(a.num(), b.num(), |x, y| x > y)),
                Op::Ge => V::S(decide(a.num(), b.num(), |x, y| x >= y)),
                Op::And => V::S(decide(a.num(), b.num(), |x, y| x != 0.0 && y != 0.0)),
                Op::Or => V::S(decide(a.num(), b.num(), |x, y| x != 0.0 || y != 0.0)),
            }
        }
        Node::If(c, a, b) => {
            let c = point(c, cx).num();
            if c.is_nan() {
                V::S(f64::NAN)
            } else if c != 0.0 {
                point(a, cx)
            } else {
                point(b, cx)
            }
        }
        Node::Swizzle(a, s) => {
            let (n, c) = point(a, cx).comps();
            if s.iter().any(|i| *i >= n) {
                return V::S(f64::NAN);
            }
            let mut out = [0.0; 4];
            let n = s.len().min(out.len());
            for (slot, i) in out.iter_mut().zip(s.iter()) {
                *slot = c[*i as usize];
            }
            if n < s.len() {
                return V::S(f64::NAN);
            }
            vec_of(&out[..n])
        }
        Node::Table(t, x) => {
            let v = point(x, cx);
            if cx.planted == Some(Planted::TableExtrapolates) {
                return map1(v, |v| extrapolated(t, v));
            }
            map1(v, |v| t.at(v))
        }
        Node::Ease(e, x) => map1(point(x, cx), |v| e.at(v)),
        Node::Sum {
            product,
            depth,
            a,
            b,
            term,
        } => {
            let (lo, hi) = (point(a, cx).num().ceil(), point(b, cx).num().floor());
            let mut acc = if *product { V::S(1.0) } else { V::S(0.0) };
            let mut k = lo;
            let mut n = 0.0;
            while k <= hi && n < MAX_TERMS {
                cx.idx[*depth] = k;
                let t = point(term, cx);
                acc = if *product {
                    map2(acc, t, |x, y| x * y)
                } else {
                    map2(acc, t, |x, y| x + y)
                };
                k += 1.0;
                n += 1.0;
            }
            acc
        }
        Node::Call(f, args) => {
            let mut a = [V::S(0.0); ARGS];
            for (slot, n) in a.iter_mut().zip(args) {
                *slot = point(n, cx);
            }
            call(*f, &a[..args.len()])
        }
    }
}

/// The planted sampler: a table read with its end segments extended past its ends.
fn extrapolated(t: &Table, v: f64) -> f64 {
    let n = t.x.len();
    let seg = |i: usize| {
        let (x0, x1, y0, y1) = (t.x[i], t.x[i + 1], t.y[i], t.y[i + 1]);
        y0 + (y1 - y0) * (v - x0) / (x1 - x0)
    };
    if v < t.x[0] {
        seg(0)
    } else if v > t.x[n - 1] {
        seg(n - 2)
    } else {
        t.at(v)
    }
}

fn call(f: Fun, a: &[V]) -> V {
    let s = |i: usize| a.get(i).map_or(f64::NAN, V::num);
    let m = |g: fn(f64) -> f64| map1(a[0], g);
    match f {
        Fun::Min => map2(a[0], a[1], nan2(f64::min)),
        Fun::Max => map2(a[0], a[1], nan2(f64::max)),
        Fun::Clamp => map2(map2(a[0], a[1], nan2(f64::max)), a[2], nan2(f64::min)),
        Fun::Abs => m(f64::abs),
        Fun::Sign => m(|x| {
            if x.is_nan() {
                f64::NAN
            } else if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }
        }),
        Fun::Floor => m(f64::floor),
        Fun::Ceil => m(f64::ceil),
        Fun::Fract => m(|x| x - x.floor()),
        Fun::Round => m(f64::round),
        Fun::Mod => map2(a[0], a[1], |x, y| x - y * (x / y).floor()),
        Fun::Sqrt => m(ops::sqrt),
        Fun::Pow => map2(a[0], a[1], ops::pow),
        Fun::Exp => m(ops::exp),
        Fun::Log => m(ops::log),
        Fun::Sin => m(ops::sin),
        Fun::Cos => m(ops::cos),
        Fun::Tan => m(ops::tan),
        Fun::Asin => m(ops::asin),
        Fun::Acos => m(ops::acos),
        Fun::Atan => m(ops::atan),
        Fun::Atan2 => map2(a[0], a[1], atan2),
        Fun::Deg => m(ops::deg),
        Fun::Rad => m(ops::rad),
        Fun::Sinh => m(ops::sinh),
        Fun::Cosh => m(ops::cosh),
        Fun::Tanh => m(ops::tanh),
        Fun::Asinh => m(ops::asinh),
        Fun::Acosh => m(ops::acosh),
        Fun::Atanh => m(ops::atanh),
        Fun::Log2 => m(ops::log2),
        Fun::Log10 => m(ops::log10),
        Fun::Log1p => m(ops::log1p),
        Fun::Expm1 => m(ops::expm1),
        Fun::Hypot => map2(a[0], a[1], ops::hypot),
        Fun::Cbrt => m(ops::cbrt),
        Fun::Sinc => m(ops::sinc),
        Fun::Erf => m(ops::erf),
        Fun::Erfc => m(ops::erfc),
        Fun::Gamma => m(ops::tgamma),
        Fun::Lgamma => m(ops::lgamma),
        Fun::Factorial => m(|n| iv::factorial(n).unwrap_or(f64::NAN)),
        Fun::Binom => map2(a[0], a[1], |n, k| iv::binom(n, k).unwrap_or(f64::NAN)),
        Fun::Mix => {
            let t = a[2];
            map2(
                a[0],
                map2(map2(a[1], a[0], |x, y| x - y), t, |d, t| d * t),
                |x, y| x + y,
            )
        }
        Fun::Smoothstep => {
            let (e0, e1, x) = (s(0), s(1), s(2));
            let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
            V::S(t * t * (3.0 - 2.0 * t))
        }
        Fun::Remap => {
            let (x, a0, b0, c0, d0) = (s(0), s(1), s(2), s(3), s(4));
            V::S(c0 + (x - a0) / (b0 - a0) * (d0 - c0))
        }
        Fun::Vec(n) => {
            let c: Vec<f64> = a.iter().flat_map(|v| comps(*v).to_vec()).collect();
            if c.len() == 1 {
                return vec_of(&vec![c[0]; n as usize]);
            }
            if c.len() != n as usize {
                return V::S(f64::NAN);
            }
            vec_of(&c)
        }
        Fun::Length => V::S(ops::sqrt(comps(a[0]).iter().map(|x| x * x).sum())),
        Fun::Distance => {
            let d = map2(a[0], a[1], |x, y| x - y);
            V::S(ops::sqrt(comps(d).iter().map(|x| x * x).sum()))
        }
        Fun::Dot => V::S(dot(&comps(a[0]), &comps(a[1]))),
        Fun::Cross => {
            let (u, v) = (comps(a[0]), comps(a[1]));
            if u.len() != 3 || v.len() != 3 {
                return V::S(f64::NAN);
            }
            vec_of(&[
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ])
        }
        Fun::Normalize => {
            let c = comps(a[0]);
            let l = ops::sqrt(c.iter().map(|x| x * x).sum());
            vec_of(&c.iter().map(|x| x / l).collect::<Vec<_>>())
        }
        Fun::Angle => {
            let (u, v) = (comps(a[0]), comps(a[1]));
            let l = ops::sqrt(dot(&u, &u)) * ops::sqrt(dot(&v, &v));
            V::S(ops::acos((dot(&u, &v) / l).clamp(-1.0, 1.0)))
        }
        Fun::Cmul => {
            let (x, y) = cmul(c2(a[0]), c2(a[1]));
            v2(x, y)
        }
        Fun::Cdiv => {
            let (x, y) = cdiv(c2(a[0]), c2(a[1]));
            v2(x, y)
        }
        Fun::Cexp => {
            let (x, y) = cexp(c2(a[0]));
            v2(x, y)
        }
        Fun::Clog => {
            let (x, y) = clog(c2(a[0]));
            v2(x, y)
        }
        Fun::Cpow => {
            let (x, y) = cpow(c2(a[0]), a[1]);
            v2(x, y)
        }
        Fun::Csqrt => {
            let (x, y) = csqrt(c2(a[0]));
            v2(x, y)
        }
        Fun::Csin => {
            let (x, y) = c2(a[0]);
            v2(ops::sin(x) * ops::cosh(y), ops::cos(x) * ops::sinh(y))
        }
        Fun::Ccos => {
            let (x, y) = c2(a[0]);
            v2(ops::cos(x) * ops::cosh(y), -(ops::sin(x) * ops::sinh(y)))
        }
        Fun::Conj => {
            let (x, y) = c2(a[0]);
            v2(x, -y)
        }
        Fun::Cabs => {
            let (x, y) = c2(a[0]);
            V::S(ops::hypot(x, y))
        }
        Fun::Carg => {
            let (x, y) = c2(a[0]);
            V::S(atan2(y, x))
        }
        Fun::Hash => {
            let c: Vec<f64> = a.iter().flat_map(|v| comps(*v).to_vec()).collect();
            V::S(noise::hash01(&c))
        }
        Fun::Rand => {
            let key = s(0);
            let u = noise::hash01(&[key]);
            if a.len() == 3 {
                V::S(s(1) + (s(2) - s(1)) * u)
            } else {
                V::S(u)
            }
        }
        Fun::Noise => V::S(noise::noise(&comps(a[0]), seed_of(a.get(1)))),
        Fun::Noise3 => {
            let p = comps(a[0]);
            let s = seed_of(a.get(1));
            vec_of(&[
                noise::noise(&p, s),
                noise::noise(&p, s.wrapping_add(1)),
                noise::noise(&p, s.wrapping_add(2)),
            ])
        }
        Fun::Fbm => {
            let (oct, lac, gain) = fbm_params(a);
            V::S(noise::fbm(&comps(a[0]), seed_of(a.get(1)), oct, lac, gain))
        }
        Fun::Cells => V::S(noise::cells(&comps(a[0]), cells_seed(a)).f1),
        Fun::CellsOut(k) => {
            let c = noise::cells(&comps(a[0]), cells_seed(a));
            match k {
                0 => V::S(c.f1),
                1 => V::S(c.f2),
                2 => V::S(f64::from(c.id)),
                _ => vec_of(&c.center[..c.dims]),
            }
        }
    }
}

fn dot(u: &[f64], v: &[f64]) -> f64 {
    if u.len() != v.len() {
        return f64::NAN;
    }
    u.iter().zip(v).map(|(a, b)| a * b).sum()
}

fn seed_of(v: Option<&V>) -> u32 {
    v.map_or(0, |v| v.num() as i64 as u32)
}

/// cells' seed: its second argument, with the planted form's time (a third) mixed in.
fn cells_seed(a: &[V]) -> u32 {
    let t = a.get(2).map_or(0, |t| (t.num() * 1000.0) as i64 as u32);
    seed_of(a.get(1)).wrapping_add(t)
}

/// fbm(p, seed, octaves = 6, gain = 0.5, lacunarity = 2).
fn fbm_params(a: &[V]) -> (u32, f64, f64) {
    let oct = a.get(2).map_or(6.0, V::num).clamp(1.0, 8.0) as u32;
    let gain = a.get(3).map_or(0.5, V::num);
    let lac = a.get(4).map_or(2.0, V::num);
    (oct, lac, gain)
}

// ---- interval evaluation

fn bmap1(v: B, f: impl Fn(Iv) -> Iv) -> B {
    match v {
        B::S(x) => B::S(f(x)),
        B::V(n, c) => B::V(n, [f(c[0]), f(c[1]), f(c[2]), f(c[3])]),
    }
}

fn bmap2(a: B, b: B, f: impl Fn(Iv, Iv) -> Iv) -> B {
    match (a, b) {
        (B::S(x), B::S(y)) => B::S(f(x, y)),
        (B::V(n, c), B::S(y)) => B::V(n, [f(c[0], y), f(c[1], y), f(c[2], y), f(c[3], y)]),
        (B::S(x), B::V(n, c)) => B::V(n, [f(x, c[0]), f(x, c[1]), f(x, c[2]), f(x, c[3])]),
        (B::V(n, c), B::V(m, d)) if n == m => B::V(
            n,
            [f(c[0], d[0]), f(c[1], d[1]), f(c[2], d[2]), f(c[3], d[3])],
        ),
        _ => B::S(Iv::ENTIRE),
    }
}

fn bhull(a: B, b: B) -> B {
    bmap2(a, b, Iv::hull)
}

fn bcomps(v: B) -> Vec<Iv> {
    let (n, c) = v.comps();
    c[..n as usize].to_vec()
}

fn bvec(c: &[Iv]) -> B {
    match c.len() {
        1 => B::S(c[0]),
        2..=4 => {
            let mut a = [Iv::EMPTY; 4];
            a[..c.len()].copy_from_slice(c);
            B::V(c.len() as u8, a)
        }
        _ => B::S(Iv::ENTIRE),
    }
}

type C = (Iv, Iv);

fn bc2(v: B) -> C {
    match v {
        B::V(2, c) => (c[0], c[1]),
        B::S(x) => (x, Iv::point(0.0)),
        _ => (Iv::ENTIRE, Iv::ENTIRE),
    }
}

fn bv2((x, y): C) -> B {
    bvec(&[x, y])
}

fn icmul((a, b): C, (c, d): C) -> C {
    (a.mul(c).sub(b.mul(d)), a.mul(d).add(b.mul(c)))
}

fn icdiv((a, b): C, (c, d): C) -> C {
    let q = c.sqr().add(d.sqr());
    (a.mul(c).add(b.mul(d)).div(q), b.mul(c).sub(a.mul(d)).div(q))
}

fn icexp((a, b): C) -> C {
    let e = iv::exp(a);
    (e.mul(iv::cos(b)), e.mul(iv::sin(b)))
}

fn iclog((a, b): C) -> C {
    (iv::log(iv::hypot(a, b)), iv::atan2(b, a))
}

fn icsqrt((a, b): C) -> C {
    let r = iv::hypot(a, b);
    let half = Iv::point(0.5);
    let re = iv::sqrt(half.mul(r.add(a)));
    let im = iv::sqrt(half.mul(r.sub(a)));
    let im = if b.lo >= 0.0 {
        im
    } else if b.hi < 0.0 {
        im.neg()
    } else {
        im.hull(im.neg())
    };
    (re, im)
}

fn icpow(z: C, w: B) -> C {
    if let B::S(n) = w {
        if n.lo == n.hi && n.lo == n.lo.trunc() && n.lo.abs() <= 1024.0 {
            let k = n.lo.abs() as u32;
            let mut acc = (Iv::point(1.0), Iv::point(0.0));
            let mut base = z;
            let mut first = true;
            let mut e = k;
            while e > 0 {
                if e & 1 == 1 {
                    acc = if first { base } else { icmul(acc, base) };
                    first = false;
                }
                e >>= 1;
                if e > 0 {
                    base = icmul(base, base);
                }
            }
            return if n.lo < 0.0 {
                icdiv((Iv::point(1.0), Iv::point(0.0)), acc)
            } else {
                acc
            };
        }
    }
    let r = icexp(icmul(bc2(w), iclog(z)));
    // z = 0 gives 0 for a power with a positive real part.
    if z.0.contains(0.0) && z.1.contains(0.0) {
        (r.0.hull(Iv::point(0.0)), r.1.hull(Iv::point(0.0)))
    } else {
        r
    }
}

fn idot(u: &[Iv], v: &[Iv]) -> Iv {
    if u.len() != v.len() {
        return Iv::ENTIRE;
    }
    u.iter()
        .zip(v)
        .fold(Iv::point(0.0), |acc, (a, b)| acc.add(a.mul(*b)))
}

fn ilen(u: &[Iv]) -> Iv {
    iv::sqrt(u.iter().fold(Iv::point(0.0), |acc, a| acc.add(a.sqr())))
}

fn range(n: &Node, cx: &mut Cx<'_, B>) -> B {
    match n {
        Node::Num(x) => B::S(Iv::point(*x)),
        Node::Var(i) => cx.vars.get(*i).copied().unwrap_or(B::S(Iv::ENTIRE)),
        Node::Index(d) => B::S(Iv::point(cx.idx[*d])),
        Node::Neg(a) => bmap1(range(a, cx), Iv::neg),
        Node::Not(a) => {
            let v = range(a, cx).num();
            if v.is_empty() {
                return B::S(Iv::EMPTY);
            }
            B::S(iv::truth(v == Iv::point(0.0), !v.contains(0.0)))
        }
        Node::Bin(op, a, b) => {
            let (a, b) = (range(a, cx), range(b, cx));
            let (x, y) = (a.num(), b.num());
            let logic = !matches!(
                op,
                Op::Add | Op::Sub | Op::Mul | Op::Div | Op::Rem | Op::Pow
            );
            // An empty side holds no value: a comparison of it decides nothing.
            if logic && (x.is_empty() || y.is_empty()) {
                return B::S(Iv::EMPTY);
            }
            match op {
                Op::Add => bmap2(a, b, Iv::add),
                Op::Sub => bmap2(a, b, Iv::sub),
                Op::Mul => bmap2(a, b, |p, q| {
                    if p == q && p.lo == p.hi {
                        p.sqr()
                    } else {
                        p.mul(q)
                    }
                }),
                Op::Div => bmap2(a, b, Iv::div),
                Op::Rem => bmap2(a, b, iv::rem),
                Op::Pow => bmap2(a, b, iv::pow),
                Op::Eq => B::S(iv::truth(
                    x.lo == x.hi && x == y,
                    x.hi < y.lo || y.hi < x.lo,
                )),
                Op::Ne => B::S(iv::truth(
                    x.hi < y.lo || y.hi < x.lo,
                    x.lo == x.hi && x == y,
                )),
                Op::Lt => B::S(iv::truth(x.hi < y.lo, x.lo >= y.hi)),
                Op::Le => B::S(iv::truth(x.hi <= y.lo, x.lo > y.hi)),
                Op::Gt => B::S(iv::truth(x.lo > y.hi, x.hi <= y.lo)),
                Op::Ge => B::S(iv::truth(x.lo >= y.hi, x.hi < y.lo)),
                Op::And => B::S(iv::truth(
                    !x.contains(0.0) && !y.contains(0.0),
                    x == Iv::point(0.0) || y == Iv::point(0.0),
                )),
                Op::Or => B::S(iv::truth(
                    !x.contains(0.0) || !y.contains(0.0),
                    x == Iv::point(0.0) && y == Iv::point(0.0),
                )),
            }
        }
        Node::If(c, a, b) => {
            let c = range(c, cx).num();
            if c.is_empty() {
                B::S(Iv::EMPTY)
            } else if c == Iv::point(0.0) {
                range(b, cx)
            } else if !c.contains(0.0) {
                range(a, cx)
            } else {
                let (a, b) = (range(a, cx), range(b, cx));
                bhull(a, b)
            }
        }
        Node::Swizzle(a, s) => {
            let (n, c) = range(a, cx).comps();
            if s.iter().any(|i| *i >= n) {
                return B::S(Iv::ENTIRE);
            }
            let out: Vec<Iv> = s.iter().map(|i| c[*i as usize]).collect();
            bvec(&out)
        }
        Node::Table(t, x) => {
            let v = range(x, cx);
            if cx.planted == Some(Planted::TableFormSamples8) {
                return bmap1(v, |v| sampled8(v, |p| t.at(p)));
            }
            bmap1(v, |v| t.bound(v))
        }
        Node::Ease(e, x) => bmap1(range(x, cx), |v| e.bound(v)),
        Node::Sum {
            product,
            depth,
            a,
            b,
            term,
        } => {
            // Terms below b's least value always count; past it, up to its greatest, a term
            // counts only for some of b's values, so it adds its range or nothing (exactly 0, or
            // exactly 1 for a product).
            let (ra, rb) = (range(a, cx).num(), range(b, cx).num());
            let lo = ra.lo.ceil();
            let (sure, hi) = (rb.lo.floor(), rb.hi.floor());
            let empty = if *product { 1.0 } else { 0.0 };
            let mut acc = B::S(Iv::point(empty));
            let mut k = lo;
            let mut n = 0.0;
            while k <= hi && n < MAX_TERMS {
                cx.idx[*depth] = k;
                let mut t = range(term, cx);
                if k > sure || k < ra.hi.ceil() {
                    t = bhull(t, B::S(Iv::point(empty)));
                }
                acc = if *product {
                    bmap2(acc, t, Iv::mul)
                } else {
                    bmap2(acc, t, Iv::add)
                };
                k += 1.0;
                n += 1.0;
            }
            if !ra.is_bounded() || !rb.is_bounded() {
                return B::S(Iv::ENTIRE);
            }
            acc
        }
        Node::Call(f, args) => {
            let mut a = [B::S(Iv::EMPTY); ARGS];
            for (slot, n) in a.iter_mut().zip(args) {
                *slot = range(n, cx);
            }
            let a = &a[..args.len()];
            match (cx.planted, f) {
                (Some(Planted::SinBoundsByEnds), Fun::Sin) => bmap1(a[0], |x| {
                    Iv::point(ops::sin(x.lo)).hull(Iv::point(ops::sin(x.hi)))
                }),
                (Some(Planted::SincAsSinOverX), Fun::Sinc) => bmap1(a[0], |x| iv::sin(x).div(x)),
                (Some(Planted::RoundsToNearest), _) if a.len() == 1 => {
                    let f = *f;
                    bmap1(a[0], |x| {
                        let at = |p: f64| Iv::point(call(f, &[V::S(p)]).num());
                        at(x.lo).hull(at(x.hi))
                    })
                }
                (Some(Planted::NoiseFormSamples8), Fun::Noise | Fun::Fbm) => {
                    let mut pa = [V::S(0.0); ARGS];
                    for (slot, b) in pa.iter_mut().zip(a) {
                        let v = b.num();
                        *slot = V::S(if v.lo == v.hi { v.lo } else { f64::NAN });
                    }
                    let n = a.len();
                    let f = *f;
                    B::S(sampled8(a[0].num(), |p| {
                        let mut q = pa;
                        q[0] = V::S(p);
                        call(f, &q[..n]).num()
                    }))
                }
                _ => bcall(*f, a),
            }
        }
    }
}

/// The planted forms' bound: the least and greatest of 8 even samples across the range.
fn sampled8(r: Iv, f: impl Fn(f64) -> f64) -> Iv {
    let mut out = Iv::EMPTY;
    for i in 0..8 {
        let p = r.lo + (r.hi - r.lo) * f64::from(i) / 7.0;
        out = out.hull(Iv::point(f(p)));
    }
    out
}

fn bcall(f: Fun, a: &[B]) -> B {
    let s = |i: usize| a.get(i).map_or(Iv::ENTIRE, B::num);
    let m = |g: fn(Iv) -> Iv| bmap1(a[0], g);
    match f {
        Fun::Min => bmap2(a[0], a[1], Iv::min),
        Fun::Max => bmap2(a[0], a[1], Iv::max),
        Fun::Clamp => bmap2(bmap2(a[0], a[1], Iv::max), a[2], Iv::min),
        Fun::Abs => m(Iv::abs),
        Fun::Sign => m(iv::sign),
        Fun::Floor => m(iv::floor),
        Fun::Ceil => m(iv::ceil),
        Fun::Fract => m(iv::fract),
        Fun::Round => m(iv::round),
        Fun::Mod => bmap2(a[0], a[1], iv::modulo),
        Fun::Sqrt => m(iv::sqrt),
        Fun::Pow => bmap2(a[0], a[1], iv::pow),
        Fun::Exp => m(iv::exp),
        Fun::Log => m(iv::log),
        Fun::Sin => m(iv::sin),
        Fun::Cos => m(iv::cos),
        Fun::Tan => m(iv::tan),
        Fun::Asin => m(iv::asin),
        Fun::Acos => m(iv::acos),
        Fun::Atan => m(iv::atan),
        Fun::Atan2 => bmap2(a[0], a[1], iv::atan2),
        Fun::Deg => m(|x| x.mul(Iv::point(180.0 / ops::PI).widen(1))),
        Fun::Rad => m(|x| x.mul(Iv::point(ops::PI / 180.0).widen(1))),
        Fun::Sinh => m(iv::sinh),
        Fun::Cosh => m(iv::cosh),
        Fun::Tanh => m(iv::tanh),
        Fun::Asinh => m(iv::asinh),
        Fun::Acosh => m(iv::acosh),
        Fun::Atanh => m(iv::atanh),
        Fun::Log2 => m(iv::log2),
        Fun::Log10 => m(iv::log10),
        Fun::Log1p => m(iv::log1p),
        Fun::Expm1 => m(iv::expm1),
        Fun::Hypot => bmap2(a[0], a[1], iv::hypot),
        Fun::Cbrt => m(iv::cbrt),
        Fun::Sinc => m(iv::sinc),
        Fun::Erf => m(iv::erf),
        Fun::Erfc => m(iv::erfc),
        Fun::Gamma => m(iv::gamma),
        Fun::Lgamma => m(iv::lgamma),
        Fun::Factorial => m(iv::factorial_iv),
        Fun::Binom => bmap2(a[0], a[1], iv::binom_iv),
        Fun::Mix => {
            let d = bmap2(a[1], a[0], Iv::sub);
            bmap2(a[0], bmap2(d, a[2], Iv::mul), Iv::add)
        }
        Fun::Smoothstep => B::S(iv::smoothstep(s(0), s(1), s(2))),
        Fun::Remap => {
            let (x, a0, b0, c0, d0) = (s(0), s(1), s(2), s(3), s(4));
            B::S(c0.add(x.sub(a0).div(b0.sub(a0)).mul(d0.sub(c0))))
        }
        Fun::Vec(n) => {
            let c: Vec<Iv> = a.iter().flat_map(|v| bcomps(*v)).collect();
            if c.len() == 1 {
                return bvec(&vec![c[0]; n as usize]);
            }
            if c.len() != n as usize {
                return B::S(Iv::ENTIRE);
            }
            bvec(&c)
        }
        Fun::Length => B::S(ilen(&bcomps(a[0]))),
        Fun::Distance => B::S(ilen(&bcomps(bmap2(a[0], a[1], Iv::sub)))),
        Fun::Dot => B::S(idot(&bcomps(a[0]), &bcomps(a[1]))),
        Fun::Cross => {
            let (u, v) = (bcomps(a[0]), bcomps(a[1]));
            if u.len() != 3 || v.len() != 3 {
                return B::S(Iv::ENTIRE);
            }
            bvec(&[
                u[1].mul(v[2]).sub(u[2].mul(v[1])),
                u[2].mul(v[0]).sub(u[0].mul(v[2])),
                u[0].mul(v[1]).sub(u[1].mul(v[0])),
            ])
        }
        Fun::Normalize => {
            let c = bcomps(a[0]);
            let l = ilen(&c);
            bvec(&c.iter().map(|x| x.div(l)).collect::<Vec<_>>())
        }
        Fun::Angle => {
            let (u, v) = (bcomps(a[0]), bcomps(a[1]));
            let l = ilen(&u).mul(ilen(&v));
            let c = idot(&u, &v).div(l).meet(Iv::new(-1.0, 1.0));
            B::S(if c.is_empty() {
                Iv::new(0.0, ops::PI).widen(1)
            } else {
                iv::acos(c)
            })
        }
        Fun::Cmul => bv2(icmul(bc2(a[0]), bc2(a[1]))),
        Fun::Cdiv => bv2(icdiv(bc2(a[0]), bc2(a[1]))),
        Fun::Cexp => bv2(icexp(bc2(a[0]))),
        Fun::Clog => bv2(iclog(bc2(a[0]))),
        Fun::Cpow => bv2(icpow(bc2(a[0]), a[1])),
        Fun::Csqrt => bv2(icsqrt(bc2(a[0]))),
        Fun::Csin => {
            let (x, y) = bc2(a[0]);
            bv2((iv::sin(x).mul(iv::cosh(y)), iv::cos(x).mul(iv::sinh(y))))
        }
        Fun::Ccos => {
            let (x, y) = bc2(a[0]);
            bv2((
                iv::cos(x).mul(iv::cosh(y)),
                iv::sin(x).mul(iv::sinh(y)).neg(),
            ))
        }
        Fun::Conj => {
            let (x, y) = bc2(a[0]);
            bv2((x, y.neg()))
        }
        Fun::Cabs => {
            let (x, y) = bc2(a[0]);
            B::S(iv::hypot(x, y))
        }
        Fun::Carg => {
            let (x, y) = bc2(a[0]);
            B::S(iv::atan2(y, x))
        }
        Fun::Hash => B::S(Iv::new(0.0, 1.0)),
        Fun::Rand => {
            if a.len() == 3 {
                let (lo, hi) = (s(1), s(2));
                B::S(lo.add(hi.sub(lo).mul(Iv::new(0.0, 1.0))))
            } else {
                B::S(Iv::new(0.0, 1.0))
            }
        }
        Fun::Noise => B::S(noise::noise_bound(&bcomps(a[0]), bseed(a.get(1)))),
        Fun::Noise3 => {
            let p = bcomps(a[0]);
            match bseed(a.get(1)) {
                Some(s) => bvec(&[
                    noise::noise_bound(&p, Some(s)),
                    noise::noise_bound(&p, Some(s.wrapping_add(1))),
                    noise::noise_bound(&p, Some(s.wrapping_add(2))),
                ]),
                None => bvec(&[noise::noise_bound(&p, None); 3]),
            }
        }
        Fun::Fbm => {
            let point = |i: usize, d: f64| {
                a.get(i).map_or(Some(d), |b| {
                    let v = b.num();
                    (v.lo == v.hi).then_some(v.lo)
                })
            };
            match (point(2, 6.0), point(4, 2.0), point(3, 0.5)) {
                (Some(o), Some(l), Some(g)) => B::S(noise::fbm_bound(
                    &bcomps(a[0]),
                    bseed(a.get(1)),
                    o.clamp(1.0, 8.0) as u32,
                    l,
                    g,
                )),
                _ => B::S(Iv::ENTIRE),
            }
        }
        Fun::Cells => B::S(noise::cells_bound(&bcomps(a[0]), cells_bseed(a))),
        Fun::CellsOut(k) => {
            let p = bcomps(a[0]);
            match k {
                0 => B::S(noise::cells_bound(&p, cells_bseed(a))),
                1 => B::S(Iv::new(
                    noise::cells_bound(&p, cells_bseed(a)).lo,
                    ops::sqrt(p.len().min(3) as f64) * 2.0,
                )),
                2 => B::S(Iv::new(0.0, f64::from(u32::MAX))),
                // A center lies in one of the 3 × 3 (× 3) cells around p's.
                _ => bvec(
                    &p.iter()
                        .take(3)
                        .map(|c| Iv::new(c.lo.floor() - 1.0, c.hi.floor() + 2.0))
                        .collect::<Vec<_>>(),
                ),
            }
        }
    }
}

/// cells' seed when one point, with the planted form's time arg making it vary.
fn cells_bseed(a: &[B]) -> Option<u32> {
    if a.len() > 2 {
        return None;
    }
    bseed(a.get(1))
}

/// A seed's value when its range is one point; `None` when it varies.
fn bseed(v: Option<&B>) -> Option<u32> {
    match v {
        None => Some(0),
        Some(b) => {
            let s = b.num();
            (s.lo == s.hi).then_some(s.lo as i64 as u32)
        }
    }
}

/// Seeded gradient noise, fractal sums of it and cellular distance, on the fixed 32-bit integer
/// hash, each with an interval form that holds every value over a range: per lattice cell the
/// range covers, by the cell's formula in interval arithmetic, or, past 64 cells, the bound every
/// cell holds.
pub mod noise {
    use super::{ops, Iv};

    /// The fixed 32-bit integer hash (lowbias32).
    pub fn hash32(mut x: u32) -> u32 {
        x ^= x >> 16;
        x = x.wrapping_mul(0x7feb_352d);
        x ^= x >> 15;
        x = x.wrapping_mul(0x846c_a68b);
        x ^= x >> 16;
        x
    }

    fn mix(h: u32, v: u32) -> u32 {
        hash32(
            h ^ v
                .wrapping_add(0x9e37_79b9)
                .wrapping_add(h << 6)
                .wrapping_add(h >> 2),
        )
    }

    /// hash(…) → [0, 1): the fixed hash of each argument's whole part, as (h >> 8) × 2⁻²⁴.
    pub fn hash01(args: &[f64]) -> f64 {
        let mut h = 0x2c1b_3c6d_u32;
        for a in args {
            h = mix(h, *a as i64 as u32);
        }
        f64::from(h >> 8) / f64::from(1u32 << 24)
    }

    /// The gradient at lattice point `cell`: a unit vector, in 1D a slope in [−1, 1].
    fn gradient(seed: u32, cell: &[i64]) -> [f64; 3] {
        let mut h = hash32(seed ^ 0x51ed_270b);
        for c in cell {
            h = mix(h, *c as u32);
        }
        let u = f64::from(h >> 8) / f64::from(1u32 << 24);
        match cell.len() {
            1 => [2.0 * u - 1.0, 0.0, 0.0],
            2 => {
                let a = ops::TAU * u;
                [ops::cos(a), ops::sin(a), 0.0]
            }
            _ => {
                let h2 = mix(h, 0x68e3_1da4);
                let v = f64::from(h2 >> 8) / f64::from(1u32 << 24);
                let z = 2.0 * v - 1.0;
                let r = ops::sqrt((1.0 - z * z).max(0.0));
                let a = ops::TAU * u;
                [r * ops::cos(a), r * ops::sin(a), z]
            }
        }
    }

    fn fade(t: f64) -> f64 {
        t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
    }

    /// Gradient noise at `p` (1 to 3 components), about [−1, 1].
    pub fn noise(p: &[f64], seed: u32) -> f64 {
        let d = p.len().min(3);
        if d == 0 || p.iter().any(|v| !v.is_finite()) {
            return f64::NAN;
        }
        let cell: Vec<i64> = p[..d].iter().map(|v| v.floor() as i64).collect();
        let f: Vec<f64> = p[..d]
            .iter()
            .zip(&cell)
            .map(|(v, c)| v - *c as f64)
            .collect();
        corner_sum(d, &cell, seed, |k, i| f[k] - i as f64, |k| fade(f[k]))
    }

    /// The trilinear blend of each corner's gradient dotted with its offset.
    fn corner_sum(
        d: usize,
        cell: &[i64],
        seed: u32,
        off: impl Fn(usize, i64) -> f64,
        w: impl Fn(usize) -> f64,
    ) -> f64 {
        let mut acc = 0.0;
        for corner in 0..(1usize << d) {
            let mut c = [0i64; 3];
            let mut weight = 1.0;
            let mut dot = 0.0;
            for k in 0..d {
                let i = ((corner >> k) & 1) as i64;
                c[k] = cell[k] + i;
                let wk = w(k);
                weight *= if i == 1 { wk } else { 1.0 - wk };
            }
            let g = gradient(seed, &c[..d]);
            for (k, gk) in g.iter().enumerate().take(d) {
                let i = ((corner >> k) & 1) as i64;
                dot += gk * off(k, i);
            }
            acc += weight * dot;
        }
        acc
    }

    /// The fade's form: increasing on [0, 1].
    fn fade_bound(t: Iv) -> Iv {
        let t = t.meet(Iv::new(0.0, 1.0));
        Iv::new(
            super::iv::down(fade(t.lo), 4).max(0.0),
            super::iv::up(fade(t.hi), 4).min(1.0),
        )
    }

    /// noise's interval form over the box `p`: per lattice cell the box covers (at most 64),
    /// the cell's formula in interval arithmetic over the box's part in it; past that, or with
    /// a seed that varies, the bound every cell holds.
    pub fn noise_bound(p: &[Iv], seed: Option<u32>) -> Iv {
        let d = p.len().min(3);
        if d == 0 || p.iter().any(Iv::is_empty) {
            return Iv::EMPTY;
        }
        let global = global_bound(d);
        let Some(seed) = seed else { return global };
        if p.iter().any(|v| !v.is_bounded()) {
            return global;
        }
        let lo: Vec<i64> = p[..d].iter().map(|v| v.lo.floor() as i64).collect();
        let hi: Vec<i64> = p[..d].iter().map(|v| v.hi.floor() as i64).collect();
        let count: i64 = lo.iter().zip(&hi).map(|(a, b)| b - a + 1).product();
        if count > 64 {
            return global;
        }
        let mut out = Iv::EMPTY;
        let mut cell = lo.clone();
        loop {
            // The box's part in this cell, as offsets in [0, 1].
            let f: Vec<Iv> = (0..d)
                .map(|k| {
                    let c = cell[k] as f64;
                    p[k].meet(Iv::new(c, c + 1.0))
                        .sub(Iv::point(c))
                        .meet(Iv::new(0.0, 1.0))
                })
                .collect();
            if f.iter().all(|v| !v.is_empty()) {
                out = out.hull(cell_bound(d, &cell, seed, &f));
            }
            // The next cell, odometer style.
            let mut k = 0;
            loop {
                if k == d {
                    return out.meet(global);
                }
                cell[k] += 1;
                if cell[k] <= hi[k] {
                    break;
                }
                cell[k] = lo[k];
                k += 1;
            }
        }
    }

    fn cell_bound(d: usize, cell: &[i64], seed: u32, f: &[Iv]) -> Iv {
        let mut acc = Iv::point(0.0);
        let w: Vec<Iv> = f.iter().map(|t| fade_bound(*t)).collect();
        for corner in 0..(1usize << d) {
            let mut c = [0i64; 3];
            let mut weight = Iv::point(1.0);
            for k in 0..d {
                let i = ((corner >> k) & 1) as i64;
                c[k] = cell[k] + i;
                weight = weight.mul(if i == 1 {
                    w[k]
                } else {
                    Iv::point(1.0).sub(w[k])
                });
            }
            let g = gradient(seed, &c[..d]);
            let mut dot = Iv::point(0.0);
            for k in 0..d {
                let i = ((corner >> k) & 1) as f64;
                dot = dot.add(Iv::point(g[k]).widen(4).mul(f[k].sub(Iv::point(i))));
            }
            acc = acc.add(weight.mul(dot));
        }
        acc.widen(8)
    }

    /// The bound every cell holds: each corner's dot is at most the offset's length, √d, and the
    /// weights sum to 1.
    pub fn global_bound(d: usize) -> Iv {
        let r = ops::sqrt(d as f64) * (1.0 + 1e-12);
        Iv::new(-r, r)
    }

    /// Fractal noise: octave i at p × lacunarityⁱ with seed + i, weighted gainⁱ.
    pub fn fbm(p: &[f64], seed: u32, octaves: u32, lacunarity: f64, gain: f64) -> f64 {
        let mut acc = 0.0;
        let (mut f, mut a) = (1.0, 1.0);
        for i in 0..octaves {
            let q: Vec<f64> = p.iter().map(|v| v * f).collect();
            acc += a * noise(&q, seed.wrapping_add(i));
            f *= lacunarity;
            a *= gain;
        }
        acc
    }

    /// fbm's interval form: the sum of its octaves' forms.
    pub fn fbm_bound(p: &[Iv], seed: Option<u32>, octaves: u32, lacunarity: f64, gain: f64) -> Iv {
        let mut acc = Iv::point(0.0);
        let (mut f, mut a) = (1.0, 1.0);
        for i in 0..octaves {
            let q: Vec<Iv> = p.iter().map(|v| v.mul(Iv::point(f))).collect();
            let n = noise_bound(&q, seed.map(|s| s.wrapping_add(i)));
            acc = acc.add(Iv::point(a).mul(n));
            f *= lacunarity;
            a *= gain;
        }
        acc
    }

    /// The feature point of `cell`, jittered over the whole cell.
    fn feature(seed: u32, cell: &[i64]) -> [f64; 3] {
        let mut out = [0.0; 3];
        for (k, o) in out.iter_mut().enumerate().take(cell.len()) {
            let mut h = hash32(seed ^ 0x1b87_3593 ^ (k as u32).wrapping_mul(0x85eb_ca6b));
            for c in cell {
                h = mix(h, *c as u32);
            }
            *o = cell[k] as f64 + f64::from(h >> 8) / f64::from(1u32 << 24);
        }
        out
    }

    /// `cells(p, seed)`'s outputs: the distances to the nearest and second-nearest feature
    /// points, the nearest's cell id and the nearest point itself (`dims` components used).
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct Cells {
        pub f1: f64,
        pub f2: f64,
        pub id: u32,
        pub center: [f64; 3],
        pub dims: usize,
    }

    /// A cell's id: the fold of the hash over the seed and its coordinates, one per cell.
    fn cell_id(seed: u32, cell: &[i64]) -> u32 {
        cell.iter()
            .fold(hash32(seed ^ 0x2c1b_3c6d), |h, c| mix(h, *c as u32))
    }

    /// Cellular noise over the 3 × 3 (× 3) block around p's cell, euclidean: f1 ≤ f2, the
    /// nearest feature point's cell id and the point.
    pub fn cells(p: &[f64], seed: u32) -> Cells {
        let d = p.len().min(3);
        let none = Cells {
            f1: f64::NAN,
            f2: f64::NAN,
            id: 0,
            center: [f64::NAN; 3],
            dims: d.max(1),
        };
        if d == 0 || p.iter().any(|v| !v.is_finite()) {
            return none;
        }
        let cell: Vec<i64> = p[..d].iter().map(|v| v.floor() as i64).collect();
        let (mut s1, mut s2) = (f64::INFINITY, f64::INFINITY);
        let mut out = none;
        for n in 0..3usize.pow(d as u32) {
            let mut c = [0i64; 3];
            let mut m = n;
            for k in 0..d {
                c[k] = cell[k] + (m % 3) as i64 - 1;
                m /= 3;
            }
            let fp = feature(seed, &c[..d]);
            let s: f64 = (0..d).map(|k| (p[k] - fp[k]) * (p[k] - fp[k])).sum();
            if s < s1 {
                s2 = s1;
                s1 = s;
                out.id = cell_id(seed, &c[..d]);
                out.center = fp;
            } else if s < s2 {
                s2 = s;
            }
        }
        out.f1 = ops::sqrt(s1);
        out.f2 = ops::sqrt(s2);
        out
    }

    /// cells' interval form: per cell the box covers (at most 64), the least and greatest
    /// distance from the box's part to each feature point the cell searches, nearest taken.
    pub fn cells_bound(p: &[Iv], seed: Option<u32>) -> Iv {
        let d = p.len().min(3);
        let global = Iv::new(0.0, ops::sqrt(d as f64) * 2.0);
        let Some(seed) = seed else { return global };
        if d == 0 || p.iter().any(|v| !v.is_bounded()) {
            return global;
        }
        let lo: Vec<i64> = p[..d].iter().map(|v| v.lo.floor() as i64).collect();
        let hi: Vec<i64> = p[..d].iter().map(|v| v.hi.floor() as i64).collect();
        let count: i64 = lo.iter().zip(&hi).map(|(a, b)| b - a + 1).product();
        if count > 64 {
            return global;
        }
        let mut out = Iv::EMPTY;
        let mut cell = lo.clone();
        loop {
            let part: Vec<Iv> = (0..d)
                .map(|k| p[k].meet(Iv::new(cell[k] as f64, cell[k] as f64 + 1.0)))
                .collect();
            if part.iter().all(|v| !v.is_empty()) {
                let mut best = Iv::new(f64::INFINITY, f64::INFINITY);
                for n in 0..3usize.pow(d as u32) {
                    let mut c = [0i64; 3];
                    let mut m = n;
                    for k in 0..d {
                        c[k] = cell[k] + (m % 3) as i64 - 1;
                        m /= 3;
                    }
                    let fp = feature(seed, &c[..d]);
                    let s = (0..d).fold(Iv::point(0.0), |acc, k| {
                        acc.add(part[k].sub(Iv::point(fp[k])).sqr())
                    });
                    best = best.min(s);
                }
                out = out.hull(super::iv::sqrt(best));
            }
            let mut k = 0;
            loop {
                if k == d {
                    return out.widen(4);
                }
                cell[k] += 1;
                if cell[k] <= hi[k] {
                    break;
                }
                cell[k] = lo[k];
                k += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests;
