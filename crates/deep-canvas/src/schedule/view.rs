//! An operator's typed view of its read set (Operator and read set: "the core builds an
//! operator's inputs from its reads, so nothing undeclared is reachable"). Every accessor names
//! the read term it needs; one the operator didn't declare is refused with `undeclared_read`,
//! and in a test build every read, refused or not, is logged.

use std::any::Any;
use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::Value;

use super::{Access, Bound, Loaded, Node, OpError, Outside, Session, Tokens, Val, VIEW_INPUTS};
use crate::registry::{Sealed, SealedOp, TableValue};

/// What a step reads beside the view: its time, the stepping arrays as they stand, and as
/// earlier steps left them before this time.
pub(super) struct StepCtx<'a> {
    pub time: i64,
    pub current: &'a BTreeMap<String, Val>,
    pub earlier: &'a BTreeMap<String, Val>,
}

pub struct View<'a> {
    session: &'a Session,
    sealed: &'a Sealed,
    l: &'a Loaded,
    node: &'a Node,
    sop: &'a SealedOp,
    tables: BTreeMap<String, TableValue>,
    log: bool,
    access: Vec<Access>,
    out: Vec<Val>,
    step: Option<StepCtx<'a>>,
    /// What a step noted for the log: its count and the other count it read.
    noted: Option<(i64, i64)>,
}

