//! The order of one evaluation, per component (canvas primitives: The order of one evaluation;
//! Driver: "scheduled per component, and cycles are refused"; Constraint: "Runs after the
//! transform and parent … scheduled per component"). Every write of the program is a node that
//! reads and writes slots; a node runs after every earlier writer of each slot it reads, and the
//! writers of one slot run channels first, then drivers, then constraints in list order. So two
//! items may read each other's different components, and only a real loop is refused.

use std::collections::BTreeSet;

/// Where a node sits among one slot's writers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Stage {
    Channels,
    Driver,
    Constraints,
}

impl Stage {
    pub fn name(self) -> &'static str {
        match self {
            Stage::Channels => "channels",
            Stage::Driver => "driver",
            Stage::Constraints => "constraints",
        }
    }
}

/// One write of the program: its document entry, the item it belongs to, and its slots.
#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub entry: String,
    pub item: String,
    pub stage: Stage,
    pub reads: Vec<usize>,
    pub writes: Vec<usize>,
}

/// The nodes in an order that runs each after what it reads, or the entries of a loop.
pub fn order(nodes: &[Node], whole_items: bool) -> Result<Vec<usize>, Vec<usize>> {
    let n = nodes.len();
    // Each slot's writers in stage then list order.
    let mut writers: std::collections::BTreeMap<usize, Vec<usize>> = Default::default();
    for (i, node) in nodes.iter().enumerate() {
        for &s in &node.writes {
            writers.entry(s).or_default().push(i);
        }
    }
    for list in writers.values_mut() {
        list.sort_by_key(|&i| (nodes[i].stage, i));
    }
    let mut after: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
    for (i, node) in nodes.iter().enumerate() {
        for &s in &node.reads {
            let Some(list) = writers.get(&s) else { continue };
            match list.iter().position(|&w| w == i) {
                // A slot it also writes: only its earlier writers.
                Some(at) => after[i].extend(&list[..at]),
                None => after[i].extend(list.iter().copied()),
            }
        }
        for &s in &node.writes {
            let list = &writers[&s];
            if let Some(at) = list.iter().position(|&w| w == i) {
                after[i].extend(&list[..at]);
            }
        }
        after[i].remove(&i);
    }
    if whole_items {
        // A planted scheduler: an item's nodes run as one, so it waits on every item any of
        // its nodes reads.
        let items: Vec<&str> = nodes.iter().map(|x| x.item.as_str()).collect();
        let merged: Vec<BTreeSet<usize>> = (0..n)
            .map(|i| {
                let mut out = BTreeSet::new();
                for j in (0..n).filter(|&j| items[j] == items[i]) {
                    for &k in after[j].iter().filter(|&&k| items[k] != items[i]) {
                        out.extend((0..n).filter(|&m| items[m] == items[k]));
                    }
                }
                out
            })
            .collect();
        after = merged;
    }
    // Kahn's algorithm, the lowest ready node first, so the order is the same however the
    // document lists its entries' members.
    let mut waiting: Vec<usize> = after.iter().map(BTreeSet::len).collect();
    // Each node's dependents, found once: asking every node whether it waits on the one
    // just placed made the order quadratic in the nodes.
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (j, set) in after.iter().enumerate() {
        for &i in set {
            dependents[i].push(j);
        }
    }
    let mut ready: BTreeSet<usize> = (0..n).filter(|&i| waiting[i] == 0).collect();
    let mut out = Vec::with_capacity(n);
    while let Some(i) = ready.pop_first() {
        out.push(i);
        for &j in &dependents[i] {
            waiting[j] -= 1;
            if waiting[j] == 0 {
                ready.insert(j);
            }
        }
    }
    if out.len() == n {
        return Ok(out);
    }
    // A loop among the rest: walk back along what each waits on until a node repeats.
    let left: BTreeSet<usize> = (0..n).filter(|i| !out.contains(i)).collect();
    let mut path = vec![*left.iter().next().unwrap_or(&0)];
    loop {
        let at = path[path.len() - 1];
        let Some(&next) = after[at].iter().find(|j| left.contains(j)) else {
            return Err(path);
        };
        if let Some(k) = path.iter().position(|&p| p == next) {
            let mut cycle = path.split_off(k);
            cycle.reverse();
            return Err(cycle);
        }
        path.push(next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(entry: &str, item: &str, stage: Stage, reads: &[usize], writes: &[usize]) -> Node {
        Node {
            entry: entry.into(),
            item: item.into(),
            stage,
            reads: reads.to_vec(),
            writes: writes.to_vec(),
        }
    }

    #[test]
    fn two_items_reading_each_others_other_components_order_and_a_loop_is_refused() {
        // A.pos 0, A.rot 1, B.pos 2, B.rot 3.
        let nodes = vec![
            node("channels/a", "A", Stage::Channels, &[], &[0]),
            node("drivers/a", "A", Stage::Driver, &[2], &[1]),
            node("constraints/b", "B", Stage::Constraints, &[0, 2], &[3]),
            node("channels/b", "B", Stage::Channels, &[], &[2]),
        ];
        assert_eq!(order(&nodes, false), Ok(vec![0, 3, 1, 2]));
        assert!(order(&nodes, true).is_err());
        let looped = vec![
            node("drivers/a", "A", Stage::Driver, &[2, 3], &[1]),
            node("constraints/b", "B", Stage::Constraints, &[0, 1], &[3]),
        ];
        let cycle = order(&looped, false).unwrap_err();
        assert_eq!(cycle.len(), 2);
    }
}
