//! Mirror reads (canvas primitives: Logic: mirror reads; #213): a whole copy of another logic
//! item's array in the reader's memory, updated before each of the reader's steps with only the
//! element ranges its writer changed since the reader's last step, as the bake keeps them. Each
//! mirror's range list sits in the read region after everything `reads` names, in `mirrors`
//! order: a u32 count and up to 256 `{first: u32, count: u32}`, or the count 0xFFFFFFFF when more
//! were pending and the whole array was copied. The pending ranges are the reader's state, kept in
//! its checkpoints, so a seek gives the next step the same mirror and the same list as play.

use serde_json::{json, Value};

use crate::bake::Range;
use crate::piece::{
    align8, clash, global_at, h64, refusal, Item, Piece, Read, Region, Write, PAGE,
};
use crate::world::Live;

/// The most ranges a list holds; more pending become one whole copy.
pub const RANGES: usize = 256;
/// A list's bytes in the read region: a u32 count, then [`RANGES`] × `{first: u32, count: u32}`.
pub const LIST: u32 = 4 + 8 * RANGES as u32;
/// The count that marks a whole copy.
pub const WHOLE: u32 = u32::MAX;

/// A checked mirror.
#[derive(Clone, Debug)]
pub struct Mirror {
    /// The array path, `<logic ID>.<name>`, and the global naming where the copy sits.
    pub array: String,
    pub global: String,
    /// The writer's index in the piece, the write's index in its `writes`, and the array's offset
    /// in the writer's write region.
    pub item: usize,
    pub write: u32,
    pub offset: u32,
    /// Bytes an element takes, and the elements.
    pub elem: u32,
    pub count: u32,
    /// Where the copy sits in the reader's memory.
    pub at: u32,
}

impl Mirror {
    pub fn size(&self) -> u32 {
        self.elem * self.count
    }
}

/// Element runs `[first, end)` the writer changed since the reader's last step, ascending and
/// merged; None: the whole array.
pub type Pending = Option<Vec<[u32; 2]>>;

/// A writer's changed runs for each mirror of them: (reader, mirror, run), held until the group of
/// items stepping at one time ends, since each of them reads the others' earlier steps.
pub type Held = Vec<(usize, usize, [u32; 2])>;

/// The `mirrors` an item declares: `[{array, at}]`, at most 16.
pub(crate) fn declared(v: Option<&Value>) -> Result<Vec<(String, String)>, String> {
    let Some(v) = v else { return Ok(Vec::new()) };
    let list = v.as_array().ok_or("mirrors is a list of {array, at}")?;
    if list.len() > 16 {
        return Err(format!("mirrors lists {} arrays, past 16", list.len()));
    }
    list.iter()
        .map(|m| {
            let s = |k: &str| m.get(k).and_then(Value::as_str).map(str::to_string);
            Some((s("array")?, s("at")?))
        })
        .collect::<Option<_>>()
        .ok_or_else(|| "each mirror is {array: an array path, at: a global's name}".into())
}

/// Each declared mirror of item `own`, resolved against the arrays each item writes; a refusal,
/// naming the mirror, for one no other logic item writes.
pub(crate) fn resolved(
    declared: &[(String, String)],
    own: usize,
    writers: &[(&str, &[Write])],
    refused: &mut Vec<Value>,
) -> Vec<Mirror> {
    let mut out = Vec::new();
    for (array, global) in declared {
        let no = |what: String| refusal("mirrors", what, json!({"mirror": array}));
        let found = array.split_once('.').and_then(|(id, name)| {
            let i = writers.iter().position(|(w, _)| *w == id)?;
            let mut off = 0;
            for (n, w) in writers[i].1.iter().enumerate() {
                if w.name == name {
                    return Some((i, n as u32, off, w.ty.size(), w.count));
                }
                off = align8(off + w.ty.size() * w.count);
            }
            None
        });
        match found {
            None => refused.push(no(format!(
                "{array}: no logic item of this piece writes it; a mirror copies another logic item's array"
            ))),
            Some((i, ..)) if i == own => refused.push(no(format!(
                "{array} is this item's own array; a mirror copies another item's"
            ))),
            Some((item, write, offset, elem, count)) => out.push(Mirror {
                array: array.clone(),
                global: global.clone(),
                item,
                write,
                offset,
                elem,
                count,
                at: 0,
            }),
        }
    }
    out
}

/// Each mirror's range list in the region map, from `at`, in `mirrors` order; the offset after.
pub(crate) fn listed(mirrors: &[Mirror], mut at: u32, entries: &mut Vec<Region>) -> u32 {
    for (j, m) in mirrors.iter().enumerate() {
        entries.push(Region {
            region: "reads",
            name: m.array.clone(),
            offset: at,
            size: LIST,
            ty: "ranges".into(),
            read: Read::Mirror(j),
        });
        at = align8(at.saturating_add(LIST));
    }
    at
}

