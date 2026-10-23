//! The canvas module registry and its seal (issue #305; canvas primitives: Canvas module,
//! Registry and seal, Phase; technical design: Canvas modules).
//!
//! A canvas module is a Rust crate with one [`Manifest`] and one register call, which fills a
//! [`Registrar`] with its shapes. [`Registry::seal`] registers every module in sorted name order,
//! then checks the whole set: dependency ranges (the readers of a missing optional dependency
//! left out), one owner per array, every read resolved, no read of a later phase, no cycle,
//! legal places, check machine classes and tool entries, one implementation per interface; it
//! computes each module's digest and the module-set digest. Any failure is a [`SealError`] with
//! its reason, naming the modules and arrays involved: there is no warning level and no accept
//! list. A [`Sealed`] registry never changes, and nothing here runs per frame.
//!
//! Everything is ordinary data over `BTreeMap`s and sorted `Vec`s: no static, no hash-map order,
//! nothing read from the machine, as the canvas lint requires.

mod semver;

use std::collections::{BTreeMap, BTreeSet};

use crate::canon::{self, CanonError, NoShape};
use crate::kinds::Entry;
use serde_json::{json, Value};

pub use semver::{Range, Semver};

/// The core's version, as `core@<version>` names it in every reply; it is the `deep-canvas`
/// crate's version, written here since the lint keeps `env!` out of a scope crate.
pub const CORE_VERSION: &str = "0.0.0";

/// `core@<version>`.
pub fn core_name() -> String {
    format!("core@{CORE_VERSION}")
}

/// The name the core's own arrays and operators carry (`core.<x>`); no module takes it.
pub const CORE: &str = "core";

/// The closed list of check phases, in order (canvas primitives: Phase).
const CHECK_PHASES: &[&str] = &[
    "load", "expand", "resolve", "validate", "plan", "build", "estimate", "check",
];
/// The closed list of frame phases, in order; every check phase comes before every frame phase.
const FRAME_PHASES: &[&str] = &[
    "latch", "time", "inputs", "simulate", "items", "views", "sources", "extract", "render",
    "compose", "feedback",
];
/// The audio phase, after the frame's (media processors only).
const AUDIO_PHASES: &[&str] = &["block"];

/// The closed list of places a pass may go (canvas primitives: Place in the frame).
const PLACES: &[&str] = &[
    "compute",
    "shadows",
    "sky",
    "geometry",
    "effects",
    "bloom",
    "tone_mapping",
    "finish",
    "status_guard",
    "status_colors",
    "overlays",
];

/// The closed list of check machine classes (Operator and read set: `machines`).
const MACHINES: &[&str] = &["any", "same"];

/// The agent tools that exist; a module adds entries to these and never a tool.
const TOOLS: &[&str] = &["deep_show", "deep_query", "deep_kinds", "deep_patch"];

/// The core kinds the core draws a module's kind as, until modules draw their own.
const DRAWS_AS: &[&str] = &["rect@1"];

/// An array's domain (Array and table).
const DOMAINS: &[&str] = &["item", "row", "element", "document"];

/// A table is built once at the seal or at check.
const TABLE_BUILDS: &[&str] = &["seal", "check"];

/// Carried state is a bake, a tail or a checkpoint.
const CARRIED_KINDS: &[&str] = &["bake", "tail", "checkpoint"];

/// The read-set terms that are not an array or a table (Operator and read set: `reads`). Beside
/// the design's list, `look` (the look's tokens an operator uses) and `seed` (the document's seed)
/// are terms of their own, since the content key holds both (Content key) and an operator that
/// uses one declares it like any read; a stepping operator also reads `earlier(<array>)`, the
/// array as earlier steps left it, which orders nothing at one time (Phase: simulate).
pub const READ_TERMS: &[&str] = &[
    "self",
    "parent",
    "children",
    "siblings",
    "refs",
    "set(collection)",
    "set(lights)",
    "set(sky)",
    "set(bounds)",
    "view(camera)",
    "view(viewport)",
    "view(pixel_scale)",
    "view(match.me)",
    "view(locale)",
    "view(reduced_motion)",
    "t",
    "input",
    "reading",
    "asset",
    "look",
    "seed",
];

/// The build sets, each the canvas modules a build holds (Registry and seal: `build_set`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum BuildSet {
    /// The core with text and look.
    Core,
    /// Core plus marks2d, data, graph, record, sheet and motion.
    R1,
    /// R1 plus vector, cells, scene3d and effects.
    R2,
    /// Every canvas module.
    Full,
}

impl BuildSet {
    /// The set's name.
    pub fn name(self) -> &'static str {
        match self {
            BuildSet::Core => "core",
            BuildSet::R1 => "r1",
            BuildSet::R2 => "r2",
            BuildSet::Full => "full",
        }
    }
}

/// The canvas modules the design names, with the build set each first appears in, so a kind
/// family of a module this build lacks is refused with `module_missing` and never `unknown_kind`
/// (technical design: Canvas modules, the module table). R1's canvas code stays the core's own
/// until #137 lays it out as canvas modules.
const KNOWN_MODULES: &[(&str, BuildSet)] = &[
    ("text", BuildSet::Core),
    ("look", BuildSet::Core),
    ("marks2d", BuildSet::R1),
    ("data", BuildSet::R1),
    ("graph", BuildSet::R1),
    ("record", BuildSet::R1),
    ("sheet", BuildSet::R1),
    ("motion", BuildSet::R1),
    ("vector", BuildSet::R2),
    ("cells", BuildSet::R2),
    ("scene3d", BuildSet::R2),
    ("effects", BuildSet::R2),
    ("input", BuildSet::Full),
    ("raytrace", BuildSet::Full),
    ("building", BuildSet::Full),
    ("voxels", BuildSet::Full),
    ("skin", BuildSet::Full),
    ("physics", BuildSet::Full),
    ("sandbox", BuildSet::Full),
    ("logic", BuildSet::Full),
    ("net", BuildSet::Full),
    ("media", BuildSet::Full),
    ("export", BuildSet::Full),
    ("loop", BuildSet::Full),
];

/// One dependency of a manifest.
#[derive(Clone, Debug)]
pub struct Dependency {
    pub range: Range,
    /// Only some of the module's features read the other: a build without it seals, with the
    /// operators that read it left out.
    pub optional: bool,
}

/// A canvas module's manifest (canvas primitives: Canvas module).
#[derive(Clone, Debug)]
pub struct Manifest {
    /// `[a-z0-9.]+`, unique.
    pub name: String,
    pub version: Semver,
    /// The core versions it builds against.
    pub core: Range,
    pub depends_on: BTreeMap<String, Dependency>,
    /// The Cargo feature that puts it in a build.
    pub feature: String,
    /// An SPDX identifier.
    pub license: String,
    /// `interface@major`; a build seals one implementation of each.
    pub implements: String,
}

/// A kind the module registers: its kind-registry entry (versions, params and migrations), with
/// the arrays it needs, and the core kind the core draws it as (`rect@1`: a filled box from the
/// kind's `box`), or empty for a kind that draws nothing yet.
#[derive(Clone, Debug)]
pub struct Kind {
    pub entry: Entry,
    /// The arrays the kind needs. The seal resolves each (registered, public or the kind's own,
    /// of its module or a declared dependency) and leaves the kind out when one belongs to a
    /// missing optional dependency; it is not an operator's read set, so an array whose writer
    /// the seal left out does not take the kind with it: the kind draws from its `box` through
    /// `draws_as`, not from its arrays, until modules draw their own, and a field an absent
    /// operator evaluates is refused on its own (`Param.operator`).
    pub needs: Vec<String>,
    pub draws_as: String,
}

/// An array, with one writer: its owner (canvas primitives: Array and table).
#[derive(Clone, Debug)]
pub struct Array {
    /// `module.x`.
    pub name: String,
    pub ty: String,
    /// `item | row | element | document`.
    pub domain: String,
    /// Its dirty class.
    pub class: String,
    pub phase: String,
    /// A private array is read only by its owner and left out of its digest.
    pub private: bool,
    /// The owner's array this one contributes to: the owner's next reader folds it in, in phase
    /// then canvas-module-name order, and the owner never names its contributor (Array and table).
    pub contributes_to: Option<String>,
}

/// A table, built once at the seal or at check, over arrays of any phase: a table over a
/// per-item array is the column view (Array and table: column view), built from the arrays as
/// the check or the seal finds them, so its reads are not phase-ordered as an operator's are.
#[derive(Clone, Debug)]
pub struct Table {
    pub name: String,
    /// `seal | check`.
    pub build: String,
    pub reads: Vec<String>,
    /// Builds the table's value the first time a check reads it; immutable once built.
    pub make: Option<MakeTable>,
}

/// A table's value: built once, shared by key, never changed.
pub type TableValue = std::sync::Arc<dyn std::any::Any + Send + Sync>;
/// Builds a table's value.
pub type MakeTable = fn() -> TableValue;

/// An operator's body: a pure function of the typed view the core builds from its read set.
pub type Run = fn(&mut crate::schedule::View<'_>) -> Result<(), crate::schedule::OpError>;

/// Which items an operator per item has a node on: `(document, item ID, item)`; per document,
/// whether the document has its node (`(document, "", null)`).
pub type Applies = fn(&Value, &str, &Value) -> bool;

/// What an operator runs per (Operator and read set: `per`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Per {
    Item,
    Document,
}

/// A fixture a canvas module registers: a document its operators run on, with the record's
/// readings its bound values read, for clean rebuilds, read-set perturbation and shuffled orders.
#[derive(Clone, Debug)]
pub struct Fixture {
    pub name: String,
    pub document: Value,
    pub record: Option<Value>,
}

/// A CPU operator with its full read set (canvas primitives: Operator and read set).
#[derive(Clone, Debug)]
pub struct Operator {
    pub name: String,
    pub phase: String,
    /// Arrays (`module.x`), tables (`table:name`) and the closed read terms.
    pub reads: Vec<String>,
    /// Its own arrays.
    pub writes: Vec<String>,
    pub per: Per,
    /// The items (or the document) it has a node on; `None` is every item, or the document.
    pub applies: Option<Applies>,
    /// Its body; an operator without one is a shape only and has no node.
    pub run: Option<Run>,
    /// A stepping operator's step length in flicks: it steps in simulate at every multiple of it.
    pub step: Option<i64>,
}

impl Operator {
    /// Runs once per document.
    pub fn document(&mut self) -> &mut Self {
        self.per = Per::Document;
        self
    }

    /// Has a node only where `applies` says.
    pub fn applies(&mut self, applies: Applies) -> &mut Self {
        self.applies = Some(applies);
        self
    }

    /// Its body.
    pub fn run(&mut self, run: Run) -> &mut Self {
        self.run = Some(run);
        self
    }

    /// Steps in simulate every `flicks`, once per document.
    pub fn steps(&mut self, flicks: i64) -> &mut Self {
        self.step = Some(flicks);
        self.per = Per::Document;
        self
    }
}

/// Carried state: a bake, tail or checkpoint, with a key and a byte budget.
#[derive(Clone, Debug)]
pub struct Carried {
    /// `bake | tail | checkpoint`.
    pub kind: String,
    pub key: String,
    pub bytes: u64,
}

/// A GPU pass into a named place.
#[derive(Clone, Debug)]
pub struct Pass {
    pub name: String,
    pub place: String,
}

/// A check kind the module registers.
#[derive(Clone, Debug)]
pub struct Check {
    pub kind: String,
    /// `any | same`.
    pub machines: String,
}

/// An entry in an existing agent tool.
#[derive(Clone, Debug)]
pub struct ToolEntry {
    pub tool: String,
    pub entry: String,
}

/// What one module registers, in the order its register call gave them; the seal sorts.
#[derive(Clone, Debug, Default)]
pub struct Registrar {
    pub kinds: Vec<Kind>,
    pub arrays: Vec<Array>,
    pub tables: Vec<Table>,
    pub operators: Vec<Operator>,
    pub carried: Vec<Carried>,
    pub passes: Vec<Pass>,
    pub checks: Vec<Check>,
    pub tool_entries: Vec<ToolEntry>,
    pub fixtures: Vec<Fixture>,
}

impl Registrar {
    pub fn kind(&mut self, entry: Entry, needs: &[&str], draws_as: &str) -> &mut Self {
        self.kinds.push(Kind {
            entry,
            needs: needs.iter().map(|s| s.to_string()).collect(),
            draws_as: draws_as.into(),
        });
        self
    }

    pub fn array(
        &mut self,
        name: &str,
        ty: &str,
        domain: &str,
        class: &str,
        phase: &str,
    ) -> &mut Self {
        self.arrays.push(Array {
            name: name.into(),
            ty: ty.into(),
            domain: domain.into(),
            class: class.into(),
            phase: phase.into(),
            private: false,
            contributes_to: None,
        });
        self
    }

    /// An array that contributes to `to`, another module's array.
    pub fn contribution(
        &mut self,
        name: &str,
        ty: &str,
        domain: &str,
        class: &str,
        phase: &str,
        to: &str,
    ) -> &mut Self {
        self.array(name, ty, domain, class, phase);
        if let Some(last) = self.arrays.last_mut() {
            last.contributes_to = Some(to.into());
        }
        self
    }

    pub fn private_array(
        &mut self,
        name: &str,
        ty: &str,
        domain: &str,
        class: &str,
        phase: &str,
    ) -> &mut Self {
        self.array(name, ty, domain, class, phase);
        if let Some(last) = self.arrays.last_mut() {
            last.private = true;
        }
        self
    }

    pub fn table(&mut self, name: &str, build: &str, reads: &[&str]) -> &mut Self {
        self.tables.push(Table {
            name: name.into(),
            build: build.into(),
            reads: reads.iter().map(|s| s.to_string()).collect(),
            make: None,
        });
        self
    }

    /// A table built at check by `make`, the first time an operator reads it.
    pub fn built_table(&mut self, name: &str, make: MakeTable) -> &mut Self {
        self.table(name, "check", &[]);
        if let Some(last) = self.tables.last_mut() {
            last.make = Some(make);
        }
        self
    }

    pub fn operator(
        &mut self,
        name: &str,
        phase: &str,
        reads: &[&str],
        writes: &[&str],
    ) -> &mut Operator {
        self.operators.push(Operator {
            name: name.into(),
            phase: phase.into(),
            reads: reads.iter().map(|s| s.to_string()).collect(),
            writes: writes.iter().map(|s| s.to_string()).collect(),
            per: Per::Item,
            applies: None,
            run: None,
            step: None,
        });
        self.operators.last_mut().expect("just pushed")
    }

