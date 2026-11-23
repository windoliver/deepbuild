//! The one image service every image path draws through (Image `image@1`, #1486).
//!
//! A request is a picture's hash, a crop and a level. A level is made once, off the UI thread, by
//! this service's own workers (a still image decodes in process: Asset), and kept in the content
//! store by (hash, crop, level, tool version) as a proxy row, so a second open reads it back. Live
//! frames ask with [`Images::show`], which never blocks: jobs run visible first, then prefetch,
//! newest first within each; a view pass that covers a queued request and doesn't ask for it again
//! cancels it. Canonical renders ask with [`Images::wait`] for the exact level. One cache, bounded
//! in bytes and entries, evicts least recently used first at frame start and never what the last
//! two drawn frames drew.

pub mod animated;
mod level;
mod source;

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use web_time::Instant;

pub use level::{keeps, level_for, level_size, reduce, Level};
pub use source::{crop_px, hash_of, Refused, Store, DECODE_CAP, SIDE};

/// The cache's bounds unless a document's class sets a smaller one.
pub const BUDGET: u64 = 256 << 20;
pub const ENTRIES: usize = 65_536;

/// The source bytes jobs may hold decoded at once: a job past it waits for one to finish.
pub const IN_FLIGHT: u64 = 200_000_000;

/// The version a stored level is kept under: a change to how levels are made changes it.
pub const TOOL: &str = "deep-images/levels@1";

thread_local! {
    /// How deep this thread is in the service's own code (its calls and its workers' jobs).
    static INSIDE: Cell<u32> = const { Cell::new(0) };
}

/// Whether this thread is running the service's own code: a counting allocator reads it to tell
/// the service's allocations from the rest of the process's (#1486 AC3).
pub fn in_service() -> bool {
    INSIDE.try_with(|d| d.get() > 0).unwrap_or(false)
}

struct Inside;

impl Inside {
    fn enter() -> Inside {
        INSIDE.with(|d| d.set(d.get() + 1));
        Inside
    }
}

impl Drop for Inside {
    fn drop(&mut self) {
        INSIDE.with(|d| d.set(d.get() - 1));
    }
}

/// One request: a picture by its sha256, the whole pixels of it drawn, the flips an atlas cell
/// draws it with (bit 1 across, 2 down, 4 turned a quarter: #1653), the level, and (#1489) the
/// frame of an animation, 0 for a still picture.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    pub hash: [u8; 32],
    pub crop: [u32; 4],
    pub flip: u8,
    pub level: u8,
    pub frame: u32,
}

impl Key {
    /// The size the cut and flipped picture shows at, px.
    pub fn shown(&self) -> [u32; 2] {
        let [_, _, w, h] = self.crop;
        if self.flip & 4 != 0 {
            [h, w]
        } else {
            [w, h]
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Queue {
    Visible,
    Prefetch,
}

/// What a live frame draws for a request: its level, the nearest level held (and which), (#1489)
/// the frame of the animation it last drew while the frame asked for is made (and which), or
/// nothing yet.
pub enum Shown {
    Exact(Arc<Level>),
    Nearest(Arc<Level>, u8),
    Frame(Arc<Level>, u32),
    Nothing,
}

/// Wrong programs a check plants to show it fails on them (#1485, #1486).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// #1485 AC1: the picture decoded whole first, then the cap applied.
    DecodesBeforeHeader,
    /// #1485 AC2: the budget counts only resampled copies.
    CapCountsCopiesOnly,
    /// #1485 AC4: the picture read and decoded at every draw.
    DecodesPerDraw,
    /// #1485 AC5: Vello GPU uploads each picture at every draw.
    UploadsPerFrame,
    /// #1486 AC2: a queue that never cancels.
    QueueWithoutCancel,
    /// #1486 AC4: an evictor that ignores the two-frame rule.
    EvictorIgnoresTwoFrames,
    /// #1489 AC1: an animation's decoder that decodes every frame up front and keeps them all.
    DecoderHoldsAllFrames,
    /// #1488 AC1: a decoder that ignores a photo's EXIF orientation and draws it as stored.
    IgnoresOrientation,
}

impl Plant {
    /// The plant a request's `planted` names, if it names one of these.
    pub fn named(name: &str) -> Option<Plant> {
        Some(match name {
            "decodes_before_header" => Plant::DecodesBeforeHeader,
            "cap_counts_copies_only" => Plant::CapCountsCopiesOnly,
            "decodes_per_draw" => Plant::DecodesPerDraw,
            "uploads_per_frame" => Plant::UploadsPerFrame,
            "queue_without_cancel" => Plant::QueueWithoutCancel,
            "evictor_ignores_two_frames" => Plant::EvictorIgnoresTwoFrames,
            "decoder_holds_all_frames" => Plant::DecoderHoldsAllFrames,
            "decoder_ignores_orientation" => Plant::IgnoresOrientation,
            _ => return None,
        })
    }
}

/// The service's counts since it started.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Stats {
    /// Bytes and entries held, and the bound on bytes.
    pub bytes: u64,
    pub budget: u64,
    pub entries: u64,
    /// Requests queued or running.
    pub pending: u64,
    /// Levels made by decoding a source, and levels read back from the store.
    pub decoded: u64,
    pub read: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub evicted: u64,
    /// Time the finished decode jobs took, summed, ms.
    pub decode_ms: f64,
    /// Source files read from the store (#1485's count).
    pub source_reads: u64,
}

/// What a frame start leaves: the stats right after its eviction, and the bytes held that either
/// of the last two drawn frames drew.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Started {
    pub stats: Stats,
    pub drawn_bytes: u64,
}