/// Where each mirror sits, from its global: a refusal, naming it, for a global the program doesn't
/// export, or a copy that passes the end of memory or overlaps a region, a data segment or
/// another mirror.
pub(crate) fn placed(
    mirrors: &mut [Mirror],
    given: &[u8],
    memory: u64,
    regions: &mut Vec<(&str, u32, u32)>,
    segments: &[(u64, u64)],
) -> Vec<Value> {
    let mut out = Vec::new();
    for m in mirrors {
        let no = |what: String| refusal("mirrors", what, json!({"mirror": m.array}));
        let Some(at) = global_at(given, &m.global) else {
            out.push(no(format!(
                "{}: the program exports no immutable i32 global {} holding the mirror's address",
                m.array, m.global
            )));
            continue;
        };
        m.at = at;
        let end = u64::from(at) + u64::from(m.size());
        if let Some(why) = clash(u64::from(at), end, memory, regions, segments) {
            out.push(no(format!(
                "{}: the mirror, {} bytes at {at}, {why}",
                m.array,
                m.size()
            )));
            continue;
        }
        regions.push(("a mirror", at, m.size()));
    }
    out
}

/// Writer `w`'s changed ranges of one step, held for each mirror of them.
pub(crate) fn changed(piece: &Piece, w: usize, ranges: &[Range], held: &mut Held) {
    for (r, item) in piece.items.iter().enumerate() {
        for (j, m) in item.mirrors.iter().enumerate().filter(|(_, m)| m.item == w) {
            held.extend(
                ranges
                    .iter()
                    .filter(|x| x.write == m.write)
                    .map(|x| (r, j, [x.start, x.end])),
            );
        }
    }
}

/// `runs` joined to `pending`: ascending, overlapping or touching runs merged, and more than
/// [`RANGES`] become the whole array, which stays whole until the reader steps.
pub(crate) fn union(pending: &mut Pending, runs: impl Iterator<Item = [u32; 2]>) {
    let Some(list) = pending else { return };
    list.extend(runs);
    list.sort_unstable();
    let mut out: Vec<[u32; 2]> = Vec::with_capacity(list.len());
    for r in list.drain(..) {
        match out.last_mut() {
            Some(l) if r[0] <= l[1] => l[1] = l[1].max(r[1]),
            _ => out.push(r),
        }
    }
    *pending = (out.len() <= RANGES).then_some(out);
}

/// The held runs joined to each reader's pending ranges, once the group that wrote them ends.
pub(crate) fn pend(mut held: Held, lives: &mut [Live]) {
    held.sort_by_key(|(r, j, _)| (*r, *j));
    for chunk in held.chunk_by(|a, b| (a.0, a.1) == (b.0, b.1)) {
        union(
            &mut lives[chunk[0].0].mirrors[chunk[0].1],
            chunk.iter().map(|x| x.2),
        );
    }
}

