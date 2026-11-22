//! A world from a saved state (`module`), and the worlds and instances a seek, save or fork loads.

use super::*;

impl World {
    /// Every item's whole state as plain data: what a canvas module carries between steps
    /// (`module`). Entries still waiting stay with it; its place on the track doesn't, since the
    /// world that loads it reads a track of its own.
    pub fn saved(&mut self) -> Value {
        World::saved_of(&self.snapshot())
    }

    /// A world on `track` holding the state `saved` gave, each item in a fresh instance; the start
    /// function and `init` never run again.
    pub fn from_saved(
        piece: Rc<Piece>,
        track: Track,
        saved: &Value,
        planted: Planted,
    ) -> Result<World, Failed> {
        let bad =
            || json!({"ok": false, "code": "bad_input", "what": "a saved state of another piece"});
        let unhex = |v: &Value| -> Option<Vec<u8>> {
            let s = v.as_str()?.as_bytes();
            let digit = |c: u8| char::from(c).to_digit(16);
            (s.len() % 2 == 0).then_some(())?;
            (s.chunks_exact(2))
                .map(|p| Some((digit(p[0])? * 16 + digit(p[1])?) as u8))
                .collect()
        };
        let mut lives = Vec::new();
        for (item, s) in piece.items.iter().zip(saved.as_array().ok_or_else(bad)?) {
            let globals: Vec<Val> = s["globals"]
                .as_array()
                .ok_or_else(bad)?
                .iter()
                .map(|g| match (g[0].as_str(), &g[1]) {
                    (Some("i32"), x) => x.as_i64().map(|x| Val::I32(x as i32)),
                    (Some("i64"), x) => x.as_i64().map(Val::I64),
                    (Some("f32"), x) => x.as_u64().map(|x| Val::F32(x as u32)),
                    (Some("f64"), x) => x.as_u64().map(Val::F64),
                    _ => None,
                })
                .collect::<Option<_>>()
                .ok_or_else(bad)?;
            let memory = unhex(&s["memory"]).ok_or_else(bad)?;
            let mut live = World::load(&item.bytes, item, &memory, &globals)?;
            live.next = s["next"].as_i64().ok_or_else(bad)?;
            // Its place on this track: past every entry the steps it ran took.
            let ran = (live.next - 1) * item.step;
            for r in item
                .layout
                .entries
                .iter()
                .filter(|r| matches!(r.read, Read::Control | Read::Reading { .. }))
            {
                let n = track
                    .get(&r.name)
                    .map_or(0, |l| l.partition_point(|e| e.t <= ran));
                live.cursor.insert(r.name.clone(), n);
            }
            live.failed = s["failed"].as_bool().ok_or_else(bad)?;
            live.arrays = unhex(&s["arrays"]).ok_or_else(bad)?;
            if let Some(p) = &item.pages {
                let store = crate::pages::new_store(p, planted.page_store);
                live.paged =
                    Some(crate::pages::State::from_json(p, store, &s["pages"]).ok_or_else(bad)?);
            }
            for (k, q) in s["pending"].as_object().into_iter().flatten() {
                let q: VecDeque<Entry> = q
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Entry::parse)
                    .collect();
                live.pending.insert(k.clone(), q);
            }
            lives.push(live);
        }
        if lives.len() != piece.items.len() {
            return Err(bad());
        }
        let published = lives.iter().map(|l| l.arrays.clone()).collect();
        Ok(World {
            piece,
            track,
            lives,
            published,
            store: false,
            cache: None,
            planted,
            saves_dir: None,
            held: None,
            saves_ns: 0,
            saved: Vec::new(),
            seen: 0,
            adapter: String::new(),
            branches: Branches::default(),
            draw: Default::default(),
        })
    }

    /// A world of the piece's items in these states, as a seek or an opened save starts.
    pub(crate) fn of(
        piece: Rc<Piece>,
        track: Track,
        lives: Vec<Live>,
        planted: Planted,
        seen: u64,
    ) -> World {
        let published = lives.iter().map(|l| l.arrays.clone()).collect();
        World {
            store: piece.rewind.is_some(),
            piece,
            track,
            lives,
            published,
            planted,
            saves_dir: None,
            held: None,
            saves_ns: 0,
            saved: Vec::new(),
            seen,
            adapter: String::new(),
            cache: None,
            branches: Branches::default(),
            draw: Default::default(),
        }
    }

    pub(crate) fn load(
        bytes: &[u8],
        item: &Item,
        memory: &[u8],
        globals: &[Val],
    ) -> Result<Live, Failed> {
        let mut runner = World::runner(bytes, &item.id)?;
        let names = Rc::new(names(bytes));
        runner
            .memory_mut("memory")
            .expect("a memory")
            .copy_from_slice(memory);
        for ((n, _), v) in names.globals.iter().zip(globals) {
            runner.set(n, *v).map_err(
                |e| json!({"ok": false, "code": "run_failed", "item": item.id, "what": e}),
            )?;
        }
        let pages = (memory.len() as u64).div_ceil(PAGE) as u32;
        Ok(Live {
            runner,
            names,
            failed: false,
            next: 0,
            ran: 0,
            last: -1,
            arrays: Vec::new(),
            prev: Vec::new(),
            cursor: BTreeMap::new(),
            pending: BTreeMap::new(),
            mirrors: Vec::new(),
            late: false,
            filled: None,
            mirror_ns: 0,
            read_ns: 0,
            pages_ns: 0,
            asked: None,
            // The restore wrote every page.
            dirty: (0..pages).collect(),
            kdirty: (0..pages).collect(),
            rdirty: (0..pages).collect(),
            stored: Vec::new(),
            checked: None,
            spacing: item.every,
            rerun: false,
            spare: None,
            previewed: None,
            preview: preview_region(item),
            paged: None,
        })
    }
}