/// One job a worker started: `decode` (from the source) or `read` (a stored level), for which
/// request, in which frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Job {
    pub op: &'static str,
    pub key: Key,
    pub frame: u64,
}

struct Held {
    level: Arc<Level>,
    /// The last frame that drew it, 0 if none has.
    drawn: u64,
    /// When it was last drawn or arrived, by the service's clock: eviction takes the oldest.
    used: u64,
}

/// #1489: an animation's frame source, and the bytes of pixels it held when it last made a frame,
/// read without waiting for a frame it is making.
type Source = (
    Arc<Mutex<animated::Player>>,
    Arc<std::sync::atomic::AtomicU64>,
);

/// #1489: one animation drawn at one crop, flip and level.
#[derive(Default)]
struct Stream {
    /// The frame last drawn exactly, which a frame not made yet shows instead.
    shown: Option<u32>,
    /// The frames of it the cache may hold.
    held: Vec<u32>,
}

/// The stream a key is one frame of.
fn stream(key: &Key) -> Key {
    Key { frame: 0, ..*key }
}

struct Queued {
    store: Arc<Store>,
    queue: Queue,
    seq: u64,
    pass: u64,
    rect: [f64; 4],
}

struct State {
    budget: u64,
    entries: usize,
    plant: Plant,
    frame: u64,
    pass: u64,
    /// The service's clock: each queued request and each use of a level ticks it.
    tick: u64,
    held: HashMap<Key, Held>,
    bytes: u64,
    queued: HashMap<Key, Queued>,
    running: HashSet<Key>,
    in_flight: u64,
    failed: HashMap<Key, Refused>,
    sizes: HashMap<[u8; 32], [u32; 2]>,
    /// #1489: each source probed as an animation, `None` for a still picture.
    animations: HashMap<[u8; 32], Option<Arc<animated::Animation>>>,
    /// #1489: each animation's stream (its key at frame 0): the frame it last drew exactly and the
    /// frames it may hold.
    streams: HashMap<Key, Stream>,
    /// #1489: the frame each animation was last asked for in, so a frame source no frame asks
    /// for is let go.
    asked: HashMap<[u8; 32], u64>,
    scratch: Vec<(u64, Key)>,
    /// Visible requests this pass that drew short of their level, and whether the last pass had any.
    short: u64,
    settling: bool,
    /// Whether the last frame start left the cache past its budget with only what the last two
    /// drawn frames drew: then no new request is queued until some of it ages out.
    full: bool,
    stats: Stats,
    jobs: Vec<Job>,
    threads: usize,
    /// How many workers start with the first queued request: min(cores − 1, 4).
    workers: usize,
    closed: bool,
}

