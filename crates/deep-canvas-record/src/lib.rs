//! Issue #394: salience over one level (canvas primitives: Salience `salience@1`). Items rank by
//! record facts in the rank list's order, each true before false, then priority, highest first,
//! then ID; the level shows the top `show`, lowered to what fits at the minimum readable size but
//! never below the items that need you, and folds the rest into one count item whose sentence is
//! built from counts. The set holds while the level stays open: it changes only on a needs-you or
//! verdict change, and arrivals that would change it wait as "N new". Files show only at the
//! evidence level.

pub mod module;
pub mod zoom;

use serde_json::Value;

/// The record facts salience ranks by, in the rank list's order.
pub const RANK: [&str; 6] = [
    "needs_you",
    "sent_back",
    "failing",
    "lacks_proof",
    "touched",
    "changed",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub id: String,
    /// One flag per entry of `RANK`.
    pub facts: [bool; 6],
    pub priority: i16,
    /// A file, which shows only at the evidence level.
    pub file: bool,
}

/// The level as it was held: the items it showed, in order, and every item's facts then.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hold {
    pub shown: Vec<String>,
    pub items: Vec<Item>,
}

/// How many items a level shows and where it sits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Options {
    /// `show: u8 = 9`.
    pub show: u8,
    /// How many items fit at the minimum readable size, as the view measured.
    pub fits: usize,
    /// The evidence level, the only one that shows files.
    pub evidence: bool,
}

/// An item the level shows: its place in the ranking from 0 and the facts that put it there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shown {
    pub id: String,
    pub rank: u16,
    pub reasons: Vec<&'static str>,
}

impl deep_canvas::schedule::Canonical for Shown {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.id, &self.rank, &self.reasons), out);
    }
}

/// The one count item the rest fold into.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fold {
    pub items: Vec<String>,
    pub line: String,
}

impl deep_canvas::schedule::Canonical for Fold {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.items, &self.line), out);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Level {
    pub shown: Vec<Shown>,
    pub fold: Option<Fold>,
    /// Arrivals that would change a held set, waiting until the next hold.
    pub new: usize,
}

impl deep_canvas::schedule::Canonical for Level {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.shown, &self.fold, &self.new), out);
    }
}

fn reasons(item: &Item) -> Vec<&'static str> {
    let mut keys: Vec<&'static str> = RANK
        .iter()
        .zip(item.facts)
        .filter_map(|(&k, on)| on.then_some(k))
        .collect();
    if item.priority > 0 {
        keys.push("priority");
    }
    keys
}

/// What one folded item counts as in the fold's sentence: its first fact, or unchanged.
fn phrase(item: &Item) -> usize {
    item.facts[1..]
        .iter()
        .position(|&on| on)
        .unwrap_or(RANK.len() - 1)
}

const PHRASES: [(&str, &str); 6] = [
    ("sent back", "sent back"),
    ("fails", "failing"),
    ("lacks proof", "lack proof"),
    ("touched by this work", "touched by this work"),
    ("changed since you looked", "changed since you looked"),
    ("unchanged", "unchanged"),
];

/// "N more: 2 lack proof, 12 unchanged", the counts in the rank list's order.
fn sentence(folded: &[&Item]) -> String {
    let mut counts = [0usize; 6];
    for item in folded {
        counts[phrase(item)] += 1;
    }
    let parts: Vec<String> = counts
        .iter()
        .zip(PHRASES)
        .filter(|(&n, _)| n > 0)
        .map(|(&n, (one, many))| format!("{n} {}", if n == 1 { one } else { many }))
        .collect();
    format!("{} more: {}", folded.len(), parts.join(", "))
}

/// The facts a verdict sets: sent back, failing, lacks proof.
const VERDICT: std::ops::Range<usize> = 1..4;

/// Whether the held set must change: an item's needs-you or verdict facts differ from the hold's,
/// or an item that wasn't there needs you.
fn changed(items: &[&Item], hold: &Hold) -> bool {
    items
        .iter()
        .any(|item| match hold.items.iter().find(|h| h.id == item.id) {
            Some(was) => was.facts[0] != item.facts[0] || was.facts[VERDICT] != item.facts[VERDICT],
            None => item.facts[0],
        })
}

/// The level: `show` items, lowered to `fits`, never below those that need you; the rest folded.
/// With a hold and no needs-you or verdict change since it, the held items keep their places.
pub fn level(items: &[Item], options: &Options, hold: Option<&Hold>) -> Level {
    let mut ranked: Vec<&Item> = items
        .iter()
        .filter(|i| options.evidence || !i.file)
        .collect();
    ranked.sort_by(|p, q| {
        let flags = |i: &Item| i.facts.map(|on| !on);
        (flags(p), -i32::from(p.priority), &p.id).cmp(&(flags(q), -i32::from(q.priority), &q.id))
    });
    let needs_you = ranked.iter().filter(|i| i.facts[0]).count();
    let count = usize::from(options.show)
        .min(options.fits)
        .max(needs_you)
        .min(ranked.len());
    let (top, new) = match hold.filter(|h| !changed(&ranked, h)) {
        None => (ranked[..count].to_vec(), 0),
        Some(hold) => {
            let kept: Vec<&Item> = hold
                .shown
                .iter()
                .filter_map(|id| ranked.iter().find(|i| &i.id == id).copied())
                .collect();
            let new = ranked[..count]
                .iter()
                .filter(|i| !kept.iter().any(|k| k.id == i.id))
                .count();
            (kept, new)
        }
    };
    let shown = top
        .iter()
        .enumerate()
        .map(|(rank, item)| Shown {
            id: item.id.clone(),
            rank: u16::try_from(rank).unwrap_or(u16::MAX),
            reasons: reasons(item),
        })
        .collect();
    let rest: Vec<&Item> = ranked
        .into_iter()
        .filter(|i| !top.iter().any(|t| t.id == i.id))
        .collect();
    let fold = (!rest.is_empty()).then(|| Fold {
        items: rest.iter().map(|i| i.id.clone()).collect(),
        line: sentence(&rest),
    });
    Level { shown, fold, new }
}

/// Reads `{id, facts: {needs_you, sent_back, failing, lacks_proof, touched, changed}, priority?,
/// file?}`.
pub fn item(value: &Value) -> Option<Item> {
    let id = value
        .get("id")?
        .as_str()
        .filter(|s| !s.is_empty())?
        .to_string();
    let facts = value.get("facts")?;
    let mut flags = [false; 6];
    for (flag, key) in flags.iter_mut().zip(RANK) {
        *flag = facts.get(key)?.as_bool()?;
    }
    let priority = match facts.get("priority") {
        None => 0,
        Some(p) => i16::try_from(p.as_i64()?).ok()?,
    };
    let file = match value.get("file") {
        None => false,
        Some(f) => f.as_bool()?,
    };
    Some(Item {
        id,
        facts: flags,
        priority,
        file,
    })
}
