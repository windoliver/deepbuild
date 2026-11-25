//! The one cap on what a document's check expands (Recipe: cost; issue #1857): derived items
//! across every instance and nesting level, and the elements of every param's `{repeat}` list,
//! counted before the step or list that makes them allocates.

use super::expand::expand_one;
use super::*;

/// The most one document's check expands.
pub(super) const MAX_EXPANDED: u64 = 65_536;

/// What one document's check has expanded so far.
#[derive(Clone, Default)]
pub(super) struct Spent {
    count: u64,
    /// The count the step or list that passed the cap would have reached.
    over: Option<u64>,
    /// The inputs that step's count read, of the recipe the refusal is unwinding through.
    reads: Vec<String>,
    /// Counting ahead: every step is counted and only nested instances are made.
    pub(super) ahead: bool,
    /// Planted: the count refuses nothing until everything is expanded.
    after: bool,
}

impl Spent {
    pub(super) fn of(planted: Planted) -> Spent {
        Spent {
            after: planted.counts_after_expanding,
            ..Spent::default()
        }
    }

    /// Counts `n` more before they are made, or says why they can't be.
    pub(super) fn take(&mut self, n: u64) -> Result<(), String> {
        let reach = self.count + n;
        if reach > MAX_EXPANDED && !self.after {
            self.over = Some(reach);
            return Err(format!(
                "the document's check would expand to {reach} derived items and list elements, past the cap of {MAX_EXPANDED}"
            ));
        }
        self.count = reach;
        Ok(())
    }

    /// [`Spent::take`] for the items `step` of `recipe` makes; a refusal keeps the inputs the
    /// step's count read.
    pub(super) fn step(&mut self, recipe: &Recipe, step: &Step, n: u64) -> Result<(), String> {
        self.take(n).inspect_err(|_| {
            let along = step.along.iter().flat_map(|(path, spacing)| {
                let spacing = spacing.iter().flat_map(Template::names);
                path.names().into_iter().chain(spacing)
            });
            let count = step.repeat.iter().flat_map(|(count, _)| count.names());
            let names = count
                .chain(step.over.iter().flat_map(Template::names))
                .chain(along)
                .chain(step.each.iter().map(|e| e.input.clone()));
            self.reads = inputs_of(recipe, names.collect());
        })
    }

    /// A refusal in an instance `step` of `recipe` nests: the inputs of `recipe` the refused
    /// count read through the step's params.
    pub(super) fn lift(&mut self, recipe: &Recipe, step: &Step) {
        let set = step.params.iter().filter(|(k, _)| self.reads.contains(k));
        self.reads = inputs_of(recipe, set.flat_map(|(_, t)| t.names()).collect());
    }

    /// Planted: the count read once everything is expanded.
    pub(super) fn settle(&self, issues: &mut Vec<Issue>) {
        if self.after && self.count > MAX_EXPANDED {
            let what = format!("expanded past the cap of {MAX_EXPANDED}");
            issues.push(Issue::envelope(
                "over_budget",
                "items".into(),
                json!(self.count),
                &what,
            ));
        }
    }
}

/// The inputs of `recipe` among `names`, and those its lets among them read.
fn inputs_of(recipe: &Recipe, mut names: Vec<String>) -> Vec<String> {
    let mut out = BTreeSet::new();
    let mut seen = BTreeSet::new();
    while let Some(name) = names.pop() {
        if recipe.inputs.contains_key(&name) {
            out.insert(name);
        } else if let Some((_, t)) = recipe.lets.iter().find(|(k, _)| *k == name) {
            if seen.insert(name) {
                names.extend(t.names());
            }
        }
    }
    out.into_iter().collect()
}