impl<'a> View<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        session: &'a Session,
        sealed: &'a Sealed,
        l: &'a Loaded,
        node: &'a Node,
        tables: BTreeMap<String, TableValue>,
        log: bool,
        step: Option<StepCtx<'a>>,
    ) -> View<'a> {
        let sop = &sealed.ops[node.op];
        View {
            session,
            sealed,
            l,
            node,
            sop,
            tables,
            log,
            access: Vec::new(),
            out: vec![Val::None; sop.op.writes.len()],
            step,
            noted: None,
        }
    }

    /// What the operator wrote, in its writes' order, every read it made, and what a step
    /// noted.
    pub(super) fn finish(self) -> (Vec<Val>, Vec<Access>, Option<(i64, i64)>) {
        (self.out, self.access, self.noted)
    }

    fn note(&mut self, read: &str) {
        if self.log {
            self.access.push(Access {
                operator: self.sop.key.clone(),
                item: self.id().map(str::to_string),
                read: read.to_string(),
            });
        }
    }

    /// The read term's place in the declared reads, or `undeclared_read`.
    fn declared(&mut self, term: &str) -> Result<usize, OpError> {
        self.note(term);
        match self.sop.op.reads.iter().position(|r| r == term) {
            Some(k) => Ok(k),
            None => Err(OpError {
                code: "undeclared_read",
                path: self.path(),
                read: Some(term.to_string()),
            }),
        }
    }

    /// The node's item as a path (`items/<id>`), or empty per document.
    pub fn path(&self) -> String {
        match self.id() {
            Some(id) => format!("items/{id}"),
            None => String::new(),
        }
    }

    /// The node's item ID, or `None` per document: the node's own identity, not a read.
    pub fn id(&self) -> Option<&'a str> {
        self.node.item.map(|i| self.l.items[i].id.as_str())
    }

    /// The operator's canvas module.
    pub fn module(&self) -> &str {
        &self.sop.module
    }

    /// The core kind this build draws a canvas module's kind as, when its module registered
    /// one: the build's kinds, not a read of the document.
    pub fn draws_as(&self, kind: &str) -> Option<&'a str> {
        self.sealed.draws_as(kind)
    }

    /// The `rect@1` params a canvas module's kind draws as, when it registered a drawing: the
    /// build's kinds, not a read.
    pub fn draw_of(&self, kind: &str) -> Option<crate::registry::DrawFn> {
        self.sealed.draw_of(kind)
    }

    /// A module's item saved one or more majors back, migrated: the build's kinds again.
    pub fn migrated(&self, item: &Value) -> Option<Value> {
        self.sealed.migrated(item)
    }

    /// Whether a sealed canvas module registered this kind: the build's kinds again.
    pub fn is_module_kind(&self, kind: &str) -> bool {
        crate::kinds::parse_kind(kind)
            .is_some_and(|(full, _)| self.sealed.module_of_kind(&full).is_some())
    }

    /// `self`: the item, or per document the document.
    pub fn item(&mut self) -> Result<&'a Value, OpError> {
        self.declared("self")?;
        let source = self.source();
        Ok(match (self.node.item, source) {
            (Some(i), Some(src)) => src.items[i].as_ref(),
            (Some(i), None) => self.l.items[i].value.as_ref(),
            (None, Some(src)) => src.doc.as_ref(),
            (None, None) => self.l.doc.as_ref(),
        })
    }

    /// `refs`: the document the item belongs to, every section of it.
    pub fn document(&mut self) -> Result<&'a Value, OpError> {
        self.declared("refs")?;
        Ok(match self.source() {
            Some(src) => src.doc.as_ref(),
            None => self.l.doc.as_ref(),
        })
    }

    /// What this node reads instead of its item and document, under a source perturbation of
    /// an array its operator writes.
    fn source(&self) -> Option<&'a super::Source> {
        self.session
            .source
            .as_ref()
            .filter(|src| src.op == self.node.op)
    }

    /// A node's value of `array`, or `input_failed` when its writer failed.
    fn output(&self, node: &Node, array: &str) -> Result<Val, OpError> {
        if let Some(e) = &node.err {
            return Err(OpError::new("input_failed", e.path.clone()));
        }
        let k = self.sealed.ops[node.op]
            .op
            .writes
            .iter()
            .position(|w| w == array)
            .unwrap_or(0);
        Ok(node.out.get(k).cloned().unwrap_or(Val::None))
    }

    /// The array read at `k` on `item`, with every contribution for that item folded in, in
    /// phase then canvas-module order; `None` where nothing wrote it.
    fn folded(&mut self, k: usize, item: Option<usize>) -> Result<Option<Val>, OpError> {
        let Bound::Array {
            name,
            writers,
            contributions,
        } = &self.node.reads[k]
        else {
            return Ok(None);
        };
        let Some(w) = writers.iter().copied().find(|w| {
            let wi = self.l.nodes[*w].item;
            wi == item || wi.is_none()
        }) else {
            return Ok(None);
        };
        let mut val = self.output(&self.l.nodes[w], name)?;
        let mut folded: Option<Value> = None;
        for (c, cn) in contributions {
            let cnode = &self.l.nodes[*cn];
            if cnode.item != item {
                continue;
            }
            self.note(c);
            if let Val::Json(edits) = self.output(cnode, c)? {
                let base = folded.get_or_insert_with(|| match &val {
                    Val::Json(v) => (**v).clone(),
                    _ => Value::Null,
                });
                apply_edits(base, &edits);
            }
        }
        if let Some(v) = folded {
            val = Val::json(v);
        }
        Ok(Some(val))
    }

    /// An array the operator declared, on its item (or per document, the document's), with
    /// its contributions folded in; `None` where nothing wrote it for this item. In a step, a
    /// stepping array as it stands at the step's time.
    pub fn array(&mut self, name: &str) -> Result<Option<Val>, OpError> {
        let k = self.declared(name)?;
        if let Some(step) = &self.step {
            if let Some(v) = step.current.get(name) {
                return Ok(Some(v.clone()));
            }
        }
        self.folded(k, self.node.item)
    }

    /// An array the operator declared, as JSON; `None` where nothing wrote it.
    pub fn json(&mut self, name: &str) -> Result<Option<Arc<Value>>, OpError> {
        Ok(match self.array(name)? {
            Some(Val::Json(v)) => Some(v),
            _ => None,
        })
    }

    /// A typed array the operator declared; `None` where nothing wrote it.
    pub fn typed<T: Any + Send + Sync>(&mut self, name: &str) -> Result<Option<Arc<T>>, OpError> {
        Ok(match self.array(name)? {
            Some(Val::Any(v, _)) => v.downcast::<T>().ok(),
            _ => None,
        })
    }

    /// Per document: an item array the operator declared, on every item that has it, in ID
    /// order, each with its contributions folded in.
    pub fn every(&mut self, name: &str) -> Result<Vec<(&'a str, Val)>, OpError> {
        let k = self.declared(name)?;
        let Bound::Array { writers, .. } = &self.node.reads[k] else {
            return Ok(Vec::new());
        };
        let items: Vec<Option<usize>> = writers.iter().map(|w| self.l.nodes[*w].item).collect();
        let mut out = Vec::new();
        for item in items {
            let Some(i) = item else { continue };
            if let Some(v) = self.folded(k, Some(i))? {
                out.push((self.l.items[i].id.as_str(), v));
            }
        }
        Ok(out)
    }

    /// `parent`: on the item's parent, what this operator wrote there to `own`, one of its
    /// writes; `None` for an item without a parent.
    pub fn parent(&mut self, own: &str) -> Result<Option<Val>, OpError> {
        let k = self.declared("parent")?;
        if !self.sop.op.writes.iter().any(|w| w == own) {
            return Err(OpError {
                code: "undeclared_read",
                path: self.path(),
                read: Some(format!("parent:{own}")),
            });
        }
        match &self.node.reads[k] {
            Bound::Parent(Some(p)) => Ok(Some(self.output(&self.l.nodes[*p], own)?)),
            _ => Ok(None),
        }
    }

    /// `t`: the time in flicks; in a step, the step's time.
    pub fn t(&mut self) -> Result<i64, OpError> {
        if let Some(step) = &self.step {
            return Ok(step.time);
        }
        self.declared("t")?;
        Ok(self.session.t)
    }

    /// `view(<input>)`: one of the six view inputs.
    pub fn view(&mut self, input: &str) -> Result<&'a Value, OpError> {
        self.declared(&format!("view({input})"))?;
        let k = VIEW_INPUTS.iter().position(|v| *v == input).unwrap_or(0);
        Ok(&self.session.view[k])
    }

    /// `view(locale)`, as a BCP 47 tag.
    pub fn locale(&mut self) -> Result<&'a str, OpError> {
        Ok(self.view("locale")?.as_str().unwrap_or("en"))
    }

    /// `view(reduced_motion)`.
    pub fn reduced_motion(&mut self) -> Result<bool, OpError> {
        Ok(self.view("reduced_motion")?.as_bool().unwrap_or(false))
    }

    /// `look`: the look's tokens.
    pub fn look(&mut self) -> Result<&'a Tokens, OpError> {
        self.declared("look")?;
        Ok(&self.session.look)
    }

    /// `seed`: the document's seed.
    pub fn seed(&mut self) -> Result<&'a Value, OpError> {
        self.declared("seed")?;
        Ok(&self.l.seed)
    }

    /// `reading`: the data from outside the document the session holds.
    pub fn outside(&mut self) -> Result<&'a Outside, OpError> {
        self.declared("reading")?;
        Ok(&self.session.outside)
    }

    /// `table:<name>`: a table's value.
    pub fn table<T: Any + Send + Sync>(&mut self, name: &str) -> Result<Arc<T>, OpError> {
        self.declared(&format!("table:{name}"))?;
        self.tables
            .get(name)
            .cloned()
            .and_then(|v| v.downcast::<T>().ok())
            .ok_or_else(|| OpError::new("table_missing", name))
    }

    /// `earlier(<array>)`: in a step, the array as earlier steps left it before this time.
    pub fn earlier(&mut self, name: &str) -> Result<Option<Val>, OpError> {
        self.declared(&format!("earlier({name})"))?;
        Ok(self
            .step
            .as_ref()
            .and_then(|s| s.earlier.get(name).cloned()))
    }

    /// In a step, what this operator's own array held after its last step: its carried state.
    pub fn carried(&self, own: &str) -> Option<Val> {
        let step = self.step.as_ref()?;
        if !self.sop.op.writes.iter().any(|w| w == own) {
            return None;
        }
        step.current.get(own).cloned()
    }

    /// In a step, what the step log shows of it: its count and the other count it read.
    pub fn note_step(&mut self, count: i64, read: i64) {
        self.noted = Some((count, read));
    }

    /// Writes one of the operator's own arrays.
    pub fn write(&mut self, name: &str, value: Val) -> Result<(), OpError> {
        match self.sop.op.writes.iter().position(|w| w == name) {
            Some(k) => {
                self.out[k] = value;
                Ok(())
            }
            None => Err(OpError::new("not_own_array", name)),
        }
    }
}