    /// A fixture document, with the record's readings its bound values read.
    pub fn fixture(&mut self, name: &str, document: Value, record: Option<Value>) -> &mut Self {
        self.fixtures.push(Fixture {
            name: name.into(),
            document,
            record,
        });
        self
    }

    pub fn carried(&mut self, kind: &str, key: &str, bytes: u64) -> &mut Self {
        self.carried.push(Carried {
            kind: kind.into(),
            key: key.into(),
            bytes,
        });
        self
    }

    pub fn pass(&mut self, name: &str, place: &str) -> &mut Self {
        self.passes.push(Pass {
            name: name.into(),
            place: place.into(),
        });
        self
    }

    pub fn check(&mut self, kind: &str, machines: &str) -> &mut Self {
        self.checks.push(Check {
            kind: kind.into(),
            machines: machines.into(),
        });
        self
    }

    pub fn tool_entry(&mut self, tool: &str, entry: &str) -> &mut Self {
        self.tool_entries.push(ToolEntry {
            tool: tool.into(),
            entry: entry.into(),
        });
        self
    }
}

/// A canvas module as a build holds it: its manifest and its one register call.
pub struct Module {
    pub manifest: Manifest,
    pub register: fn(&mut Registrar),
}

/// A planted wrong seal, for the proof that the right one is checked (#305: "a planted seal that
/// treats every dependency as required refuses the first build").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    EveryDependencyRequired,
}

/// Why the seal refused the set. `modules` and `arrays` name what is involved, sorted.
#[derive(Debug)]
pub struct SealError {
    pub code: &'static str,
    pub modules: Vec<String>,
    pub arrays: Vec<String>,
    pub what: String,
}

impl SealError {
    fn new(code: &'static str, modules: &[&str], arrays: &[&str], what: String) -> SealError {
        let mut modules: Vec<String> = modules.iter().map(|s| s.to_string()).collect();
        modules.sort();
        modules.dedup();
        let mut arrays: Vec<String> = arrays.iter().map(|s| s.to_string()).collect();
        arrays.sort();
        arrays.dedup();
        SealError {
            code,
            modules,
            arrays,
            what,
        }
    }
}

/// One registered module after the seal.
#[derive(Debug)]
pub struct SealedModule {
    pub name: String,
    pub version: Semver,
    /// A d1 digest over its registered shapes: its interface's digest.
    pub digest: String,
    pub shapes: Registrar,
}

/// One array in the sealed set.
#[derive(Debug)]
pub struct SealedArray {
    pub owner: String,
    pub ty: String,
    pub domain: String,
    pub class: String,
    pub phase: String,
    pub private: bool,
    pub contributes_to: Option<String>,
}

/// One operator the seal kept, the core's own among them (module `core`).
#[derive(Debug)]
pub struct SealedOp {
    /// `module.operator`.
    pub key: String,
    pub module: String,
    /// Its canvas module's version (the core's for the core's own), which every key it makes holds.
    pub version: Semver,
    pub op: Operator,
}

/// One table the seal kept.
#[derive(Debug)]
pub struct SealedTable {
    pub owner: String,
    pub build: String,
    pub make: Option<MakeTable>,
}

/// The registry after the seal; it never changes.
#[derive(Debug)]
pub struct Sealed {
    pub build_set: BuildSet,
    /// Sorted by name.
    pub modules: Vec<SealedModule>,
    pub arrays: BTreeMap<String, SealedArray>,
    /// The operators in each phase, as `module.operator`, in the order the seal derived.
    pub plan: BTreeMap<String, Vec<String>>,
    /// Every operator the plan holds, in phase order and, inside a phase, in the plan's order.
    pub ops: Vec<SealedOp>,
    /// Each array's contributions, in phase then canvas-module-name order.
    pub contributions: BTreeMap<String, Vec<String>>,
    pub tables: BTreeMap<String, SealedTable>,
    /// Every module's fixtures, the core's first, as `(module, fixture)`.
    pub fixtures: Vec<(String, Fixture)>,
    /// `module.operator` → the missing optional module whose array it read.
    left_out: BTreeMap<String, String>,
    /// `family.name` → the missing optional module whose array the kind needs.
    left_out_kinds: BTreeMap<String, String>,
    /// A d1 digest over the sorted modules' names, versions and digests.
    pub set_digest: String,
}

impl Sealed {
    /// `sealed`, the state after a successful seal.
    pub fn state(&self) -> &'static str {
        "sealed"
    }

    /// Where the sealed plan is published: `deep://schedule/<core version>`.
    pub fn schedule_uri(&self) -> String {
        format!("deep://schedule/{}", core_name())
    }

    /// The sealed plan as published (Registry and seal): every phase's operators in the order
    /// the scheduler runs them, each with its canvas module and version, its read set as its
    /// module registered it, its writes, what it runs per and its step, and every array's
    /// contributions in the order they fold in. It is compared with a committed snapshot.
    pub fn schedule(&self) -> Value {
        let mut phases = serde_json::Map::new();
        for o in &self.ops {
            let mut entry = json!({
                "operator": o.key, "module": o.module, "version": o.version.to_string(),
                "reads": o.op.reads, "writes": o.op.writes,
                "per": match o.op.per { Per::Item => "item", Per::Document => "document" },
            });
            if let Some(step) = o.op.step {
                entry["step"] = json!(step);
            }
            phases
                .entry(o.op.phase.clone())
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .expect("a list")
                .push(entry);
        }
        json!({
            "uri": self.schedule_uri(),
            "core": core_name(),
            "build_set": self.build_set.name(),
            "set_digest": self.set_digest,
            "phases": phases,
            "contributions": self.contributions,
        })
    }

    /// The module named `name`, if this build holds it.
    pub(crate) fn module(&self, name: &str) -> Option<&SealedModule> {
        self.modules.iter().find(|m| m.name == name)
    }

    /// True when this build registered `name`.
    fn has(&self, name: &str) -> bool {
        self.module(name).is_some()
    }

    /// True when this build holds `name`: a registered module, or one of the core's and R1's
    /// own (a KNOWN_MODULES entry at Core or R1), which no build registers apart until #137
    /// lays it out.
    fn held(&self, name: &str) -> bool {
        self.has(name) || core_held(name)
    }

    /// True when the module and its version satisfy `range`. A module of the core's and R1's
    /// own code (a KNOWN_MODULES entry at Core or R1), which no build registers apart until #137
    /// lays it out, is held by every build at whatever range a document asks.
    pub(crate) fn satisfies(&self, name: &str, range: &Range) -> bool {
        match self.module(name) {
            Some(m) => range.matches(m.version),
            None => self.held(name),
        }
    }

    /// The missing module that keeps `module`'s `operator` out of the plan: the module itself
    /// when the build lacks it, else the optional dependency the operator reads.
    pub(crate) fn missing_for(&self, module: &str, operator: &str) -> Option<String> {
        if !self.held(module) {
            return Some(module.to_string());
        }
        self.left_out.get(&format!("{module}.{operator}")).cloned()
    }

    /// The core kind the core draws `kind_text`'s items as, when a sealed module registered it
    /// with one (`rect@1`), else `None`.
    pub fn draws_as(&self, kind_text: &str) -> Option<&str> {
        let (full, major) = crate::kinds::parse_kind(kind_text)?;
        self.modules
            .iter()
            .flat_map(|m| m.shapes.kinds.iter())
            .find(|k| {
                k.entry.full_name() == full
                    && k.entry.version(major).is_some()
                    && !k.draws_as.is_empty()
            })
            .map(|k| k.draws_as.as_str())
    }

    /// The core's kinds plus every kind the sealed modules register.
    pub fn kinds(&self) -> crate::kinds::Registry {
        let mut out = crate::kinds::registry();
        out.extend(
            self.modules
                .iter()
                .flat_map(|m| m.shapes.kinds.iter().map(|k| k.entry.clone())),
        );
        out
    }

    /// The sealed module that registered the kind `family.name`, if one did.
    pub(crate) fn module_of_kind(&self, full_name: &str) -> Option<&str> {
        self.modules
            .iter()
            .find(|m| {
                m.shapes
                    .kinds
                    .iter()
                    .any(|k| k.entry.full_name() == full_name)
            })
            .map(|m| m.name.as_str())
    }

    /// The canvas module a kind's family belongs to when this build lacks it: a registered
    /// kind's module, or a design-named module whose kind family this is.
    pub(crate) fn missing_for_kind(&self, kind_name: &str) -> Option<String> {
        let full = kind_name.split('@').next().unwrap_or(kind_name);
        for m in &self.modules {
            if m.shapes.kinds.iter().any(|k| k.entry.full_name() == full) {
                return self.left_out_kinds.get(full).cloned();
            }
        }
        // The core's and R1's modules are the core's own code until #137 lays them out, so
        // their kinds are never missing here; a later module's family is, when it is absent.
        let family = full.split('.').next().unwrap_or(full);
        KNOWN_MODULES
            .iter()
            .find(|(name, set)| *set > BuildSet::R1 && *name == family && !self.has(name))
            .map(|(name, _)| name.to_string())
    }
}

/// The registry while it registers.
pub struct Registry {
    build_set: BuildSet,
    modules: Vec<Module>,
    fault: Option<Fault>,
}

impl Registry {
    pub fn new(build_set: BuildSet) -> Registry {
        Registry {
            build_set,
            modules: Vec::new(),
            fault: None,
        }
    }

    /// Plants a wrong seal; test builds only.
    pub fn plant(mut self, fault: Fault) -> Registry {
        self.fault = Some(fault);
        self
    }

    /// Adds a module to register; the seal orders them by name.
    pub fn with(mut self, module: Module) -> Registry {
        self.modules.push(module);
        self
    }

