//! The scheduler's own tests: a panic freezes only its session, and a revision stamps each dirty
//! class its change falls in.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{
    classes_changed, default_view, Cache, CacheOp, Class, Key, Options, Pool, Scheduler, Session,
    Val,
};
use crate::grammar::Seeded;
use crate::registry::{BuildSet, Manifest, Module, Range, Registrar, Registry, Semver};

fn register_boom(r: &mut Registrar) {
    r.array("boom.out", "f64", "item", "geometry", "items");
    r.operator("out", "items", &["self"], &["boom.out"])
        .run(|v| {
            if v.item()?.pointer("/params/boom") == Some(&json!(true)) {
                panic!("an operator's bug");
            }
            v.write("boom.out", Val::typed(1.0f64))
        });
}

fn boom() -> Module {
    Module {
        manifest: Manifest {
            name: "boom".into(),
            version: Semver {
                major: 1,
                minor: 0,
                patch: 0,
            },
            core: Range::parse("*").expect("a range"),
            depends_on: BTreeMap::new(),
            feature: "boom".into(),
            license: "Apache-2.0".into(),
            implements: "boom@1".into(),
        },
        register: register_boom,
    }
}

fn board(boom: bool) -> Value {
    json!({"format": 1, "size": [100, 100], "items": {
        "a": {"id": "a", "kind": "rect@1", "params": {"box": [0, 0, 10, 10], "boom": boom}},
        "b": {"id": "b", "kind": "rect@1", "params": {"box": [20, 0, 10, 10]}},
    }})
}

#[test]
fn a_panic_freezes_its_session_alone_until_a_new_revision() {
    let sealed = Registry::new(BuildSet::Core)
        .with(boom())
        .seal()
        .expect("seals");
    let mut s = Scheduler::new(&sealed, Options::default());
    let (bad, good) = (board(true), board(false));
    let mut a = Session::new(0, BTreeMap::new());
    let mut b = Session::new(0, BTreeMap::new());
    a.load(&mut s, &bad);
    b.load(&mut s, &good);

    a.frame(&mut s, 0, &default_view(&bad));
    let frozen = a.frozen().expect("the panic froze its session");
    assert_eq!(
        (
            frozen.code,
            frozen.module.as_str(),
            frozen.operator.as_str()
        ),
        ("operator_panic", "boom", "boom.out")
    );
    assert_eq!(frozen.item.as_deref(), Some("a"));
    // Frozen, it runs nothing, and says why on every frame.
    assert_eq!(a.frame(&mut s, 1, &default_view(&bad)), 0);
    assert_eq!(
        a.report.issues.first().map(|i| i.code),
        Some("operator_panic")
    );

    // The other session goes on.
    assert!(b.frame(&mut s, 0, &default_view(&good)) > 0);
    assert!(b.frozen().is_none());

    // A new revision is the way out (one of its own, so nothing comes from b's results).
    let mut fixed = good.clone();
    fixed["items"]["a"]["params"]["box"] = json!([1, 0, 10, 10]);
    a.load(&mut s, &fixed);
    assert!(a.frozen().is_none());
    assert!(a.frame(&mut s, 2, &default_view(&fixed)) > 0);
    assert!(a.report.issues.is_empty(), "{:?}", a.report.issues);
}

#[test]
fn a_change_falls_in_the_classes_of_the_fields_it_touches() {
    let item = json!({"id": "t", "kind": "text@1", "at": {"pos": [0, 0, 0]},
        "params": {"text": "Hi", "box": {"w": 10}, "paint": {"fill": {"role": "ink"}}, "gap": 1}});
    let with = |path: &str, value: Value| {
        let mut out = item.clone();
        *out.pointer_mut(path).expect("a field") = value;
        out
    };
    let cases = [
        (with("/at/pos/0", json!(5)), vec![Class::Transform]),
        (with("/params/text", json!("Bye")), vec![Class::Text]),
        (
            with("/params/paint/fill/role", json!("muted")),
            vec![Class::Shading],
        ),
        (with("/params/gap", json!(2)), vec![Class::Geometry]),
    ];
    for (changed, classes) in cases {
        assert_eq!(classes_changed(&item, &changed), classes, "{changed}");
    }
    let mut hidden = item.clone();
    hidden["visible"] = json!(false);
    assert_eq!(classes_changed(&item, &hidden), vec![Class::Presence]);
    assert!(classes_changed(&item, &item).is_empty());
}

#[test]
fn a_revision_stamps_only_the_classes_its_change_falls_in() {
    let sealed = Registry::new(BuildSet::Core).seal().expect("seals");
    let mut s = Scheduler::new(&sealed, Options::default());
    let mut session = Session::new(0, BTreeMap::new());
    let first = board(false);
    session.load(&mut s, &first);
    let before = |session: &Session, class| session.changed_at("a", class).expect("an item");
    let (transform, geometry) = (
        before(&session, Class::Transform),
        before(&session, Class::Geometry),
    );

    let mut moved = first.clone();
    moved["items"]["a"]["at"] = json!({"pos": [3, 0, 0]});
    session.load(&mut s, &moved);
    assert!(
        before(&session, Class::Transform) > transform,
        "the move stamps transform"
    );
    assert_eq!(
        before(&session, Class::Geometry),
        geometry,
        "and leaves geometry"
    );
    assert_eq!(
        session.changed_at("b", Class::Transform),
        Some(transform),
        "an untouched item keeps its epochs"
    );
}