struct Shared {
    state: Mutex<State>,
    /// Signalled when a job is queued or one finishes.
    work: Condvar,
    /// Signalled when a job finishes.
    done: Condvar,
    /// One writer at a time for an asset's proxy rows.
    rows: Mutex<()>,
    /// The last source a cut came from, kept for the next cell of the same atlas.
    source: Mutex<Option<([u8; 32], Arc<image::RgbaImage>)>>,
    /// #1489: one frame source for each animation a request reached, with the bytes it held when
    /// it last made a frame.
    players: Mutex<HashMap<[u8; 32], Source>>,
}

/// The image service. One serves a process; every path asks it.
pub struct Images {
    shared: Arc<Shared>,
}

/// The process's one image service: canonical renders, live frames and chrome thumbnails ask it.
pub fn shared() -> &'static Images {
    static IMAGES: std::sync::OnceLock<Images> = std::sync::OnceLock::new();
    IMAGES.get_or_init(Images::default)
}

impl Default for Images {
    fn default() -> Self {
        Images::new(BUDGET, ENTRIES)
    }
}

impl Drop for Images {
    fn drop(&mut self) {
        self.lock().closed = true;
        self.shared.work.notify_all();
    }
}

fn inside(outer: [f64; 4], inner: [f64; 4]) -> bool {
    inner[0] >= outer[0]
        && inner[1] >= outer[1]
        && inner[0] + inner[2] <= outer[0] + outer[2]
        && inner[1] + inner[3] <= outer[1] + outer[3]
}

fn lock(shared: &Shared) -> MutexGuard<'_, State> {
    shared.state.lock().unwrap_or_else(|p| p.into_inner())
}