    /// Registers every module in sorted name order, then checks the whole set.
    pub fn seal(mut self) -> Result<Sealed, SealError> {
        self.modules
            .sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
        let core = Semver::parse(CORE_VERSION).expect("CORE_VERSION is major.minor.patch");

        // Manifests: names, core ranges, dependency ranges, one implementation per interface.
        let mut implementations: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        let mut missing_optional: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for (i, module) in self.modules.iter().enumerate() {
            let m = &module.manifest;
            let name = m.name.as_str();
            if !well_named(name) {
                return Err(SealError::new(
                    "bad_module_name",
                    &[name],
                    &[],
                    format!("`{name}` is not [a-z0-9]+ segments joined by `.`"),
                ));
            }
            if name == CORE || self.modules[..i].iter().any(|o| o.manifest.name == m.name) {
                return Err(SealError::new(
                    "duplicate_module",
                    &[name],
                    &[],
                    format!("`{name}` registers twice"),
                ));
            }
            if !m.core.matches(core) {
                return Err(SealError::new(
                    "core_range",
                    &[name],
                    &[],
                    format!("`{name}` needs core {} and this is core@{core}", m.core),
                ));
            }
            for (dep, d) in &m.depends_on {
                if dep == name {
                    return Err(SealError::new(
                        "cycle",
                        &[name],
                        &[],
                        format!("`{name}` depends on itself"),
                    ));
                }
                let required = !d.optional || self.fault == Some(Fault::EveryDependencyRequired);
                match self.modules.iter().find(|o| o.manifest.name == *dep) {
                    None if core_held(dep) => {}
                    None if required => {
                        return Err(SealError::new(
                            "missing_dependency",
                            &[name, dep],
                            &[],
                            format!("`{name}` requires `{dep}`, which this build lacks"),
                        ))
                    }
                    None => {
                        missing_optional
                            .entry(name)
                            .or_default()
                            .insert(dep.as_str());
                    }
                    Some(found) if !d.range.matches(found.manifest.version) => {
                        return Err(SealError::new(
                            "dependency_range",
                            &[name, dep],
                            &[],
                            format!(
                                "`{name}` needs `{dep}` {} and this build has {}",
                                d.range, found.manifest.version
                            ),
                        ))
                    }
                    Some(_) => {}
                }
            }
            if !m.implements.is_empty() {
                implementations
                    .entry(m.implements.as_str())
                    .or_default()
                    .push(name);
            }
        }
        for (interface, names) in &implementations {
            if names.len() > 1 {
                let list: Vec<&str> = names.clone();
                return Err(SealError::new(
                    "two_implementations",
                    &list,
                    &[],
                    format!(
                        "`{interface}` has two implementations in this build: {}",
                        list.join(", ")
                    ),
                ));
            }
        }
        // Register: the core's own shapes first, under the name `core`, then each module's.
        let mut shapes: Vec<(String, Registrar)> = Vec::new();
        let mut core_registrar = Registrar::default();
        crate::schedule::core_ops::register(&mut core_registrar);
        shapes.push((CORE.to_string(), core_registrar));
        for module in &self.modules {
            let mut registrar = Registrar::default();
            (module.register)(&mut registrar);
            shapes.push((module.manifest.name.clone(), registrar));
        }

        // Arrays: `module.x` named for its owner, one owner each, in a phase of the lists.
        let mut arrays: BTreeMap<String, SealedArray> = BTreeMap::new();
        for (name, r) in &shapes {
            for a in &r.arrays {
                if phase_index(&a.phase).is_none() {
                    return Err(SealError::new(
                        "unknown_phase",
                        &[name],
                        &[&a.name],
                        format!(
                            "array `{}` is in phase `{}`, which is not one of the closed lists",
                            a.name, a.phase
                        ),
                    ));
                }
                if !DOMAINS.contains(&a.domain.as_str()) {
                    return Err(SealError::new(
                        "illegal_domain",
                        &[name],
                        &[&a.name],
                        format!(
                            "array `{}` has domain `{}`; the domains are {}",
                            a.name,
                            a.domain,
                            DOMAINS.join(", ")
                        ),
                    ));
                }
                if let Some(prior) = arrays.get(&a.name) {
                    return Err(SealError::new(
                        "two_writers",
                        &[name, &prior.owner],
                        &[&a.name],
                        format!(
                            "array `{}` has two writers: `{}` and `{name}`",
                            a.name, prior.owner
                        ),
                    ));
                }
                arrays.insert(
                    a.name.clone(),
                    SealedArray {
                        owner: name.clone(),
                        ty: a.ty.clone(),
                        domain: a.domain.clone(),
                        class: a.class.clone(),
                        phase: a.phase.clone(),
                        private: a.private,
                        contributes_to: a.contributes_to.clone(),
                    },
                );
            }
        }
        // A contribution names a public array another module owns, of its phase or a later one,
        // so the owner's readers fold it in where they read the owner's array.
        for (name, r) in &shapes {
            for a in r.arrays.iter().filter(|a| a.contributes_to.is_some()) {
                let to = a.contributes_to.as_deref().unwrap_or_default();
                let Some(target) = arrays.get(to) else {
                    return Err(SealError::new(
                        "unresolved_read",
                        &[name],
                        &[&a.name, to],
                        format!("array `{}` of `{name}` contributes to `{to}`, which no module registers", a.name),
                    ));
                };
                if target.owner == *name || target.private {
                    return Err(SealError::new(
                        "illegal_contribution",
                        &[name, &target.owner],
                        &[&a.name, to],
                        format!("array `{}` of `{name}` contributes to `{to}`; a contribution names another module's public array", a.name),
                    ));
                }
                if phase_index(&a.phase) > phase_index(&target.phase) {
                    return Err(SealError::new(
                        "later_phase",
                        &[name, &target.owner],
                        &[&a.name, to],
                        format!("array `{}` of `{name}` in `{}` contributes to `{to}`, of the earlier phase `{}`", a.name, a.phase, target.phase),
                    ));
                }
            }
        }
        // Table name → the module that builds it and when: one builder per table, as one
        // writer per array, since a table is immutable once built.
        let mut tables: BTreeMap<String, (&str, &str)> = BTreeMap::new();
        for (name, r) in &shapes {
            for t in &r.tables {
                if let Some((prior, _)) = tables.get(&t.name) {
                    return Err(SealError::new(
                        "two_writers",
                        &[name, prior],
                        &[&t.name],
                        format!(
                            "table `{}` has two builders: `{prior}` and `{name}`",
                            t.name
                        ),
                    ));
                }
                tables.insert(t.name.clone(), (name, t.build.as_str()));
            }
        }
        // A table is built from tables built before it: a table that reads itself, or tables
        // that read each other, have no build order.
        {
            let mut indegree: BTreeMap<&str, usize> =
                tables.keys().map(|k| (k.as_str(), 0)).collect();
            let mut edges: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
            for (_, r) in &shapes {
                for t in &r.tables {
                    for from in t
                        .reads
                        .iter()
                        .filter_map(|read| read.strip_prefix("table:"))
                    {
                        if tables.contains_key(from) {
                            edges.entry(from).or_default().push(t.name.as_str());
                            *indegree.entry(t.name.as_str()).or_default() += 1;
                        }
                    }
                }
            }
            let mut ready: Vec<&str> = indegree
                .iter()
                .filter(|(_, d)| **d == 0)
                .map(|(k, _)| *k)
                .collect();
            while let Some(next) = ready.pop() {
                for to in edges.get(next).into_iter().flatten() {
                    let d = indegree.entry(to).or_default();
                    *d -= 1;
                    if *d == 0 {
                        ready.push(to);
                    }
                }
            }
            let stuck: Vec<&str> = indegree
                .iter()
                .filter(|(_, d)| **d > 0)
                .map(|(k, _)| *k)
                .collect();
            if !stuck.is_empty() {
                let cycle = cycle_among(&stuck, &edges);
                let modules: Vec<&str> = cycle
                    .iter()
                    .filter_map(|t| tables.get(*t))
                    .map(|(owner, _)| *owner)
                    .collect();
                return Err(SealError::new(
                    "cycle",
                    &modules,
                    &cycle,
                    format!("tables read each other in a cycle: {}", cycle.join(", ")),
                ));
            }
        }
        // An array or table is `<owner>.<x>` (Array and table), so a read of a missing optional
        // dependency's array is attributed by its name alone and never guessed: the owner is
        // the longest module-name prefix among every module the seal knows, registered or
        // named in a manifest, so no module registers into a sibling's namespace.
        let known: BTreeSet<&str> = shapes
            .iter()
            .map(|(n, _)| n.as_str())
            .chain(
                self.modules
                    .iter()
                    .flat_map(|m| m.manifest.depends_on.keys().map(String::as_str)),
            )
            .collect();
        for (name, r) in &shapes {
            let own = format!("{name}.");
            let misnamed = r
                .arrays
                .iter()
                .map(|a| &a.name)
                .chain(r.tables.iter().map(|t| &t.name))
                .find(|n| {
                    !n.starts_with(&own)
                        || !well_named(n)
                        || known
                            .iter()
                            .any(|k| k.len() > name.len() && n.starts_with(&format!("{k}.")))
                });
            if let Some(misnamed) = misnamed {
                return Err(SealError::new(
                    "not_own_name",
                    &[name],
                    &[misnamed],
                    format!("`{name}` registers `{misnamed}`; an array or table of `{name}` is named `{name}.<x>` in [a-z0-9]+ segments, with no other module's name between"),
                ));
            }
        }
        for (name, r) in &shapes {
            let missing = missing_optional.get(name.as_str());
            for t in &r.tables {
                if !TABLE_BUILDS.contains(&t.build.as_str()) {
                    return Err(SealError::new(
                        "illegal_table_build",
                        &[name],
                        &[],
                        format!(
                            "table `{}` of `{name}` is built at `{}`; a table is built at seal or check",
                            t.name, t.build
                        ),
                    ));
                }
                for read in &t.reads {
                    let bare = read.strip_prefix("table:").unwrap_or(read);
                    // Arrays are written in the phases after the seal, so a table built at
                    // the seal reads tables and read terms alone, whoever owns the name.
                    if t.build == "seal"
                        && bare == read
                        && (arrays.contains_key(read)
                            || missing_owner(missing, &known, read).is_some())
                    {
                        let owner = arrays.get(read).map(|a| a.owner.as_str());
                        return Err(SealError::new(
                            "later_phase",
                            &[name, owner.unwrap_or(name)],
                            &[read],
                            format!(
                                "table `{}` of `{name}` is built at the seal and reads `{read}`, an array written after it",
                                t.name
                            ),
                        ));
                    }
                    if let Some(array) = arrays.get(read) {
                        if array.private && array.owner != *name {
                            return Err(SealError::new(
                                "private_read",
                                &[name, &array.owner],
                                &[read],
                                format!(
                                    "table `{}` of `{name}` reads `{read}`, a private array of `{}`",
                                    t.name, array.owner
                                ),
                            ));
                        }
                        if array.owner != *name && !declares(&self.modules, name, &array.owner) {
                            return Err(SealError::new(
                                "undeclared_dependency",
                                &[name, &array.owner],
                                &[read],
                                format!(
                                    "table `{}` of `{name}` reads `{read}` of `{}`, which `{name}` does not depend on",
                                    t.name, array.owner
                                ),
                            ));
                        }
                        continue;
                    }
                    if let Some((owner, build)) = tables.get(bare).filter(|_| bare != read) {
                        if *owner != name && !declares(&self.modules, name, owner) {
                            return Err(SealError::new(
                                "undeclared_dependency",
                                &[name, owner],
                                &[read],
                                format!(
                                    "table `{}` of `{name}` reads table `{bare}` of `{owner}`, which `{name}` does not depend on",
                                    t.name
                                ),
                            ));
                        }
                        // A table built at the seal has only the seal's tables to read.
                        if t.build == "seal" && *build == "check" {
                            return Err(SealError::new(
                                "later_phase",
                                &[name, owner],
                                &[read],
                                format!(
                                    "table `{}` of `{name}` is built at the seal and reads `{bare}`, built at check",
                                    t.name
                                ),
                            ));
                        }
                        continue;
                    }
                    if READ_TERMS.contains(&read.as_str())
                        || missing_owner(missing, &known, bare).is_some()
                    {
                        continue;
                    }
                    return Err(SealError::new(
                        "unresolved_read",
                        &[name],
                        &[read],
                        format!(
                            "table `{}` of `{name}` reads `{read}`, which no module registers",
                            t.name
                        ),
                    ));
                }
            }
            for c in &r.carried {
                if !CARRIED_KINDS.contains(&c.kind.as_str()) {
                    return Err(SealError::new(
                        "illegal_carried",
                        &[name],
                        &[],
                        format!(
                            "carried `{}` of `{name}` is a `{}`; carried state is a bake, a tail or a checkpoint",
                            c.key, c.kind
                        ),
                    ));
                }
            }
        }

        // Kinds: one registration per name across the core's and every module's; the arrays a
        // kind needs resolved (one of a missing optional dependency leaves the kind out, so the
        // check refuses its items with `module_missing` naming that module); its `draws_as` one
        // of the kinds the core draws.
        let core_kinds = crate::kinds::registry();
        let mut kind_owner: BTreeMap<String, &str> = BTreeMap::new();
        let mut left_out_kinds: BTreeMap<String, String> = BTreeMap::new();
        for (name, r) in &shapes {
            let missing = missing_optional.get(name.as_str());
            for k in &r.kinds {
                let full = k.entry.full_name();
                // The kind registry's contract (`Entry`): at least one version, one per major,
                // ascending, so `current()` and `lookup` hold for a module's kind too.
                let majors: Vec<u32> = k.entry.versions.iter().map(|v| v.major).collect();
                if majors.is_empty() || majors.windows(2).any(|w| w[0] >= w[1]) {
                    return Err(SealError::new(
                        "bad_shape",
                        &[name],
                        &[],
                        format!(
                            "kind `{full}` of `{name}` has majors {majors:?}; a kind has at least one version, one per major, ascending"
                        ),
                    ));
                }
                if let Some(what) = kind_shape_fault(&k.entry, &k.draws_as) {
                    return Err(SealError::new(
                        "bad_shape",
                        &[name],
                        &[],
                        format!("kind `{full}` of `{name}` {what}"),
                    ));
                }
                // A bare name is the core's (a core kind has no family); a module's kind
                // carries its family, so no module takes `rect` or `text` from the compositor.
                if k.entry.family.is_empty() {
                    return Err(SealError::new(
                        "bad_shape",
                        &[name],
                        &[],
                        format!(
                            "kind `{full}` of `{name}` has no family; a bare name is the core's"
                        ),
                    ));
                }
                // An f32 param's default is canonicalized at its width whenever the field is
                // written, and compared against its range, so a default outside either would
                // leave a passing document without a canonical form.
                for p in k.entry.versions.iter().flat_map(|v| v.params.iter()) {
                    if p.ty != crate::kinds::ParamType::F32 {
                        continue;
                    }
                    if [p.min, p.max].iter().flatten().any(|b| !b.is_finite()) {
                        return Err(SealError::new(
                            "bad_shape",
                            &[name],
                            &[],
                            format!(
                                "param `{}` of kind `{full}` has a bound that is not finite: min {:?}, max {:?}",
                                p.name, p.min, p.max
                            ),
                        ));
                    }
                    if p.min.zip(p.max).is_some_and(|(min, max)| min > max) {
                        return Err(SealError::new(
                            "bad_shape",
                            &[name],
                            &[],
                            format!(
                                "param `{}` of kind `{full}` has min {:?} above max {:?}",
                                p.name, p.min, p.max
                            ),
                        ));
                    }
                    if p.default.is_null() {
                        continue;
                    }
                    let fits = p.default.as_f64().is_some_and(|d| {
                        (d as f32).is_finite()
                            && p.min.is_none_or(|min| d >= min)
                            && p.max.is_none_or(|max| d <= max)
                    });
                    if !fits {
                        return Err(SealError::new(
                            "bad_shape",
                            &[name],
                            &[],
                            format!(
                                "param `{}` of kind `{full}` defaults to {}, outside its f32 width or range",
                                p.name, p.default
                            ),
                        ));
                    }
                }
                if core_kinds.entry(&full).is_some() {
                    return Err(SealError::new(
                        "two_kinds",
                        &[name],
                        &[],
                        format!("`{name}` registers kind `{full}`, which the core registers"),
                    ));
                }
                if let Some(prior) = kind_owner.insert(full.clone(), name) {
                    return Err(SealError::new(
                        "two_kinds",
                        &[name, prior],
                        &[],
                        format!("kind `{full}` is registered twice: by `{prior}` and `{name}`"),
                    ));
                }
                let mut kind_causes: Vec<String> = Vec::new();
                for need in &k.needs {
                    if let Some((owner, private)) =
                        arrays.get(need).map(|a| (a.owner.as_str(), a.private))
                    {
                        if private && owner != name {
                            return Err(SealError::new(
                                "private_read",
                                &[name, owner],
                                &[need],
                                format!("kind `{full}` of `{name}` needs `{need}`, a private array of `{owner}`"),
                            ));
                        }
                        if owner != name && !declares(&self.modules, name, owner) {
                            return Err(SealError::new(
                                "undeclared_dependency",
                                &[name, owner],
                                &[need],
                                format!("kind `{full}` of `{name}` needs `{need}` of `{owner}`, which `{name}` does not depend on"),
                            ));
                        }
                        continue;
                    }
                    if let Some(owner) = missing_owner(missing, &known, need) {
                        kind_causes.push(owner.to_string());
                        continue;
                    }
                    return Err(SealError::new(
                        "unresolved_read",
                        &[name],
                        &[need],
                        format!(
                            "kind `{full}` of `{name}` needs `{need}`, which no module registers"
                        ),
                    ));
                }
                for p in k.entry.versions.iter().flat_map(|v| v.params.iter()) {
                    if p.module.is_empty() {
                        continue;
                    }
                    let evaluator = shapes.iter().find(|(n, _)| *n == p.module);
                    match evaluator {
                        Some((m, other)) => {
                            if m != name && !declares(&self.modules, name, m) {
                                return Err(SealError::new(
                                    "undeclared_dependency",
                                    &[name, m],
                                    &[],
                                    format!("param `{}` of kind `{full}` is evaluated by `{m}`, which `{name}` does not depend on", p.name),
                                ));
                            }
                            if !other.operators.iter().any(|o| o.name == p.operator) {
                                return Err(SealError::new(
                                    "unresolved_read",
                                    &[name, m],
                                    &[],
                                    format!("param `{}` of kind `{full}` is evaluated by `{m}.{}`, an operator `{m}` does not register", p.name, p.operator),
                                ));
                            }
                        }
                        None if core_held(p.module) && declares(&self.modules, name, p.module) => {}
                        None if missing.is_some_and(|set| set.contains(p.module)) => {}
                        None => {
                            return Err(SealError::new(
                                "undeclared_dependency",
                                &[name, p.module],
                                &[],
                                format!("param `{}` of kind `{full}` is evaluated by `{}`, which this build neither holds nor `{name}` declares optional", p.name, p.module),
                            ));
                        }
                    }
                }
                if let Some(cause) = kind_causes.into_iter().min() {
                    left_out_kinds.insert(full.clone(), cause);
                }
                if !k.draws_as.is_empty() && !DRAWS_AS.contains(&k.draws_as.as_str()) {
                    return Err(SealError::new(
                        "unknown_draws_as",
                        &[name],
                        &[],
                        format!(
                            "kind `{full}` of `{name}` draws as `{}`; the core draws {}",
                            k.draws_as,
                            DRAWS_AS.join(", ")
                        ),
                    ));
                }
            }
        }

        // Places, machine classes, tools, operator writes.
        for (name, r) in &shapes {
            for p in &r.passes {
                if !PLACES.contains(&p.place.as_str()) {
                    return Err(SealError::new(
                        "illegal_place",
                        &[name],
                        &[],
                        format!(
                            "pass `{}` of `{name}` goes into `{}`, which is not a place",
                            p.name, p.place
                        ),
                    ));
                }
            }
            for c in &r.checks {
                if !MACHINES.contains(&c.machines.as_str()) {
                    return Err(SealError::new(
                        "illegal_machines",
                        &[name],
                        &[],
                        format!("check `{}` of `{name}` names machines `{}`; the classes are any and same", c.kind, c.machines),
                    ));
                }
            }
            for t in &r.tool_entries {
                if !TOOLS.contains(&t.tool.as_str()) {
                    return Err(SealError::new(
                        "new_tool",
                        &[name],
                        &[],
                        format!("`{name}` adds entry `{}` to `{}`, which is not a tool; a module never adds one", t.entry, t.tool),
                    ));
                }
            }
            for (i, op) in r.operators.iter().enumerate() {
                if op.name.is_empty()
                    || !op
                        .name
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                {
                    return Err(SealError::new(
                        "bad_operator_name",
                        &[name],
                        &[],
                        format!(
                            "operator `{}` of `{name}` is not [a-z0-9_]+, so `{name}.{}` would not name it alone",
                            op.name, op.name
                        ),
                    ));
                }
                if r.operators[..i].iter().any(|o| o.name == op.name) {
                    return Err(SealError::new(
                        "duplicate_operator",
                        &[name],
                        &[],
                        format!("`{name}` registers operator `{}` twice", op.name),
                    ));
                }
                if phase_index(&op.phase).is_none() {
                    return Err(SealError::new(
                        "unknown_phase",
                        &[name],
                        &[],
                        format!("operator `{}` of `{name}` is in phase `{}`, which is not one of the closed lists", op.name, op.phase),
                    ));
                }
                // Steps run in simulate, at a positive step; only a step reads what earlier steps
                // left (Phase: simulate).
                let earlier = op.reads.iter().any(|r| r.starts_with("earlier("));
                if op.step.is_some_and(|s| s <= 0)
                    || (op.step.is_some() && op.phase != "simulate")
                    || (earlier && op.step.is_none())
                {
                    return Err(SealError::new(
                        "illegal_step",
                        &[name],
                        &[],
                        format!("operator `{}` of `{name}` steps outside simulate, at a step that isn't positive, or reads `earlier(…)` without stepping", op.name),
                    ));
                }
                for w in &op.writes {
                    if let Some(prior) = r.operators[..i].iter().find(|o| o.writes.contains(w)) {
                        return Err(SealError::new(
                            "two_writers",
                            &[name],
                            &[w],
                            format!(
                                "array `{w}` has two writers in `{name}`: `{}` and `{}`",
                                prior.name, op.name
                            ),
                        ));
                    }
                    match arrays.get(w) {
                        Some(a) if a.owner == *name => {
                            if a.phase != op.phase {
                                return Err(SealError::new(
                                    "write_phase",
                                    &[name],
                                    &[w],
                                    format!(
                                        "operator `{}` of `{name}` in `{}` writes `{w}`, an array of phase `{}`",
                                        op.name, op.phase, a.phase
                                    ),
                                ));
                            }
                        }
                        Some(a) => {
                            return Err(SealError::new(
                                "not_own_array",
                                &[name, &a.owner],
                                &[w],
                                format!(
                                    "operator `{}` of `{name}` writes `{w}`, which `{}` owns",
                                    op.name, a.owner
                                ),
                            ))
                        }
                        None => {
                            return Err(SealError::new(
                                "write_unresolved",
                                &[name],
                                &[w],
                                format!(
                                "operator `{}` of `{name}` writes `{w}`, which no module registers",
                                op.name
                            ),
                            ))
                        }
                    }
                }
            }
        }

        // Reads: resolved, of this or an earlier phase, private only by the owner; a read of a
        // missing optional dependency's array leaves the operator out, and so, in turn, are the
        // readers of what it alone would have written.
        // A table that reads a missing optional dependency's array cannot be built: its
        // readers go with the same cause (and, below, a table over an unwritten array).
        let mut table_cause: BTreeMap<String, String> = BTreeMap::new();
        for (name, r) in &shapes {
            let missing = missing_optional.get(name.as_str());
            for t in &r.tables {
                let cause = t
                    .reads
                    .iter()
                    .filter_map(|read| {
                        missing_owner(missing, &known, read.strip_prefix("table:").unwrap_or(read))
                    })
                    .map(str::to_string)
                    .min();
                if let Some(cause) = cause {
                    table_cause.insert(t.name.clone(), cause);
                }
            }
        }
        let mut left_out: BTreeMap<String, String> = BTreeMap::new();
        for (name, r) in &shapes {
            let missing = missing_optional.get(name.as_str());
            for op in &r.operators {
                let op_phase = phase_index(&op.phase).expect("operator phases were checked");
                let mut causes: Vec<String> = Vec::new();
                for read in &op.reads {
                    if READ_TERMS.contains(&read.as_str()) {
                        continue;
                    }
                    // A step's read of what earlier steps left resolves as the array's read.
                    let read = &match read
                        .strip_prefix("earlier(")
                        .and_then(|r| r.strip_suffix(')'))
                    {
                        Some(inner) => inner.to_string(),
                        None => read.clone(),
                    };
                    // Reading what it writes would keep a previous value (Operator and read
                    // set): a cycle of one, whatever build the operator lands in.
                    if op.writes.contains(read) {
                        return Err(SealError::new(
                            "cycle",
                            &[name],
                            &[read],
                            format!(
                                "operator `{}` of `{name}` reads `{read}`, which it writes",
                                op.name
                            ),
                        ));
                    }
                    if let Some(table) = read.strip_prefix("table:") {
                        if let Some((owner, _)) = tables.get(table) {
                            if *owner != name && !declares(&self.modules, name, owner) {
                                return Err(SealError::new(
                                    "undeclared_dependency",
                                    &[name, owner],
                                    &[read],
                                    format!(
                                        "operator `{}` of `{name}` reads table `{table}` of `{owner}`, which `{name}` does not depend on",
                                        op.name
                                    ),
                                ));
                            }
                            if let Some(cause) = table_cause.get(table) {
                                causes.push(cause.clone());
                            }
                            continue;
                        }
                        if let Some(owner) = missing_owner(missing, &known, table) {
                            causes.push(owner.to_string());
                            continue;
                        }
                        return Err(SealError::new(
                            "unresolved_read",
                            &[name],
                            &[],
                            format!("operator `{}` of `{name}` reads table `{table}`, which no module builds", op.name),
                        ));
                    }
                    let Some(array) = arrays.get(read) else {
                        if let Some(owner) = missing_owner(missing, &known, read) {
                            causes.push(owner.to_string());
                            continue;
                        }
                        return Err(SealError::new(
                            "unresolved_read",
                            &[name],
                            &[read],
                            format!("operator `{}` of `{name}` reads `{read}`, which no module registers", op.name),
                        ));
                    };
                    if array.private && array.owner != *name {
                        return Err(SealError::new(
                            "private_read",
                            &[name, &array.owner],
                            &[read],
                            format!(
                                "operator `{}` of `{name}` reads `{read}`, a private array of `{}`",
                                op.name, array.owner
                            ),
                        ));
                    }
                    if array.owner != *name && !declares(&self.modules, name, &array.owner) {
                        return Err(SealError::new(
                            "undeclared_dependency",
                            &[name, &array.owner],
                            &[read],
                            format!(
                                "operator `{}` of `{name}` reads `{read}` of `{}`, which `{name}` does not depend on",
                                op.name, array.owner
                            ),
                        ));
                    }
                    let read_phase = phase_index(&array.phase).expect("array phases were checked");
                    if read_phase > op_phase {
                        return Err(SealError::new(
                            "later_phase",
                            &[name, &array.owner],
                            &[read],
                            format!(
                                "operator `{}` of `{name}` in `{}` reads `{read}`, written in the later phase `{}`",
                                op.name, op.phase, array.phase
                            ),
                        ));
                    }
                    // What contributes to the array is folded in where it's read.
                    for (c, a) in &arrays {
                        if a.contributes_to.as_deref() == Some(read.as_str())
                            && phase_index(&a.phase) > Some(op_phase)
                        {
                            return Err(SealError::new(
                                "later_phase",
                                &[name, &a.owner],
                                &[read, c],
                                format!(
                                    "operator `{}` of `{name}` in `{}` reads `{read}`, to which `{c}` contributes in the later phase `{}`",
                                    op.name, op.phase, a.phase
                                ),
                            ));
                        }
                    }
                }
                if let Some(cause) = causes.into_iter().min() {
                    left_out.insert(format!("{name}.{}", op.name), cause);
                }
            }
        }
        // An array whose writer is left out is unwritten in this build: its readers go too.
        loop {
            let mut grew = false;
            let unwritten: BTreeMap<String, String> = arrays
                .iter()
                .filter_map(|(array, a)| {
                    let (n, writer) =
                        shapes
                            .iter()
                            .find(|(n, _)| *n == a.owner)
                            .and_then(|(n, r)| {
                                r.operators
                                    .iter()
                                    .find(|o| o.writes.contains(array))
                                    .map(|o| (n, o))
                            })?;
                    left_out
                        .get(&format!("{n}.{}", writer.name))
                        .map(|c| (array.clone(), c.clone()))
                })
                .collect();
            for (_, r) in &shapes {
                for t in &r.tables {
                    if table_cause.contains_key(&t.name) {
                        continue;
                    }
                    let cause = t
                        .reads
                        .iter()
                        .filter_map(|read| match read.strip_prefix("table:") {
                            Some(other) => table_cause.get(other),
                            None => unwritten.get(read.as_str()),
                        })
                        .min()
                        .cloned();
                    if let Some(cause) = cause {
                        table_cause.insert(t.name.clone(), cause);
                        grew = true;
                    }
                }
            }
            for (name, r) in &shapes {
                for op in &r.operators {
                    let key = format!("{name}.{}", op.name);
                    if left_out.contains_key(&key) {
                        continue;
                    }
                    if let Some(cause) = op
                        .reads
                        .iter()
                        .filter_map(|read| match read.strip_prefix("table:") {
                            Some(other) => table_cause.get(other),
                            None => unwritten.get(read.as_str()),
                        })
                        .min()
                    {
                        left_out.insert(key, cause.clone());
                        grew = true;
                    }
                }
            }
            if !grew {
                break;
            }
        }

        // The plan: in each phase, the operators that stay, ordered by their edges (one writes
        // an array another reads), ties by module name then operator name, and a cycle refused.
        let mut plan: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let all_phases: Vec<&str> = CHECK_PHASES
            .iter()
            .chain(FRAME_PHASES)
            .chain(AUDIO_PHASES)
            .copied()
            .collect();
        for phase in all_phases {
            // A node is `(key, module, operator)`, sorted by module name then operator name:
            // the tie order (Phase), which the key's text alone would not give when one
            // module's name is a dotted prefix of another's.
            let mut nodes: Vec<(String, &str, &Operator)> = Vec::new();
            for (name, r) in &shapes {
                for op in &r.operators {
                    let key = format!("{name}.{}", op.name);
                    if op.phase == phase && !left_out.contains_key(&key) {
                        nodes.push((key, name.as_str(), op));
                    }
                }
            }
            if nodes.is_empty() {
                continue;
            }
            nodes.sort_by(|a, b| (a.1, &a.2.name).cmp(&(b.1, &b.2.name)));
            let rank: BTreeMap<&str, usize> = nodes
                .iter()
                .enumerate()
                .map(|(i, (k, _, _))| (k.as_str(), i))
                .collect();
            let writer_of: BTreeMap<&str, &str> = nodes
                .iter()
                .flat_map(|(key, _, op)| op.writes.iter().map(move |w| (w.as_str(), key.as_str())))
                .collect();
            let mut indegree: BTreeMap<&str, usize> =
                nodes.iter().map(|(k, _, _)| (k.as_str(), 0)).collect();
            let mut edges: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
            for (key, _, op) in &nodes {
                // An operator reading what it writes would keep a previous value (Operator
                // and read set), so the self-edge stays and is a cycle of one. A reader of an
                // array also reads what contributes to it, so it comes after their writers too.
                for read in &op.reads {
                    let contributed = arrays
                        .iter()
                        .filter(|(_, a)| a.contributes_to.as_deref() == Some(read.as_str()))
                        .map(|(c, _)| c.as_str());
                    for array in std::iter::once(read.as_str()).chain(contributed) {
                        if let Some(from) = writer_of.get(array) {
                            edges.entry(from).or_default().push(key.as_str());
                            *indegree.entry(key.as_str()).or_default() += 1;
                        }
                    }
                }
            }
            let mut ready: BTreeSet<(usize, &str)> = indegree
                .iter()
                .filter(|(_, d)| **d == 0)
                .map(|(k, _)| (rank[k], *k))
                .collect();
            let mut order: Vec<String> = Vec::new();
            while let Some(next) = ready.iter().next().copied() {
                ready.remove(&next);
                let next = next.1;
                order.push(next.to_string());
                for to in edges.get(next).into_iter().flatten() {
                    let d = indegree.entry(to).or_default();
                    *d -= 1;
                    if *d == 0 {
                        ready.insert((rank[to], to));
                    }
                }
            }
            if order.len() < nodes.len() {
                let stuck: Vec<&str> = indegree
                    .iter()
                    .filter(|(_, d)| **d > 0)
                    .map(|(k, _)| *k)
                    .collect();
                let cycle = cycle_among(&stuck, &edges);
                // A node's key is `<module>.<operator>`, and a module name holds dots itself.
                let in_cycle: Vec<&(String, &str, &Operator)> = nodes
                    .iter()
                    .filter(|(k, _, _)| cycle.contains(&k.as_str()))
                    .collect();
                let modules: Vec<&str> = in_cycle.iter().map(|(_, m, _)| *m).collect();
                let cycle_arrays: Vec<&str> = in_cycle
                    .iter()
                    .flat_map(|(_, _, op)| op.writes.iter().map(String::as_str))
                    .collect();
                return Err(SealError::new(
                    "cycle",
                    &modules,
                    &cycle_arrays,
                    format!(
                        "operators in `{phase}` read each other in a cycle: {}",
                        cycle.join(", ")
                    ),
                ));
            }
            plan.insert(phase.to_string(), order);
        }

        // The operators the plan holds, in its order, with their modules' versions.
        let version_of = |name: &str| {
            self.modules
                .iter()
                .find(|m| m.manifest.name == name)
                .map_or(core, |m| m.manifest.version)
        };
        let mut ops = Vec::new();
        for phase in CHECK_PHASES.iter().chain(FRAME_PHASES).chain(AUDIO_PHASES) {
            for key in plan.get(*phase).into_iter().flatten() {
                let found = shapes.iter().find_map(|(name, r)| {
                    r.operators
                        .iter()
                        .find(|o| format!("{name}.{}", o.name) == *key)
                        .map(|o| (name, o))
                });
                if let Some((name, op)) = found {
                    ops.push(SealedOp {
                        key: key.clone(),
                        module: name.clone(),
                        version: version_of(name),
                        op: op.clone(),
                    });
                }
            }
        }
        // Contributions in phase then canvas-module-name order.
        let mut contributions: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut contributing: Vec<(&String, &SealedArray)> = arrays
            .iter()
            .filter(|(_, a)| a.contributes_to.is_some())
            .collect();
        contributing.sort_by(|a, b| {
            (phase_index(&a.1.phase), &a.1.owner, a.0).cmp(&(
                phase_index(&b.1.phase),
                &b.1.owner,
                b.0,
            ))
        });
        for (name, a) in contributing {
            if let Some(to) = &a.contributes_to {
                contributions
                    .entry(to.clone())
                    .or_default()
                    .push(name.clone());
            }
        }
        let mut sealed_tables = BTreeMap::new();
        let mut fixtures = Vec::new();
        for (name, r) in &shapes {
            for t in &r.tables {
                if !table_cause.contains_key(&t.name) {
                    sealed_tables.insert(
                        t.name.clone(),
                        SealedTable {
                            owner: name.clone(),
                            build: t.build.clone(),
                            make: t.make,
                        },
                    );
                }
            }
            fixtures.extend(r.fixtures.iter().map(|f| (name.clone(), f.clone())));
        }

        // Digests: each module's own; the core's shapes are no module's.
        let mut modules = Vec::new();
        for ((name, shapes), module) in shapes.into_iter().skip(1).zip(&self.modules) {
            let digest = module_digest(&shapes)
                .map_err(|e| SealError::new("bad_shape", &[&name], &[], e.to_string()))?;
            modules.push(SealedModule {
                name,
                version: module.manifest.version,
                digest,
                shapes,
            });
        }
        let set_digest = d1(&Value::Array(
            modules
                .iter()
                .map(|m| json!({"digest": m.digest, "name": m.name, "version": m.version.to_string()}))
                .collect(),
        ))
        .map_err(|e| SealError::new("bad_shape", &[], &[], e.to_string()))?;
        Ok(Sealed {
            build_set: self.build_set,
            modules,
            arrays,
            plan,
            ops,
            contributions,
            tables: sealed_tables,
            fixtures,
            left_out,
            left_out_kinds,
            set_digest,
        })
    }
}

