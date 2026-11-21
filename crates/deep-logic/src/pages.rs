//! World pages (canvas primitives: Logic: world pages; #211): a logic item keeps a world past its
//! memory as 64 KiB pages in a page store the logic module owns. The page region sits at the
//! immutable global `pages_at`, 64 KiB aligned: `moves` requests `{page: u32, slot: u32}` (the
//! program's; page 0xFFFFFFFF asks for nothing), then the slot table, `slots` × `{page: u32,
//! fresh: u32}` (the module's), padded to the region's first 64 KiB, then `slots` page slots, each
//! one memory page, so the page bitmap the rewrite keeps says which slots a step wrote.
//!
//! After `init` and after each step k the module reads the requests in order and queues each valid
//! one for step k + `lead`; before that step, ahead of the read region fill, each move writes back
//! the slot's page when a step wrote it since it loaded, as a new version by hash, then loads the
//! requested page's bytes as the map gives them. The world is the page map, `{page → sha256}`,
//! with a root hash over (page, hash) in page order; it and the move queue are in every checkpoint
//! and save, so a seek loads pages exactly as play did. The store keeps bytes by hash in memory
//! and past its cap on disk; a page still on disk when its step comes holds the step and counts
//! `pages.late`, and never changes a value.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use serde_json::{json, Value};
use sha2::Digest as _;

use crate::piece::{clash, global_at, refusal};

/// A world page: the size of a memory page.
pub const SIZE: usize = 65_536;
/// A request's page that asks for nothing, and a slot holding no page.
pub const NONE: u32 = u32::MAX;
/// The fuel each move charges its step.
pub const MOVE_FUEL: i64 = 65_536;
const MIB: u64 = 1 << 20;

pub type Hash = [u8; 32];

/// A world's pages by number: each one's hash and bytes.
pub type Paged = BTreeMap<u32, (Hash, Rc<[u8]>)>;

/// A save's page map entries that differ from init, and each version's bytes once.
pub type Saved = (Vec<(u32, Hash)>, Vec<(Hash, Rc<[u8]>)>);

pub fn sha(bytes: &[u8]) -> Hash {
    sha2::Sha256::digest(bytes).into()
}

pub fn hex(h: &Hash) -> String {
    h.iter().map(|b| format!("{b:02x}")).collect()
}

fn bytes_hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex_bytes(s: &str) -> Option<Vec<u8>> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

fn unhex(s: &str) -> Option<Hash> {
    unhex_bytes(s)?.try_into().ok()
}

/// A logic item's `pages`, checked.
#[derive(Clone, Debug)]
pub struct Pages {
    pub max: u32,
    pub slots: u32,
    pub moves: u32,
    pub lead: i64,
    /// `written_max`, in pages.
    pub written_max: u64,
    /// `web_max`, in bytes.
    pub web_max: Option<u64>,
    /// `pages_at`.
    pub at: u32,
    /// The `init` asset's ID (a provider's output is one too), or none for zeros.
    pub init: Option<String>,
    /// The init asset's pages by number: each one's hash and bytes.
    pub init_pages: Rc<Paged>,
}

impl Pages {
    pub fn table_at(&self) -> usize {
        self.at as usize + 8 * self.moves as usize
    }
    pub fn slot_at(&self, j: u32) -> usize {
        self.at as usize + SIZE * (1 + j as usize)
    }
    /// The region's bytes: the requests and the slot table's page, then the slots.
    pub fn size(&self) -> u64 {
        (SIZE as u64) * (1 + u64::from(self.slots))
    }
    /// The slot memory page `p` is, if any.
    pub fn slot_of(&self, p: u32) -> Option<u32> {
        let first = self.at / SIZE as u32 + 1;
        (first..first + self.slots).contains(&p).then(|| p - first)
    }
    /// The memory pages the requests and the slot table sit on.
    pub fn table_page(&self) -> u32 {
        self.at / SIZE as u32
    }
    /// The map an item starts from: every init page, none written.
    pub fn first_map(&self) -> BTreeMap<u32, Entry> {
        self.init_pages
            .iter()
            .map(|(p, (h, _))| {
                (
                    *p,
                    Entry {
                        hash: *h,
                        written: false,
                    },
                )
            })
            .collect()
    }
}

/// A page map entry: the version's hash and whether a write made it (else `init` did).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry {
    pub hash: Hash,
    pub written: bool,
}

/// A queued move: the step it runs before, the page and the slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Move {
    pub step: i64,
    pub page: u32,
    pub slot: u32,
}

/// The root hash over (page, hash) in page order.
pub fn root(map: &BTreeMap<u32, Entry>) -> Hash {
    let mut h = sha2::Sha256::new();
    for (p, e) in map {
        h.update(p.to_le_bytes());
        h.update(e.hash);
    }
    h.finalize().into()
}