/// Before a step of `item`: each mirror's pending ranges, taken, written as its list into `region`
/// and copied from the writer's arrays as the steps before left them (`snapshot`) into `memory`.
/// The pages it wrote go to `touched`; the lists' hash is returned, for logic.determinism.
pub(crate) fn fill(
    item: &Item,
    pending: &mut [Pending],
    snapshot: &[Vec<u8>],
    region: &mut [u8],
    memory: &mut [u8],
    touched: &mut Vec<u64>,
) -> u64 {
    let mut lists = Vec::new();
    for e in &item.layout.entries {
        let Read::Mirror(j) = e.read else { continue };
        let m = &item.mirrors[j];
        let taken = pending[j].replace(Vec::new());
        let at = e.offset as usize;
        let (count, runs) = match taken {
            None => (WHOLE, vec![[0, m.count]]),
            Some(list) => (list.len() as u32, list),
        };
        region[at..at + 4].copy_from_slice(&count.to_le_bytes());
        if count != WHOLE {
            for (n, r) in runs.iter().enumerate() {
                let o = at + 4 + 8 * n;
                region[o..o + 4].copy_from_slice(&r[0].to_le_bytes());
                region[o + 4..o + 8].copy_from_slice(&(r[1] - r[0]).to_le_bytes());
            }
        }
        let n = if count == WHOLE { 0 } else { runs.len() };
        lists.extend_from_slice(&region[at..at + 4 + 8 * n]);
        let src = &snapshot[m.item][m.offset as usize..][..m.size() as usize];
        for r in runs.iter().filter(|r| r[1] > r[0]) {
            let (a, b) = ((r[0] * m.elem) as usize, (r[1] * m.elem) as usize);
            memory[m.at as usize + a..m.at as usize + b].copy_from_slice(&src[a..b]);
            let (first, last) = (u64::from(m.at) + a as u64, u64::from(m.at) + b as u64 - 1);
            touched.extend(first / PAGE..=last / PAGE);
        }
    }
    h64(&lists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::piece::{check_in, History, Refused};
    use crate::Planted;
    use deep_canvas_sandbox::rewrite::hash;

    /// #213: each mirror of an array no logic item writes, of the item's own array, at a global
    /// the program doesn't export, past memory or over a region is refused, naming it; one that
    /// fits is taken, its list after the reads and before the seed. Each service the build doesn't
    /// bind, or asked past its cap, is refused, naming it.
    #[test]
    fn mirrors_and_services_are_refused_naming_them() {
        let program = |at: u32| {
            let wat = format!(
                r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (global (export "m_at") i32 (i32.const {at})) (global (export "services_at") i32 (i32.const 8192))
  (func (export "init") (param i64)) (func (export "step") (param i64)))"#
            );
            wat::parse_str(wat).expect("a program")
        };
        let service = crate::services::Service {
            name: "test.ask@1".into(),
            request: 16,
            result: 16,
            max_per_step: 4,
            fuel_per_request: 10,
            answer: std::rc::Rc::new(|_, _| Ok(Vec::new())),
        };
        let run = |at: u32, reader: Value| {
            let (w, r) = (program(0), program(at));
            let piece = json!({"seed": 0, "controls": {"speed": {"kind": "slider"}}, "items": {
                "w": {"kind": "logic@1", "params": {"program": hash(&w), "writes": {"pos": {"type": "f64", "count": 10}}}},
                "r": {"kind": "logic@1", "params": reader}}});
            let mut piece = piece;
            piece["items"]["r"]["params"]["program"] = json!(hash(&r));
            let found = |sha: &str| [&w, &r].into_iter().find(|b| hash(b) == sha).cloned();
            check_in(
                &piece,
                &Planted::default(),
                &mut History::new(),
                &found,
                std::slice::from_ref(&service),
            )
        };
        let mirror = |array: &str, at: &str| json!({"reads": ["speed"], "writes": {"own": {"type": "i32"}}, "mirrors": [{"array": array, "at": at}]});
        for (at, reader, named) in [
            (4096, mirror("w.nothing", "m_at"), "w.nothing"),
            (4096, mirror("r.own", "m_at"), "r.own"),
            (4096, mirror("w.pos", "nowhere"), "w.pos"),
            (1024, mirror("w.pos", "m_at"), "w.pos"),
            (65_500, mirror("w.pos", "m_at"), "w.pos"),
        ] {
            let Err(Refused(v)) = run(at, reader.clone()) else {
                panic!("{reader} at {at} was taken")
            };
            assert_eq!(
                (
                    &v["item"],
                    &v["refusals"][0]["rule"],
                    &v["refusals"][0]["mirror"]
                ),
                (&json!("r"), &json!("mirrors"), &json!(named)),
                "{v}"
            );
        }
        let p = run(4096, mirror("w.pos", "m_at")).expect("a mirror that fits");
        let names: Vec<&str> = p.items[1]
            .layout
            .entries
            .iter()
            .filter(|e| e.region == "reads")
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, ["speed", "w.pos", "seed"]);
        for (asked, named) in [("other.ask@1", "other.ask@1"), ("test.ask@1", "test.ask@1")] {
            let reader = json!({"services": {asked: {"max_per_step": 5}}});
            let Err(Refused(v)) = run(4096, reader) else {
                panic!("{asked} was taken")
            };
            assert_eq!(
                (&v["refusals"][0]["rule"], &v["refusals"][0]["service"]),
                (&json!("services"), &json!(named)),
                "{v}"
            );
        }
        assert!(run(
            4096,
            json!({"services": {"test.ask@1": {"max_per_step": 4}}})
        )
        .is_ok());
    }

    /// Runs from two writer steps join as one ascending list, overlapping and touching runs merged;
    /// past 256 runs the list becomes the whole array and stays whole.
    #[test]
    fn pending_runs_merge_and_past_256_become_whole() {
        let mut p: Pending = Some(vec![[0, 5], [20, 30]]);
        union(&mut p, [[5, 8], [10, 12], [25, 40]].into_iter());
        assert_eq!(p, Some(vec![[0, 8], [10, 12], [20, 40]]));
        let mut p: Pending = Some(Vec::new());
        union(&mut p, (0..256).map(|i| [3 * i, 3 * i + 1]));
        assert_eq!(p.as_ref().map(Vec::len), Some(256));
        union(&mut p, [[2000, 2001]].into_iter());
        assert_eq!(p, None);
        union(&mut p, [[0, 1]].into_iter());
        assert_eq!(p, None);
    }
}