/// The core's own sealed set: the core's arrays and operators and no canvas module. It always
/// seals.
pub fn core() -> Sealed {
    Registry::new(BuildSet::Core)
        .seal()
        .expect("the empty set seals")
}

/// True when `name` is `[a-z0-9]+` segments joined by `.`: the grammar of a module name and of
/// an array or table name (`<owner>.<x>`), so prefix matching on names is never ambiguous.
pub(crate) fn well_named(name: &str) -> bool {
    !name.split('.').any(str::is_empty)
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.')
}

/// True when `name` is one of the core's and R1's own modules (a KNOWN_MODULES entry at Core or
/// R1), which no build registers apart until #137 lays it out: every build holds it, at any
/// range, for a manifest's `depends_on` and a document's `requires.modules` alike.
fn core_held(name: &str) -> bool {
    KNOWN_MODULES
        .iter()
        .any(|(known, set)| *known == name && *set <= BuildSet::R1)
}

/// True when `name`'s manifest names `dep` in `depends_on`; every module reads the core's own.
fn declares(modules: &[Module], name: &str, dep: &str) -> bool {
    dep == CORE
        || modules
            .iter()
            .any(|m| m.manifest.name == name && m.manifest.depends_on.contains_key(dep))
}

/// What a module's kind entry breaks of the kind registry's contract beyond its majors, if
/// anything: a param named twice in one version; a migration that is not one major up between
/// two of its versions, is listed twice, or renames a param its source lacks or to one its
/// target lacks; a first major the steps do not reach the build's major from; or a kind drawn
/// as a rect without the `box` the core draws it from.
fn kind_shape_fault(entry: &Entry, draws_as: &str) -> Option<String> {
    for v in &entry.versions {
        let mut seen = BTreeSet::new();
        if let Some(p) = v.params.iter().find(|p| !seen.insert(p.name)) {
            return Some(format!(
                "names param `{}` twice at major {}",
                p.name, v.major
            ));
        }
    }
    let mut steps = BTreeSet::new();
    for m in &entry.migrations {
        let (Some(from), Some(to)) = (entry.version(m.from), entry.version(m.to)) else {
            return Some(format!(
                "migrates {}→{}, majors it does not have",
                m.from, m.to
            ));
        };
        if m.to != m.from + 1 {
            return Some(format!(
                "migrates {}→{}; a migration is one major up",
                m.from, m.to
            ));
        }
        if !steps.insert((m.from, m.to)) {
            return Some(format!("migrates {}→{} twice", m.from, m.to));
        }
        if let Some(r) = m.renames.iter().find(|r| from.param(r.from).is_none()) {
            return Some(format!(
                "migrates {}→{} renaming `{}`, which major {} lacks",
                m.from, m.to, r.from, m.from
            ));
        }
        if let Some(r) = m.renames.iter().find(|r| to.param(r.to).is_none()) {
            return Some(format!(
                "migrates {}→{} renaming to `{}`, which major {} lacks",
                m.from, m.to, r.to, m.to
            ));
        }
    }
    let first = entry.versions[0].major;
    if entry.steps_from(first).is_none() {
        return Some(format!(
            "has no migration path from major {first} to {}",
            entry.current().major
        ));
    }
    if draws_as == "rect@1" {
        if let Some(v) = entry.versions.iter().find(|v| {
            v.param("box")
                .is_none_or(|p| p.ty != crate::kinds::ParamType::Json)
        }) {
            return Some(format!(
                "draws as `rect@1` and has no `box` param of type Json at major {}",
                v.major
            ));
        }
    }
    None
}