/// One instance of the document, expanded within the document's count. A recipe that nests is
/// counted whole first, with nothing but its nested instances made, so a chain past the cap is
/// refused before its first item is; the refusal is `over_budget`, naming the instance, the step
/// or param path, the count it would reach, the cap and the instance's inputs that count read.
#[allow(clippy::too_many_arguments)]
pub(super) fn expand_counted(
    items: &mut Map<String, Value>,
    id: &str,
    (pack, recipe): (&Pack, &Recipe),
    resolved: &Resolved<'_>,
    planted: Planted,
    order: &mut u64,
    spent: &mut Spent,
    issues: &mut Vec<Issue>,
) -> Option<Expansion> {
    let item = items.get(id)?.clone();
    let chain = std::slice::from_ref(&recipe.id);
    let (from, before) = (issues.len(), spent.count);
    let mut ahead = Spent {
        ahead: true,
        ..spent.clone()
    };
    if !spent.after && recipe.steps.iter().any(|s| s.op == "recipe") {
        let (mut found, mut ordered) = (Vec::new(), *order);
        let _ = expand_one(
            items,
            id,
            item.clone(),
            (pack, recipe),
            resolved,
            chain,
            planted,
            &mut ordered,
            &mut found,
            &mut ahead,
        );
        // Only the cap's refusal counts: any other is the expansion's own to find, below.
        issues.extend(found.pop().filter(|_| ahead.over.is_some()));
    }
    let out = match ahead.over {
        Some(_) => None,
        None => expand_one(
            items,
            id,
            item,
            (pack, recipe),
            resolved,
            chain,
            planted,
            order,
            issues,
            spent,
        ),
    };
    if out.is_none() {
        // A refused instance writes nothing, so it counts for nothing.
        spent.count = before;
        let over = ahead.over.or(spent.over.take());
        let reads = std::mem::take(if ahead.over.is_some() {
            &mut ahead.reads
        } else {
            &mut spent.reads
        });
        if let (Some(reach), Some(issue)) = (over, issues[from..].last_mut()) {
            issue.code = "over_budget";
            issue.actual = json!(reach);
            if issue.ids.first().map(String::as_str) != Some(id) {
                issue.ids.insert(0, id.to_string());
            }
            if !reads.is_empty() {
                issue.what = format!(
                    "{}; the count reads `{}` of `{id}`",
                    issue.what,
                    reads.join("`, `")
                );
            }
            issue.fix = format!(
                "Lower the counts, so the document expands to at most {MAX_EXPANDED} derived items and list elements."
            );
        }
    }
    out
}

impl Template {
    /// [`Template::eval`] within one document's check: the elements of each `{repeat}` list are
    /// counted against `spent` before the list is made.
    pub(super) fn eval_in(
        &self,
        scope: &[(String, Value)],
        spent: &mut Spent,
    ) -> Result<Value, String> {
        match &self.form {
            Form::Expr(Expr::Name(name)) if !scope.iter().any(|(k, _)| k == name) => {
                Ok(self.source.clone())
            }
            Form::Expr(expr) => expr.value(scope),
            Form::Literal => Ok(self.source.clone()),
            Form::Refused(e) => Err(e.clone()),
            Form::List(list) => list
                .iter()
                .map(|t| t.eval_in(scope, spent))
                .collect::<Result<Vec<_>, _>>()
                .map(Value::Array),
            Form::Map(map) => {
                let mut out = Map::new();
                for (k, t) in map {
                    out.insert(k.clone(), t.eval_in(scope, spent)?);
                }
                Ok(Value::Object(out))
            }
            Form::Repeat(r) => {
                let elements: Vec<Value> = match (&r.count, &r.over) {
                    (Some(c), _) => {
                        let n = c.eval(scope)?;
                        if !(0.0..=MAX_REPEAT as f64).contains(&n) || n.fract() != 0.0 {
                            return Err(format!("a repeat counts 0 to {MAX_REPEAT}, not {n}"));
                        }
                        spent.take(n as u64)?;
                        (0..n as u64).map(|i| json!(i)).collect()
                    }
                    (_, Some(o)) => match o.value(scope)? {
                        Value::Array(a) if a.len() as u64 <= MAX_REPEAT => {
                            spent.take(a.len() as u64)?;
                            a
                        }
                        other => {
                            return Err(format!(
                                "a repeat is over a list of at most {MAX_REPEAT}, not {other}"
                            ))
                        }
                    },
                    _ => Vec::new(),
                };
                let mut inner = scope.to_vec();
                let base = inner.len();
                let mut out = Vec::with_capacity(elements.len());
                for (i, e) in elements.into_iter().enumerate() {
                    inner.truncate(base);
                    inner.push(("i".into(), json!(i)));
                    inner.push((r.as_.clone(), e));
                    for (name, l) in &r.lets {
                        let v = l.value(&inner)?;
                        inner.push((name.clone(), v));
                    }
                    out.push(r.of.eval_in(&inner, spent)?);
                }
                Ok(Value::Array(out))
            }
        }
    }
}
