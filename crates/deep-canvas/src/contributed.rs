//! Rust a canvas module fills for scene3d through the core (issue #226; canvas primitives:
//! Modifier, and Marks in 3D: axes `axes3d@1`): a deform it fills in the core's `modifier@1`, and
//! the marks in 3D a kind of its own draws as. scene3d runs the one and draws the other without
//! naming the module or its kind, so neither module's interface digest holds the other's.

use serde_json::Value;

use crate::outline::Refusal;
use crate::registry::Registrar;

/// The registry a deform's entry fills.
pub const REGISTRY: &str = "modifier@1";

/// Each deform and kind the design gives a module to fill, with that module: in a build without
/// it, one is refused `module_missing`, naming it.
pub const FILLED: [(&str, &str); 2] = [("mod.axes@1", "data"), ("axes3d@1", "data")];

/// The module that fills `kind`, where the design names one.
pub fn module_of(kind: &str) -> Option<&'static str> {
    FILLED.iter().find(|(k, _)| *k == kind).map(|(_, m)| *m)
}

/// What a fill is asked, all at the frame's time: the item it runs for, its modifier (a deform's)
/// or the item itself (a kind's), any item by ID, and the document's channels.
pub struct Request<'a, 'd> {
    pub id: &'a str,
    pub value: &'a Value,
    pub item: &'a dyn Fn(&str) -> Option<&'d Value>,
    pub channels: Option<&'a Value>,
    /// A wrong program a test build plants by name, or none.
    pub planted: Option<&'a str>,
}

/// One mark a kind draws as, in the item's own space: a core mark kind (`mark.line@1`,
/// `mark.text@1`) with its params, placed at `at`, its ID `<item>#<sub>`, drawn at `opacity`.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub sub: String,
    pub kind: &'static str,
    pub at: [f64; 3],
    pub params: Value,
    pub opacity: f64,
}

/// A deform's Rust: each point moved in place, or why not (its path names the point's index).
pub type Deform = fn(&Request<'_, '_>, &mut [[f64; 3]]) -> Result<(), Refusal>;

/// A kind's Rust: its marks at the frame's time, or why not.
pub type Marks = fn(&Request<'_, '_>) -> Result<Vec<Mark>, Refusal>;

#[derive(Clone, Copy, Debug)]
pub enum Fill {
    Deform(Deform),
    Marks(Marks),
}

/// One fill the seal admitted, with the module that filled it.
#[derive(Clone, Debug)]
pub struct Sealed {
    pub kind: String,
    pub module: String,
    pub fill: Fill,
}

/// Every module's fills, sorted by module then kind.
pub fn sealed(shapes: &[(String, Registrar)]) -> Vec<Sealed> {
    let mut out: Vec<Sealed> = shapes
        .iter()
        .flat_map(|(module, r)| {
            r.fills.iter().map(move |(kind, fill)| Sealed {
                kind: kind.clone(),
                module: module.clone(),
                fill: *fill,
            })
        })
        .collect();
    out.sort_by(|a, b| (&a.module, &a.kind).cmp(&(&b.module, &b.kind)));
    out
}

impl Registrar {
    /// Fills the core's `modifier@1` with the deform `kind`: its entry, which joins this module's
    /// digest and the registry's kit, and its Rust.
    pub fn deform(&mut self, kind: &str, value: Value, fill: Deform) -> &mut Self {
        self.entry(REGISTRY, kind, value, "R6");
        self.fills.push((kind.into(), Fill::Deform(fill)));
        self
    }

    /// The marks in 3D this module's kind `kind` draws as.
    pub fn marks3d(&mut self, kind: &str, fill: Marks) -> &mut Self {
        self.fills.push((kind.into(), Fill::Marks(fill)));
        self
    }
}