impl Images {
    pub fn new(budget: u64, entries: usize) -> Images {
        let state = State {
            budget,
            entries,
            plant: Plant::None,
            frame: 2,
            pass: 0,
            tick: 0,
            held: HashMap::new(),
            bytes: 0,
            queued: HashMap::new(),
            running: HashSet::new(),
            in_flight: 0,
            failed: HashMap::new(),
            sizes: HashMap::new(),
            animations: HashMap::new(),
            streams: HashMap::new(),
            asked: HashMap::new(),
            scratch: Vec::new(),
            short: 0,
            settling: false,
            full: false,
            stats: Stats::default(),
            jobs: Vec::new(),
            threads: 0,
            workers: std::thread::available_parallelism()
                .map_or(2, |n| n.get())
                .saturating_sub(1)
                .clamp(1, 4),
            closed: false,
        };
        Images {
            shared: Arc::new(Shared {
                state: Mutex::new(state),
                work: Condvar::new(),
                done: Condvar::new(),
                rows: Mutex::new(()),
                source: Mutex::new(None),
                players: Mutex::new(HashMap::new()),
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        lock(&self.shared)
    }

    /// Sets the bounds and the planted program for the requests that follow.
    pub fn configure(&self, budget: u64, entries: usize, plant: Plant) {
        let _in = Inside::enter();
        let mut s = self.lock();
        s.budget = budget;
        s.entries = entries;
        s.plant = plant;
    }

    /// The picture's size from its header, read once per hash without decoding: `over_budget` when
    /// it couldn't be decoded within the caps.
    pub fn size(&self, store: &Store, hash: &[u8; 32]) -> Result<[u32; 2], Refused> {
        let _in = Inside::enter();
        let plant = {
            let s = self.lock();
            match s.sizes.get(hash) {
                Some(size) if s.plant != Plant::DecodesBeforeHeader => return Ok(*size),
                _ => s.plant,
            }
        };
        let decodes_first = plant == Plant::DecodesBeforeHeader;
        let ignores = plant == Plant::IgnoresOrientation;
        let size = source::header(store, hash, decodes_first, ignores)?;
        let mut s = self.lock();
        if decodes_first {
            s.stats.source_reads += 1;
        }
        s.sizes.insert(*hash, size);
        Ok(size)
    }

    /// #1489: the source as an animation, probed once per hash from its blocks, or `None` for a
    /// still picture; `over_budget` when its canvas couldn't be decoded within the caps.
    pub fn animation(
        &self,
        store: &Store,
        hash: &[u8; 32],
    ) -> Result<Option<Arc<animated::Animation>>, Refused> {
        let _in = Inside::enter();
        if let Some(known) = self.lock().animations.get(hash) {
            return Ok(known.clone());
        }
        // Only a file that starts as a GIF, a WebP or a PNG is read whole: a video never is.
        let head = store.head(hash, 12).unwrap_or_default();
        let read = animated::may_animate(&head);
        let probed = match read {
            true => animated::probe(&store.read(hash)?).map(Arc::new),
            false => None,
        };
        if probed.as_ref().is_some_and(|a| !source::fits(a.size)) {
            return Err(source::refused("over_budget"));
        }
        let mut s = self.lock();
        s.stats.source_reads += u64::from(read);
        if let Some(a) = &probed {
            s.sizes.insert(*hash, a.size);
        }
        s.animations.insert(*hash, probed.clone());
        Ok(probed)
    }

    /// #1489: the bytes of pixels each animation holds, by its hash, into `held`: its frame
    /// source's canvas and what its decoder keeps, and the levels of its frames the cache holds.
    pub fn animations_held(&self, held: &mut HashMap<[u8; 32], u64>) {
        let _in = Inside::enter();
        held.clear();
        {
            let s = self.lock();
            for (stream, kept) in &s.streams {
                let levels: u64 = (kept.held.iter())
                    .filter_map(|f| {
                        s.held.get(&Key {
                            frame: *f,
                            ..*stream
                        })
                    })
                    .map(|h| h.level.bytes())
                    .sum();
                *held.entry(stream.hash).or_default() += levels;
            }
        }
        let players = self
            .shared
            .players
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        for (hash, (_, bytes)) in players.iter() {
            *held.entry(*hash).or_default() += bytes.load(std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// The frames started so far, by the service's count.
    pub fn frame(&self) -> u64 {
        self.lock().frame
    }

    /// A drawn frame starts: what the cache holds past its bounds is evicted, least recently used
    /// first, never what the last two drawn frames drew; the stats and the bytes those two frames
    /// drew, as the eviction leaves them.
    pub fn frame_start(&self) -> Started {
        let _in = Inside::enter();
        let mut s = self.lock();
        s.frame += 1;
        s.evict();
        s.full = s.bytes > s.budget;
        let keep_from = s.frame - 2;
        let drawn_bytes = (s.held.values())
            .filter(|h| h.drawn >= keep_from)
            .map(|h| h.level.bytes())
            .sum();
        // #1489: a frame source no frame asked for in the last two is let go.
        let gone: Vec<[u8; 32]> = (s.asked.iter())
            .filter(|(_, at)| **at < keep_from)
            .map(|(h, _)| *h)
            .collect();
        let started = Started {
            stats: s.snapshot(),
            drawn_bytes,
        };
        if !gone.is_empty() {
            s.asked.retain(|_, at| *at >= keep_from);
            drop(s);
            let mut players = self
                .shared
                .players
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            players.retain(|h, _| !gone.contains(h));
        }
        started
    }

    /// A live frame's request: the level if held, else the nearest level held or nothing, with the
    /// request queued unless the cache is past its budget with what it may not evict. Never
    /// blocks; allocates nothing once its level is held.
    pub fn show(&self, store: &Arc<Store>, key: Key, queue: Queue, rect: [f64; 4]) -> Shown {
        let _in = Inside::enter();
        let mut s = self.lock();
        let (frame, tick) = (s.frame, s.tick + 1);
        // #1489: an animation's frame source stays while frames ask for it.
        let animated = s.animations.get(&key.hash).is_some_and(Option::is_some);
        if animated {
            *s.asked.entry(key.hash).or_default() = frame;
        }
        if let Some(h) = s.held.get_mut(&key) {
            let visible = queue == Queue::Visible;
            if visible {
                (h.drawn, h.used) = (frame, tick);
            }
            let level = h.level.clone();
            if visible {
                s.tick = tick;
                if animated {
                    s.drew_frame(key);
                }
            }
            return Shown::Exact(level);
        }
        if s.failed.contains_key(&key) {
            return Shown::Nothing;
        }
        let pass = s.pass;
        let running = s.running.contains(&key);
        let full = s.full;
        let mut started = false;
        match s.queued.get_mut(&key) {
            Some(q) => {
                q.pass = pass;
                q.rect = rect;
                if queue == Queue::Visible && q.queue == Queue::Prefetch {
                    q.queue = Queue::Visible;
                    q.seq = tick;
                    s.tick = tick;
                }
            }
            None if !running && !full => {
                s.tick = tick;
                let store = store.clone();
                (s.queued).insert(
                    key,
                    Queued {
                        store,
                        queue,
                        seq: tick,
                        pass,
                        rect,
                    },
                );
                started = true;
            }
            None => {}
        }
        if started {
            self.start(&mut s);
            self.shared.work.notify_one();
        }
        if queue == Queue::Prefetch {
            return Shown::Nothing;
        }
        s.short += 1;
        // #1489: a frame not made yet shows the frame its animation last drew.
        if let Some(f) = (s.streams.get(&stream(&key))).and_then(|t| t.shown) {
            if let Some(h) = s.held.get_mut(&Key { frame: f, ..key }) {
                h.drawn = frame;
                return Shown::Frame(h.level.clone(), f);
            }
        }
        for d in 1..=level::DEEPEST {
            for k in [key.level.checked_sub(d), key.level.checked_add(d)] {
                let Some(k) = k.filter(|k| *k <= level::DEEPEST) else {
                    continue;
                };
                if let Some(h) = s.held.get_mut(&Key { level: k, ..key }) {
                    h.drawn = frame;
                    return Shown::Nearest(h.level.clone(), k);
                }
            }
        }
        Shown::Nothing
    }

    /// A view pass that looked at everything inside `covered` ends: each queued request inside it
    /// the pass didn't ask for again is cancelled before it runs.
    pub fn pass_ended(&self, covered: [f64; 4]) {
        let _in = Inside::enter();
        let mut s = self.lock();
        let pass = s.pass;
        if s.plant != Plant::QueueWithoutCancel {
            let before = s.queued.len();
            s.queued
                .retain(|_, q| q.pass == pass || !inside(covered, q.rect));
            s.stats.cancelled += (before - s.queued.len()) as u64;
        }
        s.settling = s.short > 0;
        s.short = 0;
        s.pass += 1;
    }

    /// Whether the last pass drew a visible request short of its level.
    pub fn settling(&self) -> bool {
        let s = self.lock();
        s.settling || s.short > 0
    }

    /// Why `key` couldn't be made, if a job failed on it.
    pub fn failed(&self, key: &Key) -> Option<Refused> {
        let _in = Inside::enter();
        self.lock().failed.get(key).copied()
    }

    /// The exact level, made on this thread when no worker is making it: a canonical render, an
    /// export or a check waits for every picture it draws.
    pub fn wait(&self, store: &Arc<Store>, key: Key) -> Result<Arc<Level>, Refused> {
        let _in = Inside::enter();
        let mut s = self.lock();
        if s.plant == Plant::DecodesPerDraw {
            if let Some(h) = s.held.remove(&key) {
                s.bytes -= h.level.bytes();
            }
        }
        if s.animations.get(&key.hash).is_some_and(Option::is_some) {
            let frame = s.frame;
            *s.asked.entry(key.hash).or_default() = frame;
        }
        loop {
            let (frame, tick) = (s.frame, s.tick + 1);
            if let Some(h) = s.held.get_mut(&key) {
                (h.drawn, h.used) = (frame, tick);
                let level = h.level.clone();
                s.tick = tick;
                if s.animations.get(&key.hash).is_some_and(Option::is_some) {
                    s.drew_frame(key);
                }
                return Ok(level);
            }
            if let Some(r) = s.failed.get(&key) {
                return Err(*r);
            }
            if s.running.contains(&key) {
                s = self.shared.done.wait(s).unwrap_or_else(|p| p.into_inner());
                continue;
            }
            s.queued.remove(&key);
            s.running.insert(key);
            let plant = s.plant;
            let animated = s.animations.get(&key.hash).is_some_and(Option::is_some);
            drop(s);
            let made = make(&self.shared, store, (key, animated), plant);
            s = self.lock();
            s.running.remove(&key);
            let level = s.finish(key, made);
            if let Some(h) = s.held.get_mut(&key) {
                h.drawn = frame;
            }
            if level.is_ok() && s.animations.get(&key.hash).is_some_and(Option::is_some) {
                s.drew_frame(key);
            }
            self.shared.done.notify_all();
            self.shared.work.notify_all();
            return level;
        }
    }

    /// Drops every queued request no worker started and waits for the running ones to finish, so
    /// every level made is kept and counted.
    pub fn drain(&self) {
        let _in = Inside::enter();
        let mut s = self.lock();
        s.queued.clear();
        while !s.running.is_empty() {
            s = self.shared.done.wait(s).unwrap_or_else(|p| p.into_inner());
        }
    }

    pub fn stats(&self) -> Stats {
        self.lock().snapshot()
    }

    /// Every job the workers started, in the order they started.
    pub fn jobs(&self) -> Vec<Job> {
        self.lock().jobs.clone()
    }

    fn start(&self, s: &mut State) {
        // The web player's one thread decodes each level itself, before it's ready (#172).
        if s.threads > 0 || cfg!(target_arch = "wasm32") {
            return;
        }
        s.threads = s.workers;
        for i in 0..s.threads {
            let shared = self.shared.clone();
            let _ = std::thread::Builder::new()
                .name(format!("deep-images-{i}"))
                .spawn(move || work(&shared));
        }
    }
}

impl State {
    fn snapshot(&self) -> Stats {
        Stats {
            bytes: self.bytes,
            budget: self.budget,
            entries: self.held.len() as u64,
            pending: (self.queued.len() + self.running.len()) as u64,
            ..self.stats
        }
    }

    /// Evicts least recently used first until within the bounds, keeping what the last two drawn
    /// frames drew; #1486 AC4's wrong program keeps nothing.
    fn evict(&mut self) {
        if self.bytes <= self.budget && self.held.len() <= self.entries {
            return;
        }
        let keep_from = match self.plant {
            Plant::EvictorIgnoresTwoFrames => u64::MAX,
            _ => self.frame - 2,
        };
        let mut order = std::mem::take(&mut self.scratch);
        order.clear();
        order.extend(
            (self.held.iter())
                .filter(|(_, h)| h.drawn < keep_from)
                .map(|(k, h)| (h.used, *k)),
        );
        order.sort_unstable_by_key(|(used, _)| *used);
        for (_, key) in order.drain(..) {
            if self.bytes <= self.budget && self.held.len() <= self.entries {
                break;
            }
            if let Some(h) = self.held.remove(&key) {
                self.bytes -= h.level.bytes();
                self.stats.evicted += 1;
            }
        }
        self.scratch = order;
    }

    /// #1489: the frames of `key`'s animation stream the cache holds, but `key`'s own and the frame
    /// the stream last drew, are let go: an animation holds the frame shown and the one made next,
    /// never every frame's level. A frame drawn needs no level once drawn: its sprite is its own.
    fn stale_frames(&mut self, key: Key) {
        let kept = self.streams.entry(stream(&key)).or_default();
        let shown = kept.shown;
        let mut frames = std::mem::take(&mut kept.held);
        frames.retain(|f| {
            let k = Key { frame: *f, ..key };
            if *f == key.frame || Some(*f) == shown {
                return *f != key.frame && self.held.contains_key(&k);
            }
            if let Some(h) = self.held.remove(&k) {
                self.bytes -= h.level.bytes();
                self.stats.evicted += 1;
            }
            false
        });
        frames.push(key.frame);
        if let Some(stream) = self.streams.get_mut(&stream(&key)) {
            stream.held = frames;
        }
    }

    /// #1489: `key`'s frame is drawn exactly: it is the frame its stream shows, and the frame it
    /// showed before goes.
    fn drew_frame(&mut self, key: Key) {
        let Some(stream) = self.streams.get_mut(&stream(&key)) else {
            return;
        };
        let before = stream.shown.replace(key.frame);
        if let Some(f) = before.filter(|f| *f != key.frame) {
            stream.held.retain(|h| *h != f);
            if let Some(h) = self.held.remove(&Key { frame: f, ..key }) {
                self.bytes -= h.level.bytes();
                self.stats.evicted += 1;
            }
        }
    }

    fn finish(
        &mut self,
        key: Key,
        made: Result<(Level, bool, f64), Refused>,
    ) -> Result<Arc<Level>, Refused> {
        match made {
            Ok((level, decoded, ms)) => {
                if decoded {
                    self.stats.decoded += 1;
                    self.stats.decode_ms += ms;
                } else {
                    self.stats.read += 1;
                }
                self.tick += 1;
                self.bytes += level.bytes();
                let level = Arc::new(level);
                let held = Held {
                    level: level.clone(),
                    drawn: 0,
                    used: self.tick,
                };
                if let Some(old) = self.held.insert(key, held) {
                    self.bytes -= old.level.bytes();
                }
                if self.animations.get(&key.hash).is_some_and(Option::is_some) {
                    self.stale_frames(key);
                }
                Ok(level)
            }
            Err(r) => {
                self.stats.failed += 1;
                self.failed.insert(key, r);
                Err(r)
            }
        }
    }

    /// The queued request a worker takes next: visible before prefetch, newest first, and none
    /// whose source would take the bytes in flight past the bound while another job runs.
    fn next(&self) -> Option<Key> {
        let best = |queue| {
            (self.queued.iter())
                .filter(|(_, q)| q.queue == queue)
                .max_by_key(|(_, q)| q.seq)
                .map(|(k, _)| *k)
        };
        let key = best(Queue::Visible).or_else(|| best(Queue::Prefetch))?;
        let cost = self.cost(&key);
        (self.running.is_empty() || self.in_flight + cost <= IN_FLIGHT).then_some(key)
    }

    fn cost(&self, key: &Key) -> u64 {
        self.sizes
            .get(&key.hash)
            .map_or(0, |[w, h]| u64::from(*w) * u64::from(*h) * 4)
    }
}

fn work(shared: &Arc<Shared>) {
    // A worker runs nothing but the service's own code.
    let _in = Inside::enter();
    let mut s = lock(shared);
    loop {
        if s.closed {
            return;
        }
        let Some(key) = s.next() else {
            s = shared.work.wait(s).unwrap_or_else(|p| p.into_inner());
            continue;
        };
        let Some(q) = s.queued.remove(&key) else {
            continue;
        };
        let cost = s.cost(&key);
        s.running.insert(key);
        s.in_flight += cost;
        let plant = s.plant;
        let animated = s.animations.get(&key.hash).is_some_and(Option::is_some);
        drop(s);
        let made = make(shared, &q.store, (key, animated), plant);
        s = lock(shared);
        s.running.remove(&key);
        s.in_flight -= cost;
        let _ = s.finish(key, made);
        shared.done.notify_all();
        shared.work.notify_all();
    }
}

/// The proxy rows of the sources whose hash starts with one byte (the store's file it is kept in):
/// one line per stored level,
/// `source level x y w h flip tool sha256`.
pub fn rows_file(hash: &[u8; 32]) -> String {
    format!("proxies/{:02x}", hash[0])
}

/// The proxy row that names `key`'s stored level (#172: the web player's bundle carries it).
pub fn row_of(key: &Key) -> String {
    let [x, y, w, h] = key.crop;
    let source = source::hex(&key.hash);
    format!("{source} {} {x} {y} {w} {h} {} {TOOL}", key.level, key.flip)
}

/// The stored level a proxy row names for `key`, if any.
fn stored(store: &Store, key: &Key) -> Option<Level> {
    let rows = store.text(&rows_file(&key.hash))?;
    let want = row_of(key);
    let sha = rows.lines().find_map(|line| {
        let (row, sha) = line.rsplit_once(' ')?;
        (row == want).then(|| hash_of(sha)).flatten()
    })?;
    let blob = store.read(&sha).ok()?;
    Level::from_blob(&blob, sha)
}

fn log(shared: &Shared, op: &'static str, key: Key) {
    let mut s = lock(shared);
    let frame = s.frame;
    if s.jobs.len() < 1 << 20 {
        s.jobs.push(Job { op, key, frame });
    }
}

/// The decoded source of `key`: an atlas cell reuses the source the last cut came from.
fn source_of(
    shared: &Shared,
    store: &Store,
    key: &Key,
    plant: Plant,
) -> Result<Arc<image::RgbaImage>, Refused> {
    let last = || shared.source.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((hash, rgba)) = last().as_ref() {
        if *hash == key.hash {
            return Ok(rgba.clone());
        }
    }
    let bytes = store.read(&key.hash)?;
    lock(shared).stats.source_reads += 1;
    let rgba = Arc::new(source::decode(&bytes, plant == Plant::IgnoresOrientation)?);
    if key.crop != [0, 0, rgba.width(), rgba.height()] {
        *last() = Some((key.hash, rgba.clone()));
    }
    Ok(rgba)
}

/// #1489: `key`'s level of one frame of an animation, made from the animation's frame source (one
/// per source, opened on first need), whose canvas then moves on to the next frame. A frame's
/// level is never stored: the frames are made again in order.
fn frame_level(shared: &Shared, store: &Store, key: Key, plant: Plant) -> Result<Level, Refused> {
    let players = || shared.players.lock().unwrap_or_else(|p| p.into_inner());
    let found = players().get(&key.hash).cloned();
    let (player, held) = match found {
        Some(source) => source,
        None => {
            let bytes: Arc<[u8]> = Arc::from(store.read(&key.hash)?);
            lock(shared).stats.source_reads += 1;
            let opened = animated::Player::open(bytes, plant == Plant::DecoderHoldsAllFrames)?;
            let player = opened.ok_or(source::refused("asset_undecodable"))?;
            let made = (Arc::new(Mutex::new(player)), Arc::default());
            players().entry(key.hash).or_insert(made).clone()
        }
    };
    let mut player = player.lock().unwrap_or_else(|p| p.into_inner());
    let [w, h] = player.animation.size;
    let [x, y, cw, ch] = key.crop;
    if u64::from(x) + u64::from(cw) > u64::from(w) || u64::from(y) + u64::from(ch) > u64::from(h) {
        return Err(Refused {
            code: "out_of_range",
            on_crop: true,
        });
    }
    let picture = player.frame(key.frame as usize)?;
    let level = if key.crop == [0, 0, w, h] && key.flip == 0 {
        reduce(picture, key.shown(), key.level)
    } else {
        let whole = image::RgbaImage::from_raw(w, h, picture.to_vec())
            .ok_or(source::refused("asset_undecodable"))?;
        let cut = image::imageops::crop_imm(&whole, x, y, cw, ch).to_image();
        reduce(
            source::flipped(cut, key.flip).as_raw(),
            key.shown(),
            key.level,
        )
    };
    // The next frame is made while this one shows; a failure there is the next request's.
    let _ = player.ahead(true);
    held.store(player.held(), std::sync::atomic::Ordering::Relaxed);
    Ok(level)
}

/// Makes `key`'s level: read back from the store when a proxy row names it, else decoded from the
/// source, reduced, and stored with its row. Whether it decoded, and how long it took, ms.
fn make(
    shared: &Shared,
    store: &Store,
    (key, animated): (Key, bool),
    plant: Plant,
) -> Result<(Level, bool, f64), Refused> {
    let start = Instant::now();
    if animated {
        log(shared, "decode", key);
        let level = frame_level(shared, store, key, plant)?;
        return Ok((level, true, start.elapsed().as_secs_f64() * 1000.0));
    }
    if plant != Plant::DecodesPerDraw {
        if let Some(level) = stored(store, &key) {
            log(shared, "read", key);
            return Ok((level, false, 0.0));
        }
    }
    log(shared, "decode", key);
    let decoded = source_of(shared, store, &key, plant)?;
    let [x, y, w, h] = key.crop;
    if u64::from(x) + u64::from(w) > u64::from(decoded.width())
        || u64::from(y) + u64::from(h) > u64::from(decoded.height())
    {
        return Err(Refused {
            code: "out_of_range",
            on_crop: true,
        });
    }
    let level = if key.crop == [0, 0, decoded.width(), decoded.height()] && key.flip == 0 {
        reduce(decoded.as_raw(), key.shown(), key.level)
    } else {
        let cut = image::imageops::crop_imm(&*decoded, x, y, w, h).to_image();
        let rgba = source::flipped(cut, key.flip);
        reduce(rgba.as_raw(), key.shown(), key.level)
    };
    if plant != Plant::DecodesPerDraw && store.write(&level.sha256, &level.blob()).is_ok() {
        let _one = shared.rows.lock().unwrap_or_else(|p| p.into_inner());
        let path = rows_file(&key.hash);
        let mut rows = store.text(&path).unwrap_or_default();
        rows.push_str(&format!(
            "{} {}\n",
            row_of(&key),
            source::hex(&level.sha256)
        ));
        let _ = store.put_text(&path, &rows);
    }
    Ok((level, true, start.elapsed().as_secs_f64() * 1000.0))
}

#[cfg(test)]
mod tests;