/// The `pages` field of a logic item, checked against its program (`given`) and the regions
/// placed so far; init's asset read by `asset`. A refusal names `pages/<field>`.
pub(crate) fn of(
    v: &Value,
    given: &[u8],
    memory: u64,
    regions: &[(&str, u32, u32)],
    segments: &[(u64, u64)],
    asset: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Pages, Value> {
    let bad =
        |f: &str, what: String| refusal("pages", what, json!({"field": format!("pages/{f}")}));
    let o = v.as_object().ok_or_else(|| {
        bad(
            "",
            "pages is {max, slots, moves, lead, init, written_max, web_max}".into(),
        )
    })?;
    for k in o.keys() {
        if ![
            "max",
            "slots",
            "moves",
            "lead",
            "init",
            "written_max",
            "web_max",
        ]
        .contains(&k.as_str())
        {
            return Err(bad(k, format!("pages has no field {k}")));
        }
    }
    let num = |k: &str, lo: u64, hi: u64, default: Option<u64>| -> Result<u64, Value> {
        match o.get(k) {
            None => default.ok_or_else(|| bad(k, format!("pages.{k} is required"))),
            Some(n) => n
                .as_u64()
                .filter(|n| (lo..=hi).contains(n))
                .ok_or_else(|| bad(k, format!("pages.{k} is {n}, outside {lo} to {hi}"))),
        }
    };
    let max = num("max", 1, 65_536, None)? as u32;
    let slots = num("slots", 1, 512, None)? as u32;
    let moves = num("moves", 1, 16, Some(8))? as u32;
    let lead = num("lead", 1, 8, Some(4))? as i64;
    let written_max = num("written_max", 1, 4_096, Some(256))? * MIB / SIZE as u64;
    let web_max = match o.get("web_max") {
        None => None,
        Some(_) => Some(num("web_max", 1, 256, None)? * MIB),
    };
    let at = global_at(given, "pages_at").ok_or_else(|| {
        bad(
            "",
            "an item with pages exports pages_at, an immutable i32 global holding an address"
                .into(),
        )
    })?;
    if !(at as usize).is_multiple_of(SIZE) {
        return Err(bad("", format!("pages_at is {at}, not 64 KiB aligned")));
    }
    let mut p = Pages {
        max,
        slots,
        moves,
        lead,
        written_max,
        web_max,
        at,
        init: None,
        init_pages: Rc::new(BTreeMap::new()),
    };
    let end = u64::from(at) + p.size();
    if let Some(why) = clash(u64::from(at), end, memory, regions, segments) {
        return Err(bad(
            "",
            format!("the page region, {} bytes at {at}, {why}", p.size()),
        ));
    }
    match o.get("init") {
        None => {}
        Some(Value::String(s)) if s == "zero" => {}
        // A provider's output reaches the logic module by its asset ID, as the drawn form fills it.
        Some(Value::String(id)) => p.init = Some(id.clone()),
        Some(i) => match i.get("asset").and_then(Value::as_str) {
            Some(id) => p.init = Some(id.to_string()),
            None if i.get("gen").is_some() => {
                return Err(bad("init", "init names a provider whose output this check hasn't made: a provider's pages reach a logic item through the document's check".into()))
            }
            None => return Err(bad("init", "init is zero, {asset} or {gen, params}".into())),
        },
    }
    if let Some(id) = p.init.clone() {
        let bytes = asset(&id)
            .ok_or_else(|| bad("init", format!("the piece carries no pages asset {id}")))?;
        p.init_pages = Rc::new(init_pages(&id, &bytes, max).map_err(|(what, extra)| {
            let mut r = bad("init", what);
            r["asset"] = json!(id);
            r["layout"] = json!("pages@1");
            if let (Some(r), Some(e)) = (r.as_object_mut(), extra.as_object()) {
                r.extend(e.clone());
            }
            r
        })?);
    }
    Ok(p)
}

/// A `pages@1` asset's pages, refused by the layout's validator under the one subset, naming the
/// offset and the field, or with a page past `max`.
fn init_pages(id: &str, bytes: &[u8], max: u32) -> Result<Paged, (String, Value)> {
    use deep_canvas_sandbox::layouts;
    use deep_sandbox_wasmtime::layouts::{judge, program, Judged};
    use deep_sandbox_wasmtime::service::{Budget, Sandbox};
    let layout = layouts::named("pages@1").expect("pages@1 is first-party");
    if bytes.len() as u64 > layout.cap(layouts::Planted::default()) {
        return Err((
            format!("the pages asset {id} passes pages@1's cap"),
            json!({"code": "over_cap"}),
        ));
    }
    let sandbox = Sandbox {
        planted: Default::default(),
    };
    let validator = program(&layout, layouts::Planted::default());
    let budget = Budget::of("validator", None, bytes.len());
    let rewritten = sandbox
        .rewrite(&validator, "validator", &budget)
        .map_err(|_| ("pages@1's validator didn't rewrite".to_string(), json!({})))?
        .0;
    match judge(&sandbox, &rewritten, bytes) {
        Ok(Judged::Valid) => {}
        Ok(Judged::Bad(o)) => {
            let field = (layout.field)(bytes, o.max(0) as u64);
            // A page number out of order, such as a repeated one, is named too.
            let at = o.max(0) as usize;
            let page = (at >= 12 && (at - 12).is_multiple_of(4 + SIZE))
                .then(|| bytes.get(at..at + 4))
                .flatten()
                .map(|b| u32::from_le_bytes(b.try_into().expect("4 bytes")));
            let named = page.map_or(String::new(), |n| format!(" (page {n})"));
            return Err((
                format!("the pages asset {id} is refused by pages@1 at offset {o}, {field}{named}"),
                json!({"code": "layout_refused", "offset": o, "where": field, "page": page}),
            ));
        }
        Ok(Judged::Trap(t)) => {
            return Err((
                format!("pages@1's validator trapped on {id}"),
                json!({"code": "layout_trap", "trap": t}),
            ))
        }
        Err(e) => {
            return Err((
                format!("pages@1's validator didn't run on {id}: {e}"),
                json!({}),
            ))
        }
    }
    let n = u32::from_le_bytes(bytes[8..12].try_into().expect("a header")) as usize;
    let mut out = BTreeMap::new();
    for i in 0..n {
        let at = 12 + i * (4 + SIZE);
        let page = u32::from_le_bytes(bytes[at..at + 4].try_into().expect("a number"));
        if page >= max {
            return Err((
                format!("the pages asset {id} holds page {page}, past max {max}"),
                json!({"code": "past_max", "page": page, "offset": at}),
            ));
        }
        let b: Rc<[u8]> = Rc::from(&bytes[at + 4..at + 4 + SIZE]);
        out.insert(page, (sha(&b), b));
    }
    Ok(out)
}

/// The test disk a store spills to: its folder and the delay of every read.
#[derive(Clone, Debug)]
pub struct Disk {
    pub dir: PathBuf,
    pub delay: Duration,
}

/// The planted stores and pagers (the #211 acceptance README: Planted twins).
#[derive(Clone, Copy, Debug, Default)]
pub struct Plants {
    pub overwrites_by_page: bool,
}

/// Page bytes by hash: in memory up to `cap`, past it on disk, least recently used first.
pub struct Store {
    mem: HashMap<Hash, Rc<[u8]>>,
    used: VecDeque<Hash>,
    bytes: u64,
    cap: u64,
    disk: Option<Disk>,
    on_disk: HashSet<Hash>,
    /// The planted store's one copy per page number: the hash its page last held.
    by_page: HashMap<u32, Hash>,
    plants: Plants,
    #[cfg(not(target_arch = "wasm32"))]
    reads: HashMap<Hash, std::sync::mpsc::Receiver<Vec<u8>>>,
}

pub type Shared = Rc<RefCell<Store>>;

impl Store {
    pub fn new(cap: u64, disk: Option<Disk>, plants: Plants) -> Store {
        Store {
            mem: HashMap::new(),
            used: VecDeque::new(),
            bytes: 0,
            cap,
            disk,
            on_disk: HashSet::new(),
            by_page: HashMap::new(),
            plants,
            #[cfg(not(target_arch = "wasm32"))]
            reads: HashMap::new(),
        }
    }

    /// Keeps `bytes`, page `page`'s new version, by its hash; bytes an older checkpoint names never
    /// change. The planted store overwrites the page's last version instead.
    pub fn put(&mut self, page: u32, bytes: &[u8]) -> Hash {
        let h = sha(bytes);
        if self.plants.overwrites_by_page {
            if let Some(old) = self.by_page.insert(page, h).filter(|o| *o != h) {
                self.drop_one(&old);
                self.insert(old, Rc::from(bytes));
            }
        }
        if !self.mem.contains_key(&h) && !self.on_disk.contains(&h) {
            self.insert(h, Rc::from(bytes));
        }
        h
    }

    fn insert(&mut self, h: Hash, b: Rc<[u8]>) {
        self.bytes += b.len() as u64;
        self.mem.insert(h, b);
        self.used.push_back(h);
        self.spill();
    }

    fn drop_one(&mut self, h: &Hash) {
        if let Some(b) = self.mem.remove(h) {
            self.bytes -= b.len() as u64;
        }
        if self.on_disk.remove(h) {
            if let Some(d) = &self.disk {
                let _ = std::fs::remove_file(d.dir.join(hex(h)));
            }
        }
    }

    /// Past its cap, the least recently used versions go to disk; with no disk they stay.
    fn spill(&mut self) {
        let Some(d) = self.disk.clone() else { return };
        while self.bytes > self.cap {
            let Some(h) = self.used.pop_front() else {
                break;
            };
            let Some(b) = self.mem.remove(&h) else {
                continue;
            };
            let _ = std::fs::create_dir_all(&d.dir);
            if std::fs::write(d.dir.join(hex(&h)), &b).is_err() {
                self.mem.insert(h, b);
                break;
            }
            self.bytes -= b.len() as u64;
            self.on_disk.insert(h);
        }
    }

    /// Whether `h`'s bytes are in memory, so a move needing them can run now.
    pub fn ready(&self, h: &Hash) -> bool {
        self.mem.contains_key(h)
    }

    /// Whether `h`'s read has finished, taking its bytes in if so; a version on disk with no read
    /// started starts one.
    pub fn finished(&mut self, h: &Hash) -> bool {
        if self.mem.contains_key(h) {
            return true;
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.prefetch(h);
            if let Some(Ok(b)) = self.reads.get(h).map(std::sync::mpsc::Receiver::try_recv) {
                self.reads.remove(h);
                self.taken(h, b);
                return true;
            }
        }
        false
    }

    /// A version read back from disk: in memory again, and off the disk.
    fn taken(&mut self, h: &Hash, read: Vec<u8>) -> Rc<[u8]> {
        self.on_disk.remove(h);
        if let Some(d) = &self.disk {
            let _ = std::fs::remove_file(d.dir.join(hex(h)));
        }
        let b: Rc<[u8]> = Rc::from(read);
        self.insert(*h, b.clone());
        b
    }

    /// Starts reading `h` from disk ahead of its step.
    pub fn prefetch(&mut self, h: &Hash) {
        #[cfg(not(target_arch = "wasm32"))]
        if !self.mem.contains_key(h) && self.on_disk.contains(h) && !self.reads.contains_key(h) {
            if let Some(d) = self.disk.clone() {
                let (tx, rx) = std::sync::mpsc::channel();
                let path = d.dir.join(hex(h));
                std::thread::spawn(move || {
                    std::thread::sleep(d.delay);
                    let _ = tx.send(std::fs::read(path).unwrap_or_default());
                });
                self.reads.insert(*h, rx);
            }
        }
        #[cfg(target_arch = "wasm32")]
        let _ = h;
    }

    /// `h`'s bytes, and whether its read hadn't finished: a late read holds the step until it ends.
    pub fn get(&mut self, h: &Hash) -> (Rc<[u8]>, bool) {
        if self.finished(h) {
            let b = self.mem[h].clone();
            self.used.push_back(*h);
            return (b, false);
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let read = match self.reads.remove(h) {
                Some(rx) => rx.recv().unwrap_or_default(),
                None => {
                    let d = self.disk.clone().expect("a version on disk has a disk");
                    std::thread::sleep(d.delay);
                    std::fs::read(d.dir.join(hex(h))).unwrap_or_default()
                }
            };
            (self.taken(h, read), true)
        }
        #[cfg(target_arch = "wasm32")]
        unreachable!("the web player's store keeps every version in memory")
    }

    /// Frees every version `keep` doesn't name.
    pub fn free(&mut self, keep: &HashSet<Hash>) {
        if self.plants.overwrites_by_page {
            return;
        }
        let gone: Vec<Hash> = self
            .mem
            .keys()
            .chain(self.on_disk.iter())
            .filter(|h| !keep.contains(*h))
            .copied()
            .collect();
        for h in gone {
            self.drop_one(&h);
        }
        self.used.retain(|h| keep.contains(h));
    }
}

/// The map as a checkpoint keeps it: whole at the ring's whole checkpoints, else its changes.
#[derive(Clone, Debug)]
pub enum MapPart {
    Whole(BTreeMap<u32, Entry>),
    Changes(BTreeMap<u32, Entry>),
}

impl MapPart {
    fn map(&self) -> &BTreeMap<u32, Entry> {
        match self {
            MapPart::Whole(m) | MapPart::Changes(m) => m,
        }
    }
}

/// An earlier checkpoint's map under a later one's: the later one's entries win.
pub fn merge(earlier: Option<MapPart>, later: MapPart) -> MapPart {
    match (earlier, later) {
        (None, l) | (Some(_), l @ MapPart::Whole(_)) => l,
        (Some(MapPart::Whole(mut e)), MapPart::Changes(c)) => {
            e.extend(c);
            MapPart::Whole(e)
        }
        (Some(MapPart::Changes(mut e)), MapPart::Changes(c)) => {
            e.extend(c);
            MapPart::Changes(e)
        }
    }
}

/// What a checkpoint adds for an item with pages: its map (whole or changes), the slots, which
/// slots a step wrote since they loaded, and the move queue.
#[derive(Clone, Debug)]
pub struct Kept {
    pub map: MapPart,
    pub slots: Vec<(u32, u32)>,
    pub dirty: BTreeSet<u32>,
    pub queue: VecDeque<Move>,
}

impl Kept {
    /// 36 B a map entry, 8 a slot, 16 a queued move.
    pub fn bytes(&self) -> u64 {
        (36 * self.map.map().len()
            + 8 * self.slots.len()
            + 16 * self.queue.len()
            + 4 * self.dirty.len()) as u64
    }
    /// The bytes its map adds to the checkpoint: 36 an entry.
    pub fn map_bytes(&self) -> usize {
        36 * self.map.map().len()
    }
    pub fn hashes(&self) -> impl Iterator<Item = &Hash> {
        self.map.map().values().map(|e| &e.hash)
    }
}

/// An item's world as it steps.
#[derive(Clone)]
pub struct State {
    pub store: Shared,
    pub map: BTreeMap<u32, Entry>,
    /// Each slot's page (NONE for none) and its `fresh`.
    pub slots: Vec<(u32, u32)>,
    pub dirty: BTreeSet<u32>,
    pub queue: VecDeque<Move>,
    /// The map's entries changed since the last checkpoint the ring stored.
    pub changed: BTreeMap<u32, Entry>,
    /// The moves the last step ran, and the meter `pages.late`.
    pub moved: u32,
    pub late: u64,
    pub moves: u64,
    /// The pages that arrived fresh, for the program to generate (logic.determinism's `orders`).
    pub generated: BTreeSet<u32>,
    /// The map's entries a write made.
    written: usize,
    /// The pages whose entry changed since the last checkpoint the record took.
    pub recorded: BTreeSet<u32>,
}

/// A trap a page request or the written cap raises: its kind and its fields.
pub type Trap = (&'static str, Value);

/// The planted pagers (the #211 acceptance README: Planted twins).
#[derive(Clone, Copy, Debug, Default)]
pub struct Pagers {
    pub restores_without_queue: bool,
    pub skips_dirty_writeback: bool,
    pub applies_in_read_order: bool,
}

impl State {
    pub fn new(p: &Pages, store: Shared) -> State {
        State {
            store,
            map: p.first_map(),
            slots: vec![(NONE, 0); p.slots as usize],
            dirty: BTreeSet::new(),
            queue: VecDeque::new(),
            changed: BTreeMap::new(),
            moved: 0,
            late: 0,
            moves: 0,
            generated: BTreeSet::new(),
            written: 0,
            recorded: BTreeSet::new(),
        }
    }

    /// The state a checkpoint `k` holds, its map whole or its changes since the last one.
    pub fn kept(&self, whole: bool) -> Kept {
        Kept {
            map: if whole {
                MapPart::Whole(self.map.clone())
            } else {
                MapPart::Changes(self.changed.clone())
            },
            slots: self.slots.clone(),
            dirty: self.dirty.clone(),
            queue: self.queue.clone(),
        }
    }

    /// The state restored from the last whole map at or before a checkpoint and the changes
    /// after it (`parts`, oldest first) with that checkpoint's slots and queue. Every entry counts
    /// as changed, since the ring holds nothing of this state's past.
    pub fn restored(store: Shared, parts: &[&Kept], pagers: Pagers) -> State {
        let mut map = BTreeMap::new();
        for k in parts {
            if let MapPart::Whole(m) = &k.map {
                map.clone_from(m);
            } else {
                map.extend(k.map.map().iter().map(|(p, e)| (*p, *e)));
            }
        }
        let last = parts.last().expect("a checkpoint");
        let written = map.values().filter(|e| e.written).count();
        State {
            written,
            store,
            changed: map.clone(),
            map,
            slots: last.slots.clone(),
            dirty: last.dirty.clone(),
            queue: if pagers.restores_without_queue {
                VecDeque::new()
            } else {
                last.queue.clone()
            },
            moved: 0,
            late: 0,
            moves: 0,
            generated: BTreeSet::new(),
            recorded: BTreeSet::new(),
        }
    }

    /// Writes the slot table into memory.
    fn table(&self, p: &Pages, memory: &mut [u8]) {
        let at = p.table_at();
        for (j, (page, fresh)) in self.slots.iter().enumerate() {
            memory[at + 8 * j..][..4].copy_from_slice(&page.to_le_bytes());
            memory[at + 8 * j + 4..][..4].copy_from_slice(&fresh.to_le_bytes());
        }
    }

    /// The slot table as memory holds it, hashed: what logic.determinism compares before a step.
    pub fn table_hash(&self, p: &Pages, memory: &[u8]) -> u64 {
        let at = p.table_at();
        crate::piece::h64(&memory[at..at + 8 * p.slots as usize])
    }

    /// Before step `k`, ahead of the read region fill: the moves queued for it, in queue order,
    /// each writing back its slot's page when a step wrote it since it loaded and loading the
    /// requested page as the map gives it; a page still on disk holds the step until its read
    /// ends. The planted pager applies each move once its read has finished instead, so a late
    /// one lands at a later step. Returns the memory pages the module wrote.
    pub fn moves_before(
        &mut self,
        p: &Pages,
        k: i64,
        memory: &mut [u8],
        pagers: Pagers,
    ) -> Vec<u32> {
        self.moved = 0;
        let n = self.queue.iter().take_while(|m| m.step <= k).count();
        if n == 0 {
            return Vec::new();
        }
        let mut due: Vec<Move> = self.queue.drain(..n).collect();
        if pagers.applies_in_read_order {
            let (ready, waiting): (Vec<Move>, Vec<Move>) = due.into_iter().partition(|m| {
                self.map
                    .get(&m.page)
                    .is_none_or(|e| self.store.borrow_mut().finished(&e.hash))
            });
            for m in waiting.into_iter().rev() {
                self.queue.push_front(m);
            }
            due = ready;
        }
        let mut touched = vec![p.table_page()];
        for m in due {
            let at = p.slot_at(m.slot);
            let (old, _) = self.slots[m.slot as usize];
            if old != NONE && self.dirty.contains(&m.slot) && !pagers.skips_dirty_writeback {
                let h = self.store.borrow_mut().put(old, &memory[at..at + SIZE]);
                self.set(
                    old,
                    Entry {
                        hash: h,
                        written: true,
                    },
                );
            }
            let fresh = match self.map.get(&m.page) {
                Some(e) => {
                    let (b, was_late) = self.store.borrow_mut().get(&e.hash);
                    self.late += u64::from(was_late);
                    memory[at..at + SIZE].copy_from_slice(&b);
                    0
                }
                None => {
                    memory[at..at + SIZE].fill(0);
                    self.generated.insert(m.page);
                    1
                }
            };
            self.slots[m.slot as usize] = (m.page, fresh);
            self.dirty.remove(&m.slot);
            self.moved += 1;
            self.moves += 1;
            touched.push((at / SIZE) as u32);
        }
        self.table(p, memory);
        touched
    }

    /// After a step that wrote memory pages `written`: the slots it wrote, then the written cap,
    /// counting pages, so every host traps at the same step.
    pub fn after_step(&mut self, p: &Pages, written: &[u32]) -> Result<(), Trap> {
        for s in written.iter().filter_map(|w| p.slot_of(*w)) {
            if self.slots[s as usize].0 != NONE {
                self.dirty.insert(s);
            }
        }
        let unsaved = self
            .dirty
            .iter()
            .filter(|s| {
                !self
                    .map
                    .get(&self.slots[**s as usize].0)
                    .is_some_and(|e| e.written)
            })
            .count();
        let written = self.written() + unsaved;
        if written as u64 > p.written_max {
            return Err((
                "pages_full",
                json!({"written": written, "written_max": p.written_max}),
            ));
        }
        // The web player keeps its store in memory, up to web_max: init's pages and the written.
        #[cfg(target_arch = "wasm32")]
        {
            let unwritten_init = p
                .init_pages
                .keys()
                .filter(|q| !self.map.get(q).is_some_and(|e| e.written))
                .filter(|q| !self.dirty.iter().any(|s| self.slots[*s as usize].0 == **q))
                .count();
            let web_max = p.web_max.unwrap_or(256 * MIB);
            let pages = written + unwritten_init;
            if pages as u64 * SIZE as u64 > web_max {
                return Err(("pages_store", json!({"pages": pages, "web_max": web_max})));
            }
        }
        Ok(())
    }

    /// The map's written pages.
    pub fn written(&self) -> usize {
        self.written
    }

    /// Sets page `page`'s entry, keeping the count of written pages.
    fn set(&mut self, page: u32, e: Entry) {
        let was = self.map.insert(page, e).is_some_and(|o| o.written);
        self.written = self.written + usize::from(e.written) - usize::from(was);
        self.changed.insert(page, e);
        self.recorded.insert(page);
    }

    /// The requests after step `k` (−1: after `init`), read in order and queued for step
    /// k + `lead`; they're the program's, and the module never writes them. A page at or past
    /// `max`, a slot at or past `slots`, a page already in a slot or in the queue, or a slot named
    /// twice traps `pages`, naming the request.
    pub fn requests(&mut self, p: &Pages, k: i64, memory: &[u8]) -> Result<(), Trap> {
        let mut asked = Vec::new();
        let mut slots = BTreeSet::new();
        for i in 0..p.moves as usize {
            let at = p.at as usize + 8 * i;
            let page = u32::from_le_bytes(memory[at..at + 4].try_into().expect("4 bytes"));
            if page == NONE {
                continue;
            }
            let slot = u32::from_le_bytes(memory[at + 4..at + 8].try_into().expect("4 bytes"));
            let request = json!({"index": i, "page": page, "slot": slot});
            let why = if page >= p.max {
                Some(format!("page {page} is at or past max {}", p.max))
            } else if slot >= p.slots {
                Some(format!("slot {slot} is at or past slots {}", p.slots))
            } else if self.slots.iter().any(|(q, _)| *q == page) {
                Some(format!("page {page} is already in a slot"))
            } else if self.queue.iter().any(|m| m.page == page)
                || asked.iter().any(|m: &Move| m.page == page)
            {
                Some(format!("page {page} is already asked for"))
            } else if !slots.insert(slot) {
                Some(format!("slot {slot} is named twice"))
            } else {
                None
            };
            if let Some(why) = why {
                return Err(("pages", json!({"request": request, "why": why})));
            }
            asked.push(Move {
                step: k + p.lead,
                page,
                slot,
            });
        }
        let mut store = self.store.borrow_mut();
        for m in &asked {
            if let Some(e) = self.map.get(&m.page) {
                store.prefetch(&e.hash);
            }
        }
        drop(store);
        self.queue.extend(asked);
        Ok(())
    }

    /// The bytes the deep hash adds: the map's root, the queue, the slots and which were written.
    pub fn hashed(&self) -> Vec<u8> {
        let mut b = root(&self.map).to_vec();
        for m in &self.queue {
            b.extend(m.step.to_le_bytes());
            b.extend(m.page.to_le_bytes());
            b.extend(m.slot.to_le_bytes());
        }
        for (page, fresh) in &self.slots {
            b.extend(page.to_le_bytes());
            b.extend(fresh.to_le_bytes());
        }
        for s in &self.dirty {
            b.extend(s.to_le_bytes());
        }
        b
    }

    /// The map as a checkpoint's record names it: every page written or loaded from init, by the
    /// SHA-256 of its bytes there (a page a step wrote since it loaded by its slot's bytes).
    pub fn named(&self, p: &Pages, memory: &[u8]) -> Value {
        let mut out: BTreeMap<u32, Hash> = self.map.iter().map(|(q, e)| (*q, e.hash)).collect();
        for s in &self.dirty {
            out.insert(
                self.slots[*s as usize].0,
                sha(&memory[p.slot_at(*s)..][..SIZE]),
            );
        }
        Value::Object(
            out.into_iter()
                .map(|(q, h)| (q.to_string(), json!(hex(&h))))
                .collect(),
        )
    }

    /// What a save holds of the map: its entries that differ from init, and the bytes of their
    /// versions, each distinct one once (none for the planted save that leaves them out).
    pub fn save_counts(&self, p: &Pages, drops_map: bool) -> (usize, usize) {
        if drops_map {
            return (0, 0);
        }
        let mut seen = HashSet::new();
        let mut entries = 0;
        for (page, e) in &self.map {
            if !e.written && p.init_pages.get(page).is_some_and(|(h, _)| *h == e.hash) {
                continue;
            }
            entries += 1;
            seen.insert(e.hash);
        }
        (entries, seen.len() * SIZE)
    }

    /// The written entries and their bytes once each, as a save keeps them.
    pub fn saved(&self, p: &Pages) -> Saved {
        let mut seen = HashSet::new();
        let mut bytes = Vec::new();
        let mut entries = Vec::new();
        for (page, e) in &self.map {
            if p.init_pages.get(page).is_some_and(|(h, _)| *h == e.hash) && !e.written {
                continue;
            }
            entries.push((*page, e.hash));
            if seen.insert(e.hash) {
                bytes.push((e.hash, self.store.borrow_mut().get(&e.hash).0));
            }
        }
        (entries, bytes)
    }

    /// As plain data, with the written versions' bytes: what the canvas module carries.
    pub fn json(&self, p: &Pages) -> Value {
        let (entries, bytes) = self.saved(p);
        json!({"map": entries.iter().map(|(p, h)| json!([p, hex(h)])).collect::<Vec<_>>(),
               "bytes": bytes.iter().map(|(h, b)| json!([hex(h), bytes_hex(b)])).collect::<Vec<_>>(),
               "slots": self.slots, "dirty": self.dirty, "queue": self.queue.iter().map(|m| json!([m.step, m.page, m.slot])).collect::<Vec<_>>()})
    }

    /// The state `json` gave, its bytes put back in `store`.
    pub fn from_json(p: &Pages, store: Shared, v: &Value) -> Option<State> {
        let mut s = State::new(p, store);
        for b in v["bytes"].as_array()? {
            let bytes = unhex_bytes(b[1].as_str()?)?;
            s.store.borrow_mut().put(NONE, &bytes);
        }
        for e in v["map"].as_array()? {
            let page = e[0].as_u64()? as u32;
            s.set(
                page,
                Entry {
                    hash: unhex(e[1].as_str()?)?,
                    written: true,
                },
            );
        }
        s.slots = serde_json::from_value(v["slots"].clone()).ok()?;
        s.dirty = serde_json::from_value(v["dirty"].clone()).ok()?;
        for m in v["queue"].as_array()? {
            s.queue.push_back(Move {
                step: m[0].as_i64()?,
                page: m[1].as_u64()? as u32,
                slot: m[2].as_u64()? as u32,
            });
        }
        s.changed = s.map.clone();
        Some(s)
    }
}

/// The store a world's items keep their pages in, as a call configures it: `{memory, dir,
/// read_delay_ms}` (at most `memory` bytes of versions in memory, the rest spilled by hash to
/// files under `dir`, each read from there delayed), else every version in memory.
#[cfg(target_arch = "wasm32")]
pub fn store_of(_: Option<&Value>, plants: Plants) -> Store {
    Store::new(u64::MAX, None, plants)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn store_of(v: Option<&Value>, plants: Plants) -> Store {
    let Some(dir) = v.and_then(|v| v.get("dir")).and_then(Value::as_str) else {
        return Store::new(u64::MAX, None, plants);
    };
    let cap = v
        .and_then(|v| v.get("memory"))
        .and_then(Value::as_u64)
        .unwrap_or(u64::MAX);
    let delay = v
        .and_then(|v| v.get("read_delay_ms"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let disk = Disk {
        dir: PathBuf::from(dir),
        delay: Duration::from_millis(delay),
    };
    Store::new(cap, Some(disk), plants)
}

thread_local! {
    /// The store the current call configures (`store` on a bake or a check), else the default.
    static CONFIG: RefCell<Option<Value>> = const { RefCell::new(None) };
}

/// Sets the store each item with pages starts with, for the calls that follow.
pub fn configure(v: Option<&Value>) {
    CONFIG.with(|c| *c.borrow_mut() = v.cloned());
}

/// A new store as the current call configures it, holding `p`'s init pages.
pub fn new_store(p: &Pages, plants: Plants) -> Shared {
    let mut s = CONFIG.with(|c| store_of(c.borrow().as_ref(), plants));
    for (page, (_, b)) in p.init_pages.iter() {
        s.put(*page, b);
    }
    Rc::new(RefCell::new(s))
}

impl State {
    /// As a save holds it: the map's entries that differ from init (none for the planted save
    /// that leaves them out), each distinct version's bytes once, the slots, which were written
    /// and the queue. Returns the bytes and (entries, version bytes).
    pub fn encode(&self, p: &Pages, drops_map: bool) -> (Vec<u8>, (usize, usize)) {
        let (entries, versions) = if drops_map {
            (Vec::new(), Vec::new())
        } else {
            self.saved(p)
        };
        let mut out = (entries.len() as u32).to_le_bytes().to_vec();
        for (page, h) in &entries {
            out.extend(page.to_le_bytes());
            out.extend(h);
        }
        out.extend((versions.len() as u32).to_le_bytes());
        let mut size = 0;
        for (h, b) in &versions {
            out.extend(h);
            out.extend(b.iter());
            size += b.len();
        }
        out.extend((self.slots.len() as u32).to_le_bytes());
        for (page, fresh) in &self.slots {
            out.extend(page.to_le_bytes());
            out.extend(fresh.to_le_bytes());
        }
        out.extend((self.dirty.len() as u32).to_le_bytes());
        for s in &self.dirty {
            out.extend(s.to_le_bytes());
        }
        out.extend((self.queue.len() as u32).to_le_bytes());
        for m in &self.queue {
            out.extend(m.step.to_le_bytes());
            out.extend(m.page.to_le_bytes());
            out.extend(m.slot.to_le_bytes());
        }
        (out, (entries.len(), size))
    }

    /// The state `encode` gave, its versions put in `store`; its entries over init's.
    pub fn decode(p: &Pages, store: Shared, mut b: &[u8]) -> Option<State> {
        fn take<'a>(b: &mut &'a [u8], n: usize) -> Option<&'a [u8]> {
            let (head, rest) = (b.get(..n)?, b.get(n..)?);
            *b = rest;
            Some(head)
        }
        fn u32_of(b: &mut &[u8]) -> Option<u32> {
            Some(u32::from_le_bytes(take(b, 4)?.try_into().ok()?))
        }
        let mut s = State::new(p, store);
        let mut entries = Vec::new();
        for _ in 0..u32_of(&mut b)? {
            let page = u32_of(&mut b)?;
            let h: Hash = take(&mut b, 32)?.try_into().ok()?;
            entries.push((page, h));
        }
        for _ in 0..u32_of(&mut b)? {
            let h: Hash = take(&mut b, 32)?.try_into().ok()?;
            let bytes = take(&mut b, SIZE)?;
            if sha(bytes) != h {
                return None;
            }
            s.store.borrow_mut().put(NONE, bytes);
        }
        for (page, h) in entries {
            if page >= p.max
                || !s.store.borrow().ready(&h) && !p.init_pages.values().any(|(i, _)| *i == h)
            {
                return None;
            }
            s.set(
                page,
                Entry {
                    hash: h,
                    written: true,
                },
            );
        }
        let n = u32_of(&mut b)? as usize;
        if n != p.slots as usize {
            return None;
        }
        s.slots = (0..n)
            .map(|_| Some((u32_of(&mut b)?, u32_of(&mut b)?)))
            .collect::<Option<_>>()?;
        for _ in 0..u32_of(&mut b)? {
            s.dirty.insert(u32_of(&mut b)?);
        }
        for _ in 0..u32_of(&mut b)? {
            let step = i64::from_le_bytes(take(&mut b, 8)?.try_into().ok()?);
            s.queue.push_back(Move {
                step,
                page: u32_of(&mut b)?,
                slot: u32_of(&mut b)?,
            });
        }
        s.changed = s.map.clone();
        b.is_empty().then_some(s)
    }
}

/// The web export's refusal of a logic item whose world could outgrow the web player's store,
/// which it keeps in memory up to `web_max` (Export: web player): its `written_max` past
/// `web_max` (256 MiB when none is given), or its init asset of `init_bytes` past it, naming the
/// field and the sizes. `pages` is the item's field as declared. The planted export checks only
/// the init asset.
pub fn web_refused(
    pages: &Value,
    init_bytes: Option<u64>,
    checks_init_only: bool,
) -> Option<Value> {
    let mib = |k: &str| pages.get(k).and_then(Value::as_u64).unwrap_or(256) * MIB;
    let (web_max, written) = (mib("web_max"), mib("written_max"));
    let (field, bytes) = match init_bytes {
        Some(b) if b > web_max => ("init", b),
        _ if written > web_max && !checks_init_only => ("written_max", written),
        _ => return None,
    };
    Some(json!({"field": field, "bytes": bytes, "web_max": web_max,
        "why": format!("pages.{field} is {} MiB, past web_max {} MiB: the web player keeps its store in memory up to web_max", bytes / MIB, web_max / MIB)}))
}

impl Pages {
    /// What the web runner reads of it (`web_plan`): its fields, and init's pages by number.
    pub fn web(&self) -> Value {
        use base64::Engine as _;
        let b64 = base64::engine::general_purpose::STANDARD;
        json!({"max": self.max, "slots": self.slots, "moves": self.moves, "lead": self.lead,
               "written_max": self.written_max, "web_max": self.web_max.unwrap_or(256 * MIB), "at": self.at,
               "init": self.init_pages.iter().map(|(p, (_, b))| json!([p, b64.encode(b)])).collect::<Vec<_>>()})
    }
}

impl State {
    /// Each page that arrived fresh and the program wrote, with its bytes' hash now: one a step
    /// wrote since it loaded by its slot's bytes, else its map entry's.
    pub fn generated(&self, p: &Pages, memory: &[u8]) -> BTreeMap<u32, Hash> {
        let mut out = BTreeMap::new();
        for page in &self.generated {
            let slot = self.slots.iter().position(|(q, _)| q == page);
            if let Some(j) = slot.filter(|j| self.dirty.contains(&(*j as u32))) {
                out.insert(*page, sha(&memory[p.slot_at(j as u32)..][..SIZE]));
            } else if let Some(e) = self.map.get(page).filter(|e| e.written) {
                out.insert(*page, e.hash);
            }
        }
        out
    }
}