/// The missing optional dependency that owns `name` (an array or table named `<module>.<x>`),
/// if one does: module names hold dots themselves, so the owner is the module whose name, with
/// a dot, is the longest prefix of it among every module the seal knows (`known`: registered
/// or named in a manifest); a name a longer known module owns is that module's, in every build.
fn missing_owner<'a>(
    missing: Option<&BTreeSet<&'a str>>,
    known: &BTreeSet<&str>,
    name: &str,
) -> Option<&'a str> {
    let owner = missing?
        .iter()
        .copied()
        .filter(|m| name.starts_with(&format!("{m}.")))
        .max_by_key(|m| m.len())?;
    let longer_known = known
        .iter()
        .any(|k| k.len() > owner.len() && name.starts_with(&format!("{k}.")));
    (!longer_known).then_some(owner)
}

/// The nodes on one cycle among `stuck` (nodes Kahn's order left behind, which includes
/// those merely downstream of a cycle), walking `edges` from the smallest name.
fn cycle_among<'a>(stuck: &[&'a str], edges: &BTreeMap<&str, Vec<&'a str>>) -> Vec<&'a str> {
    fn walk<'a>(
        at: &'a str,
        stuck: &[&'a str],
        edges: &BTreeMap<&str, Vec<&'a str>>,
        stack: &mut Vec<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Option<Vec<&'a str>> {
        if let Some(start) = stack.iter().position(|s| *s == at) {
            return Some(stack[start..].to_vec());
        }
        if done.contains(at) {
            return None;
        }
        stack.push(at);
        for to in edges.get(at).into_iter().flatten() {
            if stuck.contains(to) {
                if let Some(found) = walk(to, stuck, edges, stack, done) {
                    return Some(found);
                }
            }
        }
        stack.pop();
        done.insert(at);
        None
    }
    let mut done = BTreeSet::new();
    stuck
        .iter()
        .find_map(|start| walk(start, stuck, edges, &mut Vec::new(), &mut done))
        .expect("a node Kahn's order left behind lies on or behind a cycle")
}

/// The position of a phase across the closed lists, check phases first.
fn phase_index(phase: &str) -> Option<usize> {
    CHECK_PHASES
        .iter()
        .chain(FRAME_PHASES)
        .chain(AUDIO_PHASES)
        .position(|p| *p == phase)
}