#[test]
fn a_revision_of_item_values_alone_leaves_what_a_whole_load_leaves() {
    let sealed = Registry::new(BuildSet::Core).seal().expect("seals");
    // A scheduler each, so neither session reads the other's results from the cache.
    let (mut s, mut s2) = (
        Scheduler::new(&sealed, Options::default()),
        Scheduler::new(&sealed, Options::default()),
    );
    let first = board(false);
    let (mut whole, mut items) = (
        Session::new(0, BTreeMap::new()),
        Session::new(0, BTreeMap::new()),
    );
    whole.load(&mut s, &first);
    items.load(&mut s2, &first);
    whole.frame(&mut s, 0, &default_view(&first));
    items.frame(&mut s2, 0, &default_view(&first));

    let mut moved = first.clone();
    moved["items"]["a"]["at"] = json!({"pos": [3, 0, 0]});
    moved["items"]["a"]["params"]["box"] = json!([0, 0, 12, 10]);
    whole.load(&mut s, &moved);
    let issues = items.revise_items(&mut s2, &moved, &["a"]);
    assert_eq!(issues, Some(Vec::new()));
    let ran = (
        whole.frame(&mut s, 0, &default_view(&moved)),
        items.frame(&mut s2, 0, &default_view(&moved)),
    );
    assert_eq!(ran.0, ran.1);
    assert!(ran.0 > 0, "the change ran the item's nodes");
    let seen = |session: &Session,
                s: &Scheduler<'_>|
     -> Vec<(String, Option<String>, String, String, &'static str)> {
        session
            .nodes(s)
            .into_iter()
            .map(|n| (n.operator, n.item, n.key, n.result, n.run.name()))
            .collect()
    };
    assert_eq!(seen(&whole, &s), seen(&items, &s2));
    for class in [Class::Transform, Class::Geometry, Class::Shading] {
        assert_eq!(whole.changed_at("a", class), items.changed_at("a", class));
    }
    assert_eq!(whole.document(), items.document());

    // A change that moves an item in the plan is the whole load's.
    let mut reordered = moved.clone();
    reordered["items"]["a"]["order"] = json!("z9");
    assert_eq!(items.revise_items(&mut s2, &reordered, &["a"]), None);
    let mut grown = moved.clone();
    grown["items"]["c"] = json!({"id": "c", "kind": "rect@1", "params": {"box": [0, 0, 1, 1]}});
    assert_eq!(items.revise_items(&mut s2, &grown, &["c"]), None);
}

/// Real threads, each taking the next job, so shards apply in whatever order they finish.
#[derive(Debug)]
struct Threads;

impl Pool for Threads {
    fn performance_cores(&self) -> usize {
        4
    }
    fn run(&self, threads: usize, count: usize, job: &(dyn Fn(usize, usize) + Sync)) {
        let next = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for thread in 0..threads {
                let next = &next;
                scope.spawn(move || loop {
                    let k = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if k >= count {
                        break;
                    }
                    job(k, thread);
                });
            }
        });
    }
}

/// Each cached key with its shard, its holds and the insert that made it, in key order.
fn cached(cache: &Cache) -> Vec<(Key, usize, u32, String)> {
    let mut out: Vec<_> = (0..16)
        .flat_map(|k| {
            cache.0[k]
                .iter()
                .map(move |(key, e)| (*key, k, e.2, format!("{:?}", e.0)))
        })
        .collect();
    out.sort_by_key(|e| e.0);
    out
}

/// A wave's deferred cache changes, applied shard by shard on real threads, leave the cache and
/// each node's hold as applying them one by one in node order does: changes to different keys
/// commute. A node holds at most once in a wave, as each settles once.
#[test]
fn deferred_cache_changes_apply_as_in_node_order() {
    let sealed = Registry::new(BuildSet::Core).seal().expect("seals");
    // Six keys: three share a shard, so ops on one shard's keys interleave.
    let keys: Vec<Key> = [0u8, 16, 32, 1, 2, 3]
        .iter()
        .map(|&b| Key([b, b ^ 0x5a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
        .collect();
    for seed in 0..2_000u64 {
        let mut r = Seeded::new(seed);
        let pick = |r: &mut Seeded| keys[r.below(keys.len() as u64) as usize];
        let initial: Vec<(Key, u32)> = (0..r.below(4))
            .map(|_| (pick(&mut r), r.range(1, 2) as u32))
            .collect();
        let mut ops = Vec::new();
        let mut node = 0;
        for i in 0..r.range(1, 24) {
            let key = pick(&mut r);
            match r.below(3) {
                0 => {
                    ops.push(CacheOp::Insert(key, vec![Val::json(json!(i))], None));
                    // A node that ran holds its result next, as `settle` does.
                    if r.below(2) == 0 {
                        ops.push(CacheOp::Hold(node, key));
                        node += 1;
                    }
                }
                1 => {
                    ops.push(CacheOp::Hold(node, key));
                    node += 1;
                }
                _ => ops.push(CacheOp::Release(key)),
            }
        }

        let mut serial = Cache::default();
        let mut s = Scheduler::new(
            &sealed,
            Options {
                pool: Some(std::sync::Arc::new(Threads)),
                ..Options::default()
            },
        );
        for &(key, holds) in &initial {
            serial.insert(key, (vec![Val::json(json!("before"))], None, holds));
            s.cache
                .insert(key, (vec![Val::json(json!("before"))], None, holds));
        }
        let mut held = BTreeMap::new();
        for op in &ops {
            match op {
                CacheOp::Insert(key, out, err) => {
                    serial.insert(*key, (out.clone(), err.clone(), 0))
                }
                CacheOp::Hold(n, key) => {
                    held.insert(*n, serial.hold(*key).then_some(*key));
                }
                CacheOp::Release(key) => serial.release(*key),
            }
        }

        s.deferred = Some(ops);
        let sharded: BTreeMap<_, _> = s.apply_deferred(4).into_iter().collect();
        assert_eq!(cached(&s.cache), cached(&serial), "seed {seed}: the cache");
        assert_eq!(sharded, held, "seed {seed}: each node's hold");
    }
}