/// Applies a contribution's edits to the owner's value: each `{op: set | add, path, value}`,
/// a `set` writing the value at the path and an `add` adding numbers (element by element for
/// an array) there.
pub fn apply_edits(base: &mut Value, edits: &Value) {
    let Some(list) = edits.as_array() else {
        return;
    };
    for e in list {
        let path: Vec<String> = e
            .get("path")
            .and_then(Value::as_array)
            .map(|p| {
                p.iter()
                    .map(|s| match s {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let value = e.get("value").cloned().unwrap_or(Value::Null);
        let add = e.get("op").and_then(Value::as_str) == Some("add");
        let slot = slot_at(base, &path);
        if add {
            add_into(slot, &value);
        } else {
            *slot = value;
        }
    }
}

/// The value at `path` inside `base`, made where missing.
fn slot_at<'v>(base: &'v mut Value, path: &[String]) -> &'v mut Value {
    let mut at = base;
    for step in path {
        let index = step
            .parse::<usize>()
            .ok()
            .filter(|i| at.as_array().is_some_and(|list| *i < list.len()));
        if let Some(i) = index {
            at = &mut at.as_array_mut().expect("an array")[i];
            continue;
        }
        if !at.is_object() {
            *at = Value::Object(serde_json::Map::new());
        }
        at = at
            .as_object_mut()
            .expect("made an object")
            .entry(step.clone())
            .or_insert(Value::Null);
    }
    at
}

fn add_into(slot: &mut Value, value: &Value) {
    match (slot, value) {
        (Value::Array(xs), Value::Array(ys)) => {
            for (x, y) in xs.iter_mut().zip(ys) {
                add_into(x, y);
            }
        }
        (slot, value) => {
            let sum = slot.as_f64().unwrap_or(0.0) + value.as_f64().unwrap_or(0.0);
            *slot = serde_json::json!(sum);
        }
    }
}