/// A module's digest: `d1` over the kinds, public arrays, tables, carried state, check kinds
/// and tool entries it registers (Canvas module: interface and implementation: digest scope),
/// each list sorted.
fn module_digest(r: &Registrar) -> Result<String, CanonError> {
    // A private array is the implementation's own, so neither its entry nor its name in a
    // kind's needs or a table's reads enters the interface's digest.
    let private: BTreeSet<&str> = r
        .arrays
        .iter()
        .filter(|a| a.private)
        .map(|a| a.name.as_str())
        .collect();
    let public = |names: &[String]| -> Vec<String> {
        sorted(
            &names
                .iter()
                .filter(|n| !private.contains(n.as_str()))
                .cloned()
                .collect::<Vec<_>>(),
        )
    };
    let mut kinds: Vec<Value> = r
        .kinds
        .iter()
        .map(|k| {
            json!({
                "draws_as": k.draws_as,
                "migrations": k.entry.migrations.iter().map(|m| json!({
                    "from": m.from,
                    "renames": m.renames.iter().map(|r| json!({"from": r.from, "to": r.to})).collect::<Vec<_>>(),
                    "to": m.to,
                })).collect::<Vec<_>>(),
                "name": k.entry.full_name(),
                "needs": public(&k.needs),
                "versions": k.entry.versions.iter().map(|v| {
                    json!({
                        "major": v.major,
                        "minor": v.minor,
                        "params": v.params.iter().map(|p| json!({
                            "default": p.default,
                            "max": p.max.map(|x| x.to_string()),
                            "min": p.min.map(|x| x.to_string()),
                            "minor": p.minor, "module": p.module, "name": p.name,
                            "type": format!("{:?}", p.ty), "unit": p.unit,
                        })).collect::<Vec<_>>(),
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect();
    sort_values(&mut kinds)?;
    let mut arrays: Vec<Value> = r
        .arrays
        .iter()
        .filter(|a| !a.private)
        .map(|a| json!({"class": a.class, "contributes_to": a.contributes_to, "domain": a.domain, "name": a.name, "phase": a.phase, "type": a.ty}))
        .collect();
    sort_values(&mut arrays)?;
    let mut tables: Vec<Value> = r
        .tables
        .iter()
        .map(|t| json!({"build": t.build, "name": t.name, "reads": public(&t.reads)}))
        .collect();
    sort_values(&mut tables)?;
    let mut carried: Vec<Value> = r
        .carried
        .iter()
        .map(|c| json!({"bytes": c.bytes, "key": c.key, "kind": c.kind}))
        .collect();
    sort_values(&mut carried)?;
    let mut checks: Vec<Value> = r
        .checks
        .iter()
        .map(|c| json!({"kind": c.kind, "machines": c.machines}))
        .collect();
    sort_values(&mut checks)?;
    let mut tools: Vec<Value> = r
        .tool_entries
        .iter()
        .map(|t| json!({"entry": t.entry, "tool": t.tool}))
        .collect();
    sort_values(&mut tools)?;
    d1(&json!({
        "arrays": arrays,
        "carried": carried,
        "checks": checks,
        "kinds": kinds,
        "tables": tables,
        "tool_entries": tools,
    }))
}

fn sorted(list: &[String]) -> Vec<String> {
    let mut out = list.to_vec();
    out.sort();
    out
}

fn sort_values(list: &mut [Value]) -> Result<(), CanonError> {
    let mut keyed = list
        .iter()
        .map(|v| canon::canonical_bytes(v, &NoShape).map(|bytes| (bytes, v.clone())))
        .collect::<Result<Vec<_>, _>>()?;
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    for (slot, (_, value)) in list.iter_mut().zip(keyed) {
        *slot = value;
    }
    Ok(())
}

/// A d1 digest: the SHA-256 of the value's canonical bytes (technical design: Contracts that
/// can't drift; One canonical form before any hash: sorted keys, no whitespace, NFC strings,
/// whole numbers as integers), as its 64 lowercase hex digits; the algorithm's name is the
/// field's type, not part of its value.
fn d1(value: &Value) -> Result<String, CanonError> {
    canon::revision_hash(value, &NoShape)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A phase's plan without the core's own operators, which every set holds.
    fn modules_only(plan: &[String]) -> Vec<&str> {
        plan.iter()
            .map(String::as_str)
            .filter(|k| !k.starts_with("core."))
            .collect()
    }

    fn manifest(name: &str, deps: &[(&str, bool)]) -> Manifest {
        Manifest {
            name: name.into(),
            version: Semver::parse("1.0.0").unwrap(),
            core: Range::parse("*").unwrap(),
            depends_on: deps
                .iter()
                .map(|(d, optional)| {
                    (
                        d.to_string(),
                        Dependency {
                            range: Range::parse("*").unwrap(),
                            optional: *optional,
                        },
                    )
                })
                .collect(),
            feature: name.into(),
            license: "Apache-2.0".into(),
            implements: format!("{name}@1"),
        }
    }

    fn register_a(r: &mut Registrar) {
        r.array("a.x", "f64", "item", "layout", "items");
        r.operator("write_x", "items", &["self"], &["a.x"]);
    }

    fn thing() -> Entry {
        Entry {
            family: "b",
            name: "thing",
            versions: vec![crate::kinds::Version {
                major: 1,
                minor: 0,
                params: vec![crate::kinds::Param {
                    name: "box",
                    ty: crate::kinds::ParamType::Json,
                    unit: "",
                    default: Value::Null,
                    min: None,
                    max: None,
                    minor: 0,
                    module: "",
                    operator: "",
                }],
            }],
            migrations: vec![],
        }
    }

    fn register_b(r: &mut Registrar) {
        r.array("b.y", "f64", "item", "layout", "items");
        r.kind(thing(), &["b.y"], "rect@1");
        r.operator("read_a", "items", &["a.x"], &["b.y"]);
        r.operator("own", "items", &["self"], &[]);
    }

    fn a() -> Module {
        Module {
            manifest: manifest("a", &[]),
            register: register_a,
        }
    }

    fn b(optional: bool) -> Module {
        Module {
            manifest: manifest("b", &[("a", optional)]),
            register: register_b,
        }
    }

    #[test]
    fn the_shipped_pair_seals_in_name_order_with_a_plan() {
        let sealed = Registry::new(BuildSet::Full)
            .with(b(false))
            .with(a())
            .seal()
            .unwrap();
        let names: Vec<&str> = sealed.modules.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["a", "b"]);
        assert_eq!(
            modules_only(&sealed.plan["items"]),
            ["a.write_x", "b.own", "b.read_a"]
        );
        assert!(sealed.left_out.is_empty());
        assert_eq!(sealed.set_digest.len(), 64);
    }

    #[test]
    fn a_missing_optional_dependency_leaves_its_readers_out() {
        let sealed = Registry::new(BuildSet::Core).with(b(true)).seal().unwrap();
        assert_eq!(
            sealed.left_out.get("b.read_a").map(String::as_str),
            Some("a")
        );
        assert_eq!(modules_only(&sealed.plan["items"]), ["b.own"]);
        assert_eq!(sealed.missing_for("b", "read_a").as_deref(), Some("a"));
        assert_eq!(sealed.missing_for("b", "own"), None);
        assert_eq!(sealed.missing_for("a", "write_x").as_deref(), Some("a"));
    }

    #[test]
    fn a_missing_required_dependency_refuses_naming_both() {
        let err = Registry::new(BuildSet::Core)
            .with(b(false))
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "missing_dependency");
        assert_eq!(err.modules, ["a", "b"]);
    }

    #[test]
    fn the_planted_seal_treats_optional_as_required() {
        let err = Registry::new(BuildSet::Core)
            .with(b(true))
            .plant(Fault::EveryDependencyRequired)
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "missing_dependency");
    }

    #[test]
    fn two_writers_of_one_array_refuse_naming_modules_and_array() {
        fn also_x(r: &mut Registrar) {
            r.array("a.x", "f64", "item", "layout", "items");
        }
        let twin = Module {
            manifest: manifest("c", &[]),
            register: also_x,
        };
        let err = Registry::new(BuildSet::Full)
            .with(a())
            .with(twin)
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_writers");
        assert_eq!(err.modules, ["a", "c"]);
        assert_eq!(err.arrays, ["a.x"]);
        fn write_twice(r: &mut Registrar) {
            r.array("a.x", "f64", "item", "layout", "items");
            r.array("a.x", "f64", "item", "layout", "items");
        }
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("a", &[]),
                register: write_twice,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_writers");
        assert_eq!(err.arrays, ["a.x"]);
        assert_eq!(err.modules, ["a"]);
    }

    #[test]
    fn a_read_of_a_later_phase_refuses() {
        fn early(r: &mut Registrar) {
            r.array("c.z", "f64", "item", "layout", "render");
            r.operator("late", "render", &["self"], &["c.z"]);
            r.operator("early", "items", &["c.z"], &[]);
        }
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[]),
                register: early,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "later_phase");
        assert_eq!(err.arrays, ["c.z"]);
    }

    #[test]
    fn a_cycle_refuses_naming_both_modules() {
        fn c(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
            r.operator("p", "items", &["d.q"], &["c.p"]);
        }
        fn d(r: &mut Registrar) {
            r.array("d.q", "f64", "item", "layout", "items");
            r.operator("q", "items", &["c.p"], &["d.q"]);
        }
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[("d", false)]),
                register: c,
            })
            .with(Module {
                manifest: manifest("d", &[("c", false)]),
                register: d,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "cycle");
        assert_eq!(err.modules, ["c", "d"]);
        assert_eq!(err.arrays, ["c.p", "d.q"]);
        // A module downstream of the cycle is stuck behind it, not in it.
        fn e(r: &mut Registrar) {
            r.array("e.r", "f64", "item", "layout", "items");
            r.operator("r", "items", &["c.p"], &["e.r"]);
        }
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[("d", false)]),
                register: c,
            })
            .with(Module {
                manifest: manifest("d", &[("c", false)]),
                register: d,
            })
            .with(Module {
                manifest: manifest("e", &[("c", false)]),
                register: e,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "cycle");
        assert_eq!(err.modules, ["c", "d"]);
        assert_eq!(err.arrays, ["c.p", "d.q"]);
        // Two manifests that depend on each other are no cycle by themselves: each may read
        // the other's array of an earlier phase.
        fn c_later(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
            r.operator("p", "items", &["self"], &["c.p"]);
            r.operator("late", "render", &["d.q"], &[]);
        }
        fn d_later(r: &mut Registrar) {
            r.array("d.q", "f64", "item", "layout", "items");
            r.operator("q", "items", &["c.p"], &["d.q"]);
        }
        assert!(Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[("d", false)]),
                register: c_later,
            })
            .with(Module {
                manifest: manifest("d", &[("c", false)]),
                register: d_later,
            })
            .seal()
            .is_ok());
    }

    #[test]
    fn places_machines_tools_and_interfaces_are_closed() {
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[]),
                register: |r| {
                    r.pass("glow", "somewhere");
                },
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "illegal_place");
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[]),
                register: |r| {
                    r.check("c.audit", "fast");
                },
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "illegal_machines");
        let err = Registry::new(BuildSet::Full)
            .with(Module {
                manifest: manifest("c", &[]),
                register: |r| {
                    r.tool_entry("deep_new", "x");
                },
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "new_tool");
        let mut twin = manifest("c", &[]);
        twin.implements = "a@1".into();
        let err = Registry::new(BuildSet::Full)
            .with(a())
            .with(Module {
                manifest: twin,
                register: |_| {},
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_implementations");
        assert_eq!(err.modules, ["a", "c"]);
    }

    #[test]
    fn digests_follow_the_shapes_and_the_set() {
        let empty = Registry::new(BuildSet::Core).seal().unwrap();
        let with_a = Registry::new(BuildSet::Core).with(a()).seal().unwrap();
        let again = Registry::new(BuildSet::Core).with(a()).seal().unwrap();
        assert_ne!(empty.set_digest, with_a.set_digest);
        assert_eq!(with_a.set_digest, again.set_digest);
        // A private array stays out of the digest; a public one enters it.
        fn pub_arr(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
        }
        fn priv_arr(r: &mut Registrar) {
            r.private_array("c.p", "f64", "item", "layout", "items");
        }
        let p = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: pub_arr,
            })
            .seal()
            .unwrap();
        let q = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: priv_arr,
            })
            .seal()
            .unwrap();
        let none = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: |_| {},
            })
            .seal()
            .unwrap();
        assert_ne!(p.modules[0].digest, q.modules[0].digest);
        assert_eq!(q.modules[0].digest, none.modules[0].digest);
    }

    #[test]
    fn a_kinds_shape_moves_the_digest() {
        fn one(r: &mut Registrar) {
            r.kind(thing(), &[], "rect@1");
        }
        fn with_param(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "u",
                default: json!(1),
                min: Some(0.0),
                max: Some(10.0),
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        fn other_type(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::Json,
                unit: "u",
                default: json!(1),
                min: Some(0.0),
                max: Some(10.0),
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        fn other_max(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "u",
                default: json!(1),
                min: Some(0.0),
                max: Some(11.0),
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        let seal = |register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("b", &[]),
                    register,
                })
                .seal()
                .unwrap()
                .set_digest
        };
        let digests = [
            seal(one),
            seal(with_param),
            seal(other_type),
            seal(other_max),
        ];
        for (i, a) in digests.iter().enumerate() {
            for b in &digests[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn kinds_are_one_per_name_with_their_needs_and_draws_as_resolved() {
        fn shadows_core(r: &mut Registrar) {
            let mut entry = thing();
            entry.family = "test";
            entry.name = "rect";
            r.kind(entry, &[], "");
        }
        fn registers_thing(r: &mut Registrar) {
            r.kind(thing(), &[], "rect@1");
        }
        fn needs_nothing_known(r: &mut Registrar) {
            r.kind(thing(), &["b.nothing"], "rect@1");
        }
        fn draws_as_unknown(r: &mut Registrar) {
            r.kind(thing(), &[], "nope@1");
        }
        let one = |name: &str, register: fn(&mut Registrar)| Module {
            manifest: manifest(name, &[]),
            register,
        };
        let err = Registry::new(BuildSet::Core)
            .with(one("b", shadows_core))
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_kinds");
        let err = Registry::new(BuildSet::Core)
            .with(one("b", registers_thing))
            .with(one("c", registers_thing))
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_kinds");
        assert_eq!(err.modules, ["b", "c"]);
        let err = Registry::new(BuildSet::Core)
            .with(one("b", needs_nothing_known))
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "unresolved_read");
        assert_eq!(err.arrays, ["b.nothing"]);
        let err = Registry::new(BuildSet::Core)
            .with(one("b", draws_as_unknown))
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "unknown_draws_as");
        // A kind's need of a missing optional dependency's array is fine: the build leaves the
        // kind to the check.
        assert!(Registry::new(BuildSet::Core).with(b(true)).seal().is_ok());
    }

    #[test]
    fn a_read_needs_a_declared_dependency_and_a_write_its_arrays_phase() {
        fn reads_a_undeclared(r: &mut Registrar) {
            r.operator("peek", "items", &["a.x"], &[]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(a())
            .with(Module {
                manifest: manifest("b", &[]),
                register: reads_a_undeclared,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "undeclared_dependency");
        assert_eq!(err.modules, ["a", "b"]);
        assert_eq!(err.arrays, ["a.x"]);
        fn writes_in_another_phase(r: &mut Registrar) {
            r.array("c.late", "f64", "item", "layout", "render");
            r.operator("early", "items", &["self"], &["c.late"]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: writes_in_another_phase,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "write_phase");
        assert_eq!(err.arrays, ["c.late"]);
        fn kind_needs_a_undeclared(r: &mut Registrar) {
            r.kind(thing(), &["a.x"], "rect@1");
        }
        let err = Registry::new(BuildSet::Core)
            .with(a())
            .with(Module {
                manifest: manifest("b", &[]),
                register: kind_needs_a_undeclared,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "undeclared_dependency");
        assert_eq!(err.arrays, ["a.x"]);
    }

    #[test]
    fn plan_ties_break_by_module_name_then_operator_name() {
        fn x(r: &mut Registrar) {
            r.operator("z", "items", &["self"], &[]);
        }
        fn x_a(r: &mut Registrar) {
            r.operator("b", "items", &["self"], &[]);
        }
        let sealed = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("x.a", &[]),
                register: x_a,
            })
            .with(Module {
                manifest: manifest("x", &[]),
                register: x,
            })
            .seal()
            .unwrap();
        assert_eq!(modules_only(&sealed.plan["items"]), ["x.z", "x.a.b"]);
    }

    #[test]
    fn a_reader_runs_after_its_writer_whatever_their_names_and_readers_share() {
        // Bevy's schedule `ambiguity` and `read_only` cases: a read and a write of one value
        // are ordered by the read, never by name, and two reads of it seal clean.
        fn a(r: &mut Registrar) {
            r.operator("read", "items", &["z.x"], &[]);
            r.operator("also", "items", &["z.x"], &[]);
        }
        fn z(r: &mut Registrar) {
            r.array("z.x", "f64", "item", "layout", "items");
            r.operator("write", "items", &["self"], &["z.x"]);
        }
        let sealed = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("a", &[("z", false)]),
                register: a,
            })
            .with(Module {
                manifest: manifest("z", &[]),
                register: z,
            })
            .seal()
            .unwrap();
        assert_eq!(
            modules_only(&sealed.plan["items"]),
            ["z.write", "a.also", "a.read"]
        );
    }

    #[test]
    fn the_cores_own_modules_satisfy_any_range() {
        let sealed = core();
        let caret = Range::parse("^1").unwrap();
        assert!(sealed.satisfies("text", &caret));
        assert!(sealed.satisfies("marks2d", &caret));
        assert!(!sealed.satisfies("logic", &caret));
        assert!(!sealed.satisfies("b", &caret));
    }

    #[test]
    fn d1_hashes_one_canonical_form() {
        let a = json!({"b": [1, {"z": "é", "a": true}], "a": null, "f": 40.0});
        let b = json!({"a": null, "b": [1, {"a": true, "z": "é"}], "f": 40});
        assert_eq!(d1(&a).unwrap(), d1(&b).unwrap());
        assert_ne!(d1(&a).unwrap(), d1(&json!({"a": null})).unwrap());
        assert_eq!(d1(&a).unwrap().len(), 64);
    }

    #[test]
    fn operator_names_are_one_word_and_arrays_carry_their_owner() {
        fn dotted(r: &mut Registrar) {
            r.operator("a.b", "items", &["self"], &[]);
        }
        fn others_array(r: &mut Registrar) {
            r.array("other.x", "f64", "item", "layout", "items");
        }
        fn others_table(r: &mut Registrar) {
            r.table("other.t", "seal", &[]);
        }
        let one = |register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("c", &[]),
                    register,
                })
                .seal()
                .unwrap_err()
        };
        assert_eq!(one(dotted).code, "bad_operator_name");
        let err = one(others_array);
        assert_eq!(err.code, "not_own_name");
        assert_eq!(err.arrays, ["other.x"]);
        assert_eq!(one(others_table).code, "not_own_name");
    }

    #[test]
    fn a_params_evaluator_is_a_registered_operator_of_a_declared_module() {
        fn with_param(module: &'static str, operator: &'static str) -> Entry {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::Json,
                unit: "",
                default: json!(null),
                min: None,
                max: None,
                minor: 0,
                module,
                operator,
            });
            entry
        }
        fn own_typo(r: &mut Registrar) {
            r.kind(with_param("b", "ownn"), &[], "rect@1");
            r.operator("own", "items", &["self"], &[]);
        }
        fn undeclared(r: &mut Registrar) {
            r.kind(with_param("a", "write_x"), &[], "rect@1");
        }
        fn declared_fine(r: &mut Registrar) {
            r.kind(with_param("a", "write_x"), &[], "rect@1");
        }
        fn nobody(r: &mut Registrar) {
            r.kind(with_param("zz", "op"), &[], "rect@1");
        }
        let seal = |deps: &[(&str, bool)], register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(a())
                .with(Module {
                    manifest: manifest("b", deps),
                    register,
                })
                .seal()
        };
        assert_eq!(seal(&[], own_typo).unwrap_err().code, "unresolved_read");
        assert_eq!(
            seal(&[], undeclared).unwrap_err().code,
            "undeclared_dependency"
        );
        assert!(seal(&[("a", false)], declared_fine).is_ok());
        assert_eq!(seal(&[], nobody).unwrap_err().code, "undeclared_dependency");
        // A missing optional dependency's evaluator is the check's `module_missing`.
        assert!(Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[("a", true)]),
                register: declared_fine,
            })
            .seal()
            .is_ok());
    }

    #[test]
    fn one_operator_writes_an_array_and_a_left_out_operator_blames_the_smallest_module() {
        fn two_ops(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
            r.operator("one", "items", &["self"], &["c.p"]);
            r.operator("two", "items", &["self"], &["c.p"]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: two_ops,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_writers");
        assert_eq!(err.modules, ["c"]);
        assert_eq!(err.arrays, ["c.p"]);
        fn reads_y_then_x(r: &mut Registrar) {
            r.operator("both", "items", &["y.q", "x.p"], &[]);
        }
        fn reads_x_then_y(r: &mut Registrar) {
            r.operator("both", "items", &["x.p", "y.q"], &[]);
        }
        for register in [reads_y_then_x, reads_x_then_y] {
            let sealed = Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("b", &[("x", true), ("y", true)]),
                    register,
                })
                .seal()
                .unwrap();
            assert_eq!(sealed.missing_for("b", "both").as_deref(), Some("x"));
        }
    }

    #[test]
    fn a_kind_or_table_over_a_missing_optional_dependency_is_left_out() {
        fn kind_needs_a(r: &mut Registrar) {
            r.kind(thing(), &["a.x"], "rect@1");
        }
        let sealed = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[("a", true)]),
                register: kind_needs_a,
            })
            .seal()
            .unwrap();
        assert_eq!(sealed.missing_for_kind("b.thing@1").as_deref(), Some("a"));
        let doc = json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [10, 10], "requires": {"modules": {"b": "^1"}},
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                            "order": "a0", "params": {}}}
        });
        let result = crate::document::check_in(&doc, &sealed);
        assert!(result.issues.iter().any(|i| i.code == "module_missing"
            && i.path == "items/x/kind"
            && i.what.contains("the a module")));
        let with_a = Registry::new(BuildSet::Core)
            .with(a())
            .with(Module {
                manifest: manifest("b", &[("a", true)]),
                register: kind_needs_a,
            })
            .seal()
            .unwrap();
        assert_eq!(with_a.missing_for_kind("b.thing@1"), None);
        fn table_over_a(r: &mut Registrar) {
            r.table("b.t", "check", &["a.x"]);
            r.operator("use", "items", &["table:b.t"], &[]);
            r.array("b.y", "f64", "item", "layout", "items");
            r.operator("fill", "items", &["a.x"], &["b.y"]);
            r.table("b.u", "check", &["b.y"]);
            r.operator("use_u", "items", &["table:b.u"], &[]);
        }
        let sealed = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[("a", true)]),
                register: table_over_a,
            })
            .seal()
            .unwrap();
        assert_eq!(sealed.missing_for("b", "use").as_deref(), Some("a"));
        assert_eq!(sealed.missing_for("b", "use_u").as_deref(), Some("a"));
        assert!(sealed
            .plan
            .get("items")
            .is_none_or(|p| modules_only(p).is_empty()));
    }

    #[test]
    fn a_private_array_is_read_by_its_owner_alone_and_stays_out_of_the_digest() {
        fn a_private(r: &mut Registrar) {
            r.private_array("a.secret", "f64", "item", "layout", "items");
            r.operator("fill", "items", &["self"], &["a.secret"]);
        }
        let a_priv = || Module {
            manifest: manifest("a", &[]),
            register: a_private,
        };
        fn table_over_secret(r: &mut Registrar) {
            r.table("c.t", "check", &["a.secret"]);
        }
        fn kind_needs_secret(r: &mut Registrar) {
            r.kind(thing(), &["a.secret"], "rect@1");
        }
        for register in [table_over_secret, kind_needs_secret] {
            let err = Registry::new(BuildSet::Core)
                .with(a_priv())
                .with(Module {
                    manifest: manifest("c", &[("a", false)]),
                    register,
                })
                .seal()
                .unwrap_err();
            assert_eq!(err.code, "private_read");
            assert_eq!(err.modules, ["a", "c"]);
            assert_eq!(err.arrays, ["a.secret"]);
        }
        fn own_p(r: &mut Registrar) {
            r.private_array("c.p", "f64", "item", "layout", "items");
            r.kind(thing(), &["c.p"], "rect@1");
            r.table("c.t", "check", &["c.p"]);
        }
        fn own_q(r: &mut Registrar) {
            r.private_array("c.q", "f64", "item", "layout", "items");
            r.kind(thing(), &["c.q"], "rect@1");
            r.table("c.t", "check", &["c.q"]);
        }
        let digest = |register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("c", &[]),
                    register,
                })
                .seal()
                .unwrap()
                .set_digest
        };
        assert_eq!(digest(own_p), digest(own_q));
        // The operator that evaluates a param is the implementation's own name too.
        fn evaluated_by(operator: &'static str) -> Entry {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::Json,
                unit: "",
                default: json!(null),
                min: None,
                max: None,
                minor: 0,
                module: "c",
                operator,
            });
            entry
        }
        fn op_x(r: &mut Registrar) {
            r.kind(evaluated_by("x"), &[], "rect@1");
            r.operator("x", "items", &["self"], &[]);
        }
        fn op_y(r: &mut Registrar) {
            r.kind(evaluated_by("y"), &[], "rect@1");
            r.operator("y", "items", &["self"], &[]);
        }
        assert_eq!(digest(op_x), digest(op_y));
    }

    #[test]
    fn a_table_is_read_through_a_declared_dependency_like_an_array() {
        fn table_over_a(r: &mut Registrar) {
            r.table("b.t", "check", &["a.x"]);
        }
        fn table_over_as_table(r: &mut Registrar) {
            r.table("b.t", "check", &["table:a.t"]);
        }
        fn operator_over_as_table(r: &mut Registrar) {
            r.operator("use", "items", &["table:a.t"], &[]);
        }
        fn a_with_table(r: &mut Registrar) {
            r.array("a.x", "f32", "item", "params", "items");
            r.table("a.t", "check", &["a.x"]);
        }
        let a_t = || Module {
            manifest: manifest("a", &[]),
            register: a_with_table,
        };
        for register in [table_over_a, table_over_as_table, operator_over_as_table] {
            let err = Registry::new(BuildSet::Core)
                .with(a_t())
                .with(Module {
                    manifest: manifest("b", &[]),
                    register,
                })
                .seal()
                .unwrap_err();
            assert_eq!(err.code, "undeclared_dependency");
            assert_eq!(err.modules, ["a", "b"]);
            assert!(Registry::new(BuildSet::Core)
                .with(a_t())
                .with(Module {
                    manifest: manifest("b", &[("a", false)]),
                    register,
                })
                .seal()
                .is_ok());
        }
    }

    #[test]
    fn a_module_name_has_no_empty_segment_and_no_module_depends_on_itself() {
        for name in [".", "a..b", "test.", ".a"] {
            let err = Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest(name, &[]),
                    register: |_| {},
                })
                .seal()
                .unwrap_err();
            assert_eq!(err.code, "bad_module_name", "{name}");
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("a", &[("a", true)]),
                register: |_| {},
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "cycle");
        assert_eq!(err.modules, ["a"]);
    }

    #[test]
    fn one_module_builds_a_table_and_tables_have_a_build_order() {
        fn builds_t(r: &mut Registrar) {
            r.table("a.b.t", "seal", &[]);
        }
        fn builds_t_too(r: &mut Registrar) {
            r.table("a.b.t", "check", &[]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("a", &[("a.b", false)]),
                register: builds_t,
            })
            .with(Module {
                manifest: manifest("a.b", &[]),
                register: builds_t_too,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_writers");
        assert_eq!(err.modules, ["a", "a.b"]);
        assert_eq!(err.arrays, ["a.b.t"]);
        fn twice(r: &mut Registrar) {
            r.table("c.t", "seal", &[]);
            r.table("c.t", "check", &[]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: twice,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "two_writers");
        fn reads_itself(r: &mut Registrar) {
            r.table("c.t", "seal", &["table:c.t"]);
        }
        fn operator_reads_its_own_write(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
            r.operator("p", "items", &["c.p"], &["c.p"]);
        }
        // Left out or not: the same refusal in the build that lacks its optional dependency.
        fn left_out_reads_its_own_write(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
            r.operator("p", "items", &["a.x", "c.p"], &["c.p"]);
        }
        for (register, deps) in [
            (operator_reads_its_own_write as fn(&mut Registrar), vec![]),
            (left_out_reads_its_own_write, vec![("a", true)]),
        ] {
            let err = Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("c", &deps),
                    register,
                })
                .seal()
                .unwrap_err();
            assert_eq!(err.code, "cycle");
            assert_eq!(err.modules, ["c"]);
            assert_eq!(err.arrays, ["c.p"]);
        }
        fn read_each_other(r: &mut Registrar) {
            r.table("c.t1", "seal", &["table:c.t2"]);
            r.table("c.t2", "seal", &["table:c.t1"]);
            r.table("c.t3", "seal", &["table:c.t1"]);
        }
        for (register, cycle) in [
            (reads_itself as fn(&mut Registrar), vec!["c.t"]),
            (read_each_other, vec!["c.t1", "c.t2"]),
        ] {
            let err = Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("c", &[]),
                    register,
                })
                .seal()
                .unwrap_err();
            assert_eq!(err.code, "cycle");
            assert_eq!(err.modules, ["c"]);
            assert_eq!(err.arrays, cycle);
        }
        fn in_order(r: &mut Registrar) {
            r.table("c.t2", "seal", &["table:c.t1"]);
            r.table("c.t1", "seal", &[]);
        }
        assert!(Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: in_order,
            })
            .seal()
            .is_ok());
    }

    #[test]
    fn a_target_on_a_left_out_param_is_module_missing() {
        fn evaluates_w(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "",
                default: json!(null),
                min: None,
                max: None,
                minor: 0,
                module: "b",
                operator: "x",
            });
            r.kind(entry, &[], "rect@1");
            r.operator("x", "items", &["a.x"], &[]);
        }
        let sealed = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[("a", true)]),
                register: evaluates_w,
            })
            .seal()
            .unwrap();
        let doc = json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [10, 10], "requires": {"modules": {"b": "^1"}},
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                            "order": "a0", "params": {}}},
            "channels": {"c1": {"target": "items/x/params/w"}}
        });
        let result = crate::document::check_in(&doc, &sealed);
        assert!(
            result.issues.iter().any(|i| i.code == "module_missing"
                && i.path == "channels/c1/target"
                && i.what.contains("the a module")),
            "{:?}",
            result
                .issues
                .iter()
                .map(|i| (&i.code, &i.path))
                .collect::<Vec<_>>()
        );
        let mut without = doc.clone();
        without["channels"] = json!({});
        assert!(!crate::document::check_in(&without, &sealed)
            .issues
            .iter()
            .any(|i| i.code == "module_missing"));
    }

    #[test]
    fn a_module_kind_keeps_the_kind_registrys_version_contract() {
        fn with_majors(r: &mut Registrar, majors: &[u32]) {
            let mut entry = thing();
            let one = entry.versions.remove(0);
            entry.versions = majors
                .iter()
                .map(|&major| crate::kinds::Version {
                    major,
                    ..one.clone()
                })
                .collect();
            // One step per consecutive pair, so only the majors are under test.
            entry.migrations = majors
                .windows(2)
                .filter(|w| w[1] == w[0] + 1)
                .map(|w| crate::kinds::Migration {
                    from: w[0],
                    to: w[1],
                    renames: vec![],
                })
                .collect();
            r.kind(entry, &[], "rect@1");
        }
        fn none(r: &mut Registrar) {
            with_majors(r, &[]);
        }
        fn descending(r: &mut Registrar) {
            with_majors(r, &[2, 1]);
        }
        fn twice(r: &mut Registrar) {
            with_majors(r, &[1, 1]);
        }
        fn ascending(r: &mut Registrar) {
            with_majors(r, &[1, 2]);
        }
        let seal = |register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("b", &[]),
                    register,
                })
                .seal()
        };
        fn bare_name(r: &mut Registrar) {
            let mut entry = thing();
            entry.family = "";
            entry.name = "rect";
            r.kind(entry, &[], "rect@1");
        }
        fn f32_param(r: &mut Registrar, default: Value, min: Option<f64>) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "",
                default,
                min,
                max: None,
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        fn default_past_f32(r: &mut Registrar) {
            f32_param(r, json!(1e40), None);
        }
        fn default_below_min(r: &mut Registrar) {
            f32_param(r, json!(-1), Some(0.0));
        }
        fn default_in_range(r: &mut Registrar) {
            f32_param(r, json!(0.5), Some(0.0));
        }
        for register in [
            none,
            descending,
            twice,
            bare_name,
            default_past_f32,
            default_below_min,
        ] {
            let err = seal(register).unwrap_err();
            assert_eq!(err.code, "bad_shape");
            assert_eq!(err.modules, ["b"]);
        }
        for register in [ascending, default_in_range] {
            assert!(seal(register).is_ok());
        }
    }

    #[test]
    fn a_module_kinds_migrations_params_and_box_keep_the_registrys_contract() {
        fn two_majors(migrations: Vec<crate::kinds::Migration>) -> Entry {
            let mut entry = thing();
            let mut two = entry.versions[0].clone();
            two.major = 2;
            two.params.push(crate::kinds::Param {
                name: "width",
                ty: crate::kinds::ParamType::F32,
                unit: "",
                default: json!(1),
                min: None,
                max: None,
                minor: 0,
                module: "",
                operator: "",
            });
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ..two.params[1].clone()
            });
            entry.versions.push(two);
            entry.migrations = migrations;
            entry
        }
        fn step(
            from: u32,
            to: u32,
            renames: &[(&'static str, &'static str)],
        ) -> crate::kinds::Migration {
            crate::kinds::Migration {
                from,
                to,
                renames: renames
                    .iter()
                    .map(|(from, to)| crate::kinds::Rename { from, to })
                    .collect(),
            }
        }
        fn no_path(r: &mut Registrar) {
            r.kind(two_majors(vec![]), &[], "rect@1");
        }
        fn rename_to_nothing(r: &mut Registrar) {
            r.kind(
                two_majors(vec![step(1, 2, &[("w", "nope")])]),
                &[],
                "rect@1",
            );
        }
        fn rename_from_nothing(r: &mut Registrar) {
            r.kind(
                two_majors(vec![step(1, 2, &[("nope", "width")])]),
                &[],
                "rect@1",
            );
        }
        fn twice(r: &mut Registrar) {
            r.kind(
                two_majors(vec![step(1, 2, &[]), step(1, 2, &[])]),
                &[],
                "rect@1",
            );
        }
        fn backwards(r: &mut Registrar) {
            r.kind(
                two_majors(vec![step(1, 2, &[]), step(2, 1, &[])]),
                &[],
                "rect@1",
            );
        }
        fn unknown_major(r: &mut Registrar) {
            r.kind(
                two_majors(vec![step(1, 2, &[]), step(2, 3, &[])]),
                &[],
                "rect@1",
            );
        }
        fn param_twice(r: &mut Registrar) {
            let mut entry = thing();
            let again = entry.versions[0].params[0].clone();
            entry.versions[0].params.push(again);
            r.kind(entry, &[], "rect@1");
        }
        fn rect_without_box(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.clear();
            r.kind(entry, &[], "rect@1");
        }
        fn fine(r: &mut Registrar) {
            r.kind(
                two_majors(vec![step(1, 2, &[("w", "width")])]),
                &[],
                "rect@1",
            );
        }
        fn draws_nothing_without_box(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.clear();
            r.kind(entry, &[], "");
        }
        let seal = |register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("b", &[]),
                    register,
                })
                .seal()
        };
        for register in [
            no_path,
            rename_to_nothing,
            rename_from_nothing,
            twice,
            backwards,
            unknown_major,
            param_twice,
            rect_without_box,
        ] {
            let err = seal(register).unwrap_err();
            assert_eq!(err.code, "bad_shape");
            assert_eq!(err.modules, ["b"]);
        }
        for register in [fine, draws_nothing_without_box] {
            assert!(seal(register).is_ok());
        }
    }

    #[test]
    fn a_typo_in_a_present_modules_array_is_unresolved_not_left_out() {
        fn registers_x(r: &mut Registrar) {
            r.array("a.b.x", "f32", "item", "params", "items");
        }
        fn reads_typo(r: &mut Registrar) {
            r.operator("peek", "items", &["a.b.nothing"], &[]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("a.b", &[]),
                register: registers_x,
            })
            .with(Module {
                manifest: manifest("c", &[("a", true), ("a.b", false)]),
                register: reads_typo,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "unresolved_read");
        assert_eq!(err.arrays, ["a.b.nothing"]);
    }

    #[test]
    fn an_array_name_keeps_the_grammar_and_a_declared_longer_name_owns_its_reads() {
        for bad in ["a..x", "a.X", "a.b.", "a.x y"] {
            let err = Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("a", &[]),
                    register: match bad {
                        "a..x" => |r: &mut Registrar| {
                            r.array("a..x", "f32", "item", "params", "items");
                        },
                        "a.X" => |r: &mut Registrar| {
                            r.array("a.X", "f32", "item", "params", "items");
                        },
                        "a.b." => |r: &mut Registrar| {
                            r.array("a.b.", "f32", "item", "params", "items");
                        },
                        _ => |r: &mut Registrar| {
                            r.array("a.x y", "f32", "item", "params", "items");
                        },
                    },
                })
                .seal()
                .unwrap_err();
            assert_eq!(err.code, "not_own_name", "{bad}");
            assert_eq!(err.arrays, [bad]);
        }
        // `a.b` is known through `n`'s manifest, so `a.b.x` is never `a`'s to be missing.
        fn reads_a_b_x(r: &mut Registrar) {
            r.operator("peek", "items", &["a.b.x"], &[]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("m", &[("a", true)]),
                register: reads_a_b_x,
            })
            .with(Module {
                manifest: manifest("n", &[("a.b", true)]),
                register: |_| {},
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "unresolved_read");
        assert_eq!(err.arrays, ["a.b.x"]);
    }

    #[test]
    fn a_name_between_two_modules_is_the_longer_ones() {
        fn registers_into_sibling(r: &mut Registrar) {
            r.array("a.b.x", "f32", "item", "params", "items");
        }
        for deps in [vec![], vec![("a.b", true)]] {
            let mut registry = Registry::new(BuildSet::Core).with(Module {
                manifest: manifest("a", &deps),
                register: registers_into_sibling,
            });
            if deps.is_empty() {
                registry = registry.with(Module {
                    manifest: manifest("a.b", &[]),
                    register: |_| {},
                });
            }
            let err = registry.seal().unwrap_err();
            assert_eq!(err.code, "not_own_name");
            assert_eq!(err.modules, ["a"]);
            assert_eq!(err.arrays, ["a.b.x"]);
        }
    }

    #[test]
    fn a_seal_built_table_reads_no_array_and_f32_bounds_are_finite_and_ordered() {
        fn seal_over_array(r: &mut Registrar) {
            r.array("c.p", "f64", "item", "layout", "items");
            r.table("c.t", "seal", &["c.p"]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: seal_over_array,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "later_phase");
        assert_eq!(err.arrays, ["c.p"]);
        // A name nothing owns stays `unresolved_read`, whatever the build.
        fn seal_over_nothing(r: &mut Registrar) {
            r.table("c.t", "seal", &["c.nowhere"]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: seal_over_nothing,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "unresolved_read");
        // The same in the build that lacks the array's optional owner: left out is no verdict.
        fn seal_over_missing(r: &mut Registrar) {
            r.table("c.t", "seal", &["a.x"]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[("a", true)]),
                register: seal_over_missing,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "later_phase");
        assert_eq!(err.arrays, ["a.x"]);
        fn nan_bound(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "",
                default: Value::Null,
                min: Some(f64::NAN),
                max: Some(1.0),
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[]),
                register: nan_bound,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "bad_shape");
        fn min_above_max(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "",
                default: Value::Null,
                min: Some(1.0),
                max: Some(0.0),
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[]),
                register: min_above_max,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "bad_shape");
    }

    #[test]
    fn a_seal_built_table_reads_no_check_built_table() {
        fn seal_over_check(r: &mut Registrar) {
            r.table("c.t1", "seal", &["table:c.t2"]);
            r.table("c.t2", "check", &[]);
        }
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: seal_over_check,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "later_phase");
        assert_eq!(err.arrays, ["table:c.t2"]);
        fn check_over_seal(r: &mut Registrar) {
            r.table("c.t1", "check", &["table:c.t2"]);
            r.table("c.t2", "seal", &[]);
        }
        assert!(Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: check_over_seal,
            })
            .seal()
            .is_ok());
    }

    #[test]
    fn a_manifest_may_depend_on_the_cores_own_modules() {
        assert!(Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[("text", false), ("marks2d", false)]),
                register: |_| {},
            })
            .seal()
            .is_ok());
        // A param the core's own module evaluates resolves when the manifest declares it.
        fn text_evaluates(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::Json,
                unit: "",
                default: json!(null),
                min: None,
                max: None,
                minor: 0,
                module: "text",
                operator: "measure",
            });
            r.kind(entry, &[], "rect@1");
        }
        assert!(Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[("text", false)]),
                register: text_evaluates,
            })
            .seal()
            .is_ok());
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: text_evaluates,
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "undeclared_dependency");
        assert_eq!(err.modules, ["c", "text"]);
        let err = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[("vector", false)]),
                register: |_| {},
            })
            .seal()
            .unwrap_err();
        assert_eq!(err.code, "missing_dependency");
    }

    #[test]
    fn a_sealed_sets_canonical_form_counts_its_module_kinds_defaults() {
        fn with_default(r: &mut Registrar) {
            let mut entry = thing();
            entry.versions[0].params.push(crate::kinds::Param {
                name: "w",
                ty: crate::kinds::ParamType::F32,
                unit: "",
                default: json!(2),
                min: None,
                max: None,
                minor: 0,
                module: "",
                operator: "",
            });
            r.kind(entry, &[], "rect@1");
        }
        let sealed = Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("b", &[]),
                register: with_default,
            })
            .seal()
            .unwrap();
        let doc = json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [10, 10], "requires": {"modules": {"b": "^1"}},
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                            "order": "a0", "params": {"w": 2}}}
        });
        let by_set = crate::document::canonical_in(&doc, &sealed.kinds()).unwrap();
        let by_core = crate::document::canonical(&doc).unwrap();
        assert!(!by_set.bytes.contains("\"w\""), "{}", by_set.bytes);
        assert!(by_core.bytes.contains("\"w\""), "{}", by_core.bytes);
        assert_ne!(by_set.sha256, by_core.sha256);
    }

    #[test]
    fn the_cores_own_modules_leave_no_param_missing() {
        let sealed = core();
        assert_eq!(sealed.missing_for("motion", "ease"), None);
        assert_eq!(sealed.missing_for("logic", "run").as_deref(), Some("logic"));
    }

    #[test]
    fn a_kind_family_of_an_absent_known_module_is_missing() {
        let sealed = Registry::new(BuildSet::Core).seal().unwrap();
        assert_eq!(
            sealed.missing_for_kind("logic.program@1").as_deref(),
            Some("logic")
        );
        assert_eq!(sealed.missing_for_kind("test.slab@3"), None);
        let with_b = Registry::new(BuildSet::Core).with(b(true)).seal().unwrap();
        assert_eq!(with_b.missing_for_kind("b.thing@1"), None);
    }

    #[test]
    fn a_kind_draws_as_its_core_kind_at_a_major_the_module_carries() {
        let with_b = Registry::new(BuildSet::Core).with(b(true)).seal().unwrap();
        assert_eq!(with_b.draws_as("b.thing@1"), Some("rect@1"));
        assert_eq!(with_b.draws_as("b.thing@0"), None);
        assert_eq!(with_b.draws_as("b.thing@2"), None);
        assert_eq!(with_b.draws_as("b.thing"), None);
        assert_eq!(with_b.module_of_kind("b.thing"), Some("b"));
        assert_eq!(with_b.module_of_kind("rect"), None);
    }

    #[test]
    fn domains_table_builds_carried_kinds_and_table_reads_are_checked() {
        let one = |register: fn(&mut Registrar)| {
            Registry::new(BuildSet::Core)
                .with(Module {
                    manifest: manifest("c", &[]),
                    register,
                })
                .seal()
                .unwrap_err()
        };
        fn bad_domain(r: &mut Registrar) {
            r.array("c.p", "f64", "nowhere", "layout", "items");
        }
        fn bad_build(r: &mut Registrar) {
            r.table("c.t", "never", &[]);
        }
        fn bad_carried(r: &mut Registrar) {
            r.carried("blob", "c.k", 1);
        }
        fn bad_table_read(r: &mut Registrar) {
            r.table("c.t", "check", &["c.nowhere"]);
        }
        assert_eq!(one(bad_domain).code, "illegal_domain");
        assert_eq!(one(bad_build).code, "illegal_table_build");
        assert_eq!(one(bad_carried).code, "illegal_carried");
        let err = one(bad_table_read);
        assert_eq!(err.code, "unresolved_read");
        assert_eq!(err.arrays, ["c.nowhere"]);
        fn fine(r: &mut Registrar) {
            r.array("c.p", "f64", "row", "layout", "items");
            r.table("c.t", "check", &["c.p", "self"]);
            r.carried("tail", "c.k", 1);
        }
        assert!(Registry::new(BuildSet::Core)
            .with(Module {
                manifest: manifest("c", &[]),
                register: fine,
            })
            .seal()
            .is_ok());
    }

    #[test]
    fn a_document_names_the_module_of_every_module_kind_it_uses() {
        let with_b = Registry::new(BuildSet::Core).with(b(true)).seal().unwrap();
        let mut doc = json!({
            "format": 1, "id": "doc-1", "profile": "figure", "title": "T", "description": "D",
            "size": [10, 10],
            "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {"x": {"id": "x", "kind": "b.thing@1", "layer": "main", "name": "X",
                            "order": "a0", "params": {}}}
        });
        let result = crate::document::check_in(&doc, &with_b);
        assert!(!result.ok);
        assert!(result.issues.iter().any(|i| i.code == "out_of_range"
            && i.path == "items/x/kind"
            && i.what.contains("`b`")));
        doc["requires"] = json!({"modules": {"b": "^1"}});
        let result = crate::document::check_in(&doc, &with_b);
        assert!(result.ok, "{:?}", result.issues);
        // Malformed kind text is out of range, never a missing module.
        doc["items"]["x"]["kind"] = json!("logic");
        let result = crate::document::check_in(&doc, &with_b);
        assert!(result
            .issues
            .iter()
            .any(|i| i.code == "out_of_range" && i.path == "items/x/kind"));
        assert!(!result.issues.iter().any(|i| i.code == "module_missing"));
    }
}
