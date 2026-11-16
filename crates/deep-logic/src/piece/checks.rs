use super::*;

pub(super) fn declared(id: &str, params: &Map<String, Value>) -> Result<Declared, Refused> {
    let bad = |field: &str, what: String| {
        logic_refused(id, vec![refusal("field", what, json!({"field": field}))])
    };
    for k in params.keys() {
        if LATER.contains(&k.as_str()) {
            return Err(bad(k, format!("{k} isn't built yet in logic@1 (#531 builds the fixed step, its regions, seeds and traps)")));
        }
        if ![
            "program",
            "debug",
            "step_rate",
            "clock",
            "due",
            "reads",
            "writes",
            "budget",
            "checkpoint",
            "assets",
            "links",
            "saves",
            "emits",
            "services",
            "mirrors",
            "preview",
        ]
        .contains(&k.as_str())
        {
            return Err(bad(k, format!("logic@1 has no field {k}")));
        }
    }
    let program = params
        .get("program")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            bad(
                "program",
                "a logic item names its program by asset ID".into(),
            )
        })?
        .to_string();
    let debug = params
        .get("debug")
        .and_then(Value::as_str)
        .map(str::to_string);
    let hz = params.get("step_rate").map_or(Some(60.0), Value::as_f64);
    let step = hz
        .ok_or_else(|| bad("step_rate", "step_rate is a number of hertz".into()))
        .and_then(|hz| deep_canvas::time::step_length(hz).map_err(|e| bad("step_rate", e)))?;
    let reads: Vec<String> = match params.get("reads") {
        None => Vec::new(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|r| r.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("reads", "reads is a list of IDs and array paths".into()))?,
        Some(_) => {
            return Err(bad(
                "reads",
                "reads is a list of IDs and array paths".into(),
            ))
        }
    };
    let mut writes = Vec::new();
    let mut refused = Vec::new();
    for (name, w) in params
        .get("writes")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !own_name(name) {
            refused.push(refusal(
                "write",
                format!("{name} isn't the item's own array: a logic item writes only its own arrays, never a status color, another module's array, a check or the record"),
                json!({"write": name}),
            ));
            continue;
        }
        let ty = w.get("type").and_then(Value::as_str).and_then(Ty::named);
        let count = w
            .get("count")
            .map_or(Some(1), Value::as_u64)
            .filter(|c| *c >= 1 && *c <= u32::MAX as u64);
        let interpolate = w.get("interpolate").map_or(Some("hold"), Value::as_str);
        match (ty, count, interpolate) {
            (Some(ty), Some(_), Some("linear")) if !ty.blends() => refused.push(refusal(
                "write",
                format!("{name} is a {}, which never blends: interpolate: linear is only for f64, vec2, vec3 and quat arrays", ty.name()),
                json!({"write": name}),
            )),
            (Some(ty), Some(count), Some(i @ ("hold" | "linear"))) => writes.push(Write {
                name: name.clone(),
                ty,
                count: count as u32,
                linear: i == "linear",
            }),
            _ => refused.push(refusal(
                "write",
                format!("{name} declares a type, a count of at least 1 and hold or linear"),
                json!({"write": name}),
            )),
        }
    }
    // Sized in u64 and held to the largest memory, so no region's size or offset passes a u32.
    let total: u64 = writes
        .iter()
        .map(|w: &Write| (u64::from(w.ty.size()) * u64::from(w.count)).div_ceil(8) * 8)
        .sum();
    if total > 64 * MIB {
        refused.push(refusal(
            "write",
            "the writes pass a logic item's largest memory, 64 MiB".into(),
            json!({}),
        ));
    }
    let emits = emits_of(params.get("emits")).unwrap_or_else(|r| {
        refused.extend(r);
        Vec::new()
    });
    let preview = match params.get("preview") {
        None => None,
        Some(p) => preview_of(p).map_or_else(
            |r| {
                refused.extend(r);
                None
            },
            Some,
        ),
    };
    if preview.is_some() && writes.iter().any(|w| w.name == "preview") {
        refused.push(refusal(
            "write",
            "an item with a preview can't write an array named preview: <logic ID>.preview.<name> are its preview arrays".into(),
            json!({"write": "preview"}),
        ));
    }
    if !emits.is_empty() && writes.iter().any(|w| w.name == "occurrences") {
        refused.push(refusal(
            "write",
            "an item that emits can't write an array named occurrences: <logic ID>.occurrences is its occurrence list".into(),
            json!({"write": "occurrences"}),
        ));
    }
    if !refused.is_empty() {
        return Err(logic_refused(id, refused));
    }
    let turn = match params.get("clock") {
        None => false,
        Some(c) => match c.as_str() {
            Some("fixed") => false,
            Some("on_input") => true,
            _ => return Err(bad("clock", "clock is fixed or on_input".into())),
        },
    };
    let due = match params.get("due") {
        None => None,
        Some(v) => {
            let name = v.as_str().unwrap_or_default();
            let own = writes
                .iter()
                .any(|w| w.name == name && w.ty == Ty::I32 && w.count == 1);
            if !turn || !own {
                return Err(bad("due", format!("due names one of the item's own i32 arrays of count 1, with clock: on_input; {v} isn't")));
            }
            Some(name.to_string())
        }
    };
    fn get<'a>(o: Option<&'a Value>, k: &str) -> Option<&'a Value> {
        o.and_then(|b| b.get(k))
    }
    let budget = params.get("budget");
    let num = |k: &str, d: u64, max: u64| -> Result<u64, Refused> {
        match get(budget, k) {
            None => Ok(d),
            Some(v) => v.as_u64().filter(|n| *n >= 1 && *n <= max).ok_or_else(|| {
                bad(
                    &format!("budget/{k}"),
                    format!("budget.{k} is at most {max}"),
                )
            }),
        }
    };
    let fuel = num("fuel", FUEL.0, FUEL.1)? as i64;
    let memory = num("memory", MEMORY_MIB.0, MEMORY_MIB.1)? * MIB;
    let stack = num("stack", STACK_KIB.0, STACK_KIB.1)? as i32 * 1024;
    let every = match get(params.get("checkpoint"), "every") {
        None => 60,
        Some(v) => v.as_i64().filter(|n| *n >= 1).ok_or_else(|| {
            bad(
                "checkpoint/every",
                "checkpoint.every is a number of steps".into(),
            )
        })?,
    };
    let ring = match get(params.get("checkpoint"), "budget") {
        None => 64 * MIB,
        Some(v) => v.as_u64().filter(|n| *n >= 1).ok_or_else(|| {
            bad(
                "checkpoint/budget",
                "checkpoint.budget is a number of bytes".into(),
            )
        })?,
    };
    let assets: Vec<String> = match params.get("assets") {
        None => Vec::new(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|r| r.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("assets", "assets is a list of asset IDs".into()))?,
        Some(_) => return Err(bad("assets", "assets is a list of asset IDs".into())),
    };
    let links = links::declared(params.get("links"))
        .ok_or_else(|| bad("links", "links is a list of {name, asset}".into()))?;
    let services =
        crate::services::declared(params.get("services")).map_err(|e| bad("services", e))?;
    let mirrors = crate::mirrors::declared(params.get("mirrors")).map_err(|e| bad("mirrors", e))?;
    Ok(Declared {
        links,
        program,
        debug,
        step,
        turn,
        due,
        reads,
        writes,
        fuel,
        memory,
        stack,
        every,
        ring,
        assets,
        saves: params.get("saves").cloned(),
        emits,
        services,
        mirrors,
        preview,
        given: Value::Object(params.clone()).to_string(),
    })
}

/// A preview's declared reads and writes (Logic: preview): control IDs or a control's `hover`,
/// and arrays of bool, i32, f64, vec2 or vec3, never quat or interpolated.
pub(super) fn preview_of(v: &Value) -> Result<(Vec<String>, Vec<Write>), Vec<Value>> {
    let what = |w: String| refusal("preview", w, json!({"field": "preview"}));
    let Some(o) = v.as_object() else {
        return Err(vec![what("preview is {reads, writes}".into())]);
    };
    if let Some(k) = o
        .keys()
        .find(|k| !["reads", "writes"].contains(&k.as_str()))
    {
        return Err(vec![what(format!("preview has no field {k}"))]);
    }
    let reads: Vec<String> = o
        .get("reads")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(|r| r.as_str().map(str::to_string)).collect())
        .ok_or_else(|| vec![what("preview.reads is a list of control IDs".into())])?;
    let mut writes = Vec::new();
    let mut refused = Vec::new();
    for (name, w) in o
        .get("writes")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let ty = w.get("type").and_then(Value::as_str).and_then(Ty::named);
        let count = w
            .get("count")
            .map_or(Some(1), Value::as_u64)
            .filter(|c| *c >= 1 && *c <= u32::MAX as u64);
        let extra = w
            .as_object()
            .into_iter()
            .flatten()
            .any(|(k, _)| k != "type" && k != "count");
        match (ty, count) {
            (Some(ty), Some(count)) if own_name(name) && ty != Ty::Quat && !extra => {
                writes.push(Write { name: name.clone(), ty, count: count as u32, linear: false })
            }
            _ => refused.push(what(format!(
                "preview write {name} is an own name with a type of bool, i32, f64, vec2 or vec3 and a count of at least 1"
            ))),
        }
    }
    if refused.is_empty() {
        Ok((reads, writes))
    } else {
        Err(refused)
    }
}

/// Item `idx`'s region map (Logic `logic@1`: Region map) from the declarations alone, before
/// its program is read: reads, each mirror's range list, the step's seed, writes, then the kinds
/// it emits, each in declaration order; the refusals of reads and mirrors that name nothing it
/// may read; and its mirrors, resolved (Logic: mirror reads).
pub(super) fn region_map(
    idx: usize,
    decls: &[(String, Declared)],
    controls: &Controls,
    sources: &Sources,
    planted: &Planted,
) -> (Layout, Vec<Value>, Vec<crate::mirrors::Mirror>) {
    let d = &decls[idx].1;
    let mut entries = Vec::new();
    let mut at = 0u32;
    let mut refused = Vec::new();
    let writers: Vec<(&str, &[Write])> = decls
        .iter()
        .map(|(id, d)| (id.as_str(), d.writes.as_slice()))
        .collect();
    let mirrors = crate::mirrors::resolved(&d.mirrors, idx, &writers, &mut refused);
    if planted.mirror_lists_first {
        at = crate::mirrors::listed(&mirrors, at, &mut entries);
    }
    // The planted map lays the reads out by name rather than in declaration order.
    let mut reads = d.reads.clone();
    if planted.map_reads_by_name {
        reads.sort();
    }
    for r in &reads {
        let (size, ty, read) = if let Some((size, ty)) = controls.get(r) {
            (*size, ty.to_string(), Read::Control)
        } else if let Some(read) = sources.get(r) {
            let Read::Reading { max, .. } = read else {
                unreachable!()
            };
            (8 + max * 16, "reading".to_string(), read.clone())
        } else if let Some((other, "hover")) =
            r.split_once('.').filter(|(c, _)| controls.contains_key(*c))
        {
            // Control: point: hover is viewer state, never a step's read.
            refused.push(refusal(
                "read",
                format!("{r} is the pointer's hover over {other}, viewer state a logic step never reads"),
                json!({"read": r}),
            ));
            continue;
        } else if let Some((other, name)) = r.split_once('.') {
            match decls.iter().position(|(o, _)| o == other) {
                Some(_) if name.starts_with("preview.") => {
                    refused.push(refusal(
                        "read",
                        format!("{r} is a preview array: session state no step reads"),
                        json!({"read": r}),
                    ));
                    continue;
                }
                Some(i) if i == idx => {
                    refused.push(refusal(
                        "read",
                        format!("{r} is this item's own array: a cycle"),
                        json!({"read": r}),
                    ));
                    continue;
                }
                Some(i) => {
                    let ws = &decls[i].1.writes;
                    let mut off = 0;
                    let mut found = None;
                    for w in ws {
                        if w.name == name {
                            found = Some((
                                w.ty.size() * w.count,
                                w.ty.name().to_string(),
                                Read::Array {
                                    item: i,
                                    offset: off,
                                },
                            ));
                        }
                        off = align8(off + w.ty.size() * w.count);
                    }
                    match found {
                        Some(f) => f,
                        None => {
                            refused.push(refusal(
                                "read",
                                format!("{other} declares no array {name}"),
                                json!({"read": r}),
                            ));
                            continue;
                        }
                    }
                }
                None => {
                    refused.push(refusal(
                        "read",
                        format!("{r} names no control or logic item of this piece"),
                        json!({"read": r}),
                    ));
                    continue;
                }
            }
        } else {
            refused.push(refusal(
                "read",
                format!("{r} names no control or logic item of this piece"),
                json!({"read": r}),
            ));
            continue;
        };
        // A read region past what a u32 addresses fits no memory, and leaves the seed 8 bytes.
        let Some(end) = at.checked_add(size).filter(|n| *n <= u32::MAX - 15) else {
            refused.push(refusal(
                "read",
                format!("{r} takes the read region past 4 GiB"),
                json!({"read": r}),
            ));
            continue;
        };
        entries.push(Region {
            region: "reads",
            name: r.clone(),
            offset: at,
            size,
            ty,
            read,
        });
        at = align8(end);
    }
    if !planted.mirror_lists_first {
        at = crate::mirrors::listed(&mirrors, at, &mut entries);
    }
    entries.push(Region {
        region: "reads",
        name: "seed".into(),
        offset: at,
        size: 8,
        ty: "i64".into(),
        read: Read::Seed,
    });
    let mut at = 0u32;
    for w in &d.writes {
        entries.push(Region {
            region: "writes",
            name: w.name.clone(),
            offset: at,
            size: w.ty.size() * w.count,
            ty: w.ty.name().into(),
            read: Read::None,
        });
        at = align8(at + w.ty.size() * w.count);
    }
    // Then each kind it emits: its u32 count and max_per_step rows, end to end from emits_at.
    let mut at = 0u32;
    for e in &d.emits {
        entries.push(Region {
            region: "emits",
            name: e.kind.clone(),
            offset: at,
            size: e.size(),
            ty: "rows".into(),
            read: Read::None,
        });
        at += e.size();
    }
    let text: String = entries
        .iter()
        .map(|e| format!("{}|{}|{}|{}|{}\n", e.region, e.name, e.offset, e.size, e.ty))
        .collect();
    let layout = Layout {
        digest: h64(text.as_bytes()),
        entries,
    };
    (layout, refused, mirrors)
}

/// A piece's controls, its logic items' declared fields by ID, and the IDs of its same-machine
/// fixture items.
pub(super) type Declarations = (Controls, Vec<(String, Declared)>, Vec<String>);

/// A piece's controls, each with its slot's size and type in a read region, and every item's
/// declared fields, so a read can name a later item's array.
pub(super) fn declarations(piece: &Value) -> Result<Declarations, Refused> {
    let controls: Controls = piece
        .get("controls")
        .and_then(Value::as_object)
        .map(|c| c.iter().map(|(k, v)| (k.clone(), form(v))).collect())
        .unwrap_or_default();
    let items_in = piece
        .get("items")
        .and_then(Value::as_object)
        .ok_or_else(|| Refused(json!({"ok": false, "code": "bad_input"})))?;
    let mut decls = Vec::new();
    let mut machine = Vec::new();
    for (id, item) in items_in {
        // The fixture module whose carried state is same-machine: a counter of the steps it's seen.
        if item.get("kind").and_then(Value::as_str) == Some(MACHINE)
            && item
                .get("params")
                .is_none_or(|p| p.as_object().is_some_and(Map::is_empty))
        {
            machine.push(id.clone());
            continue;
        }
        if item.get("kind").and_then(Value::as_str) != Some("logic@1") {
            return Err(logic_refused(
                id,
                vec![refusal(
                    "kind",
                    "only logic@1 items are stepped here".into(),
                    json!({}),
                )],
            ));
        }
        let params = item
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        decls.push((id.clone(), declared(id, &params)?));
    }
    Ok((controls, decls, machine))
}

/// Each item's region map and the kinds it emits, from the piece's declarations alone: what a
/// program is built against before it exists (#548's bindings).
pub fn region_maps(
    piece: &Value,
    planted: &Planted,
) -> Result<Vec<(String, Layout, Vec<Emit>)>, Refused> {
    let (controls, decls, _) = declarations(piece)?;
    let sources = sources_of(piece)?;
    let mut out = Vec::new();
    for (idx, (id, d)) in decls.iter().enumerate() {
        let (layout, refused, _) = region_map(idx, &decls, &controls, &sources, planted);
        if !refused.is_empty() {
            return Err(logic_refused(id, refused));
        }
        out.push((id.clone(), layout, d.emits.clone()));
    }
    Ok(out)
}

pub(super) type Controls = BTreeMap<String, (u32, &'static str)>;
/// A piece's sources by the reading each delivers, `reading:<source>` (#533).
pub(super) type Sources = BTreeMap<String, Read>;

pub(super) fn sources_of(piece: &Value) -> Result<Sources, Refused> {
    let mut sources = BTreeMap::new();
    for (name, src) in piece
        .get("sources")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        sources.insert(format!("reading:{name}"), source(name, src)?);
    }
    Ok(sources)
}

/// Checks every item of a piece in order: the first refusal answers.
pub fn check(piece: &Value, planted: &Planted, history: &mut History) -> Result<Piece, Refused> {
    check_bound(piece, planted, history, &[])
}

/// [`check`], with the between-step services this build binds (Logic: between-step services).
pub fn check_bound(
    piece: &Value,
    planted: &Planted,
    history: &mut History,
    services: &[crate::services::Service],
) -> Result<Piece, Refused> {
    let assets = piece
        .get("assets")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    check_in(
        piece,
        planted,
        history,
        &|sha| B64.decode(assets.get(sha)?.as_str()?).ok(),
        services,
    )
}

/// [`check`], each asset's bytes read by `stored` (a document's from the evidence store, #544)
/// rather than from the piece's `assets`; bytes that don't hash to their ID are none. `services`:
/// the between-step services this build binds (Logic: between-step services).
pub fn check_in(
    piece: &Value,
    planted: &Planted,
    history: &mut History,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    services: &[crate::services::Service],
) -> Result<Piece, Refused> {
    let bad = || Refused(json!({"ok": false, "code": "bad_input"}));
    let seed = piece.get("seed").and_then(Value::as_i64).ok_or_else(bad)?;
    let class = match piece.get("class") {
        None => Class::Figure,
        Some(c) => c.as_str().and_then(Class::parse).ok_or_else(bad)?,
    };
    let sources = sources_of(piece)?;
    let asset = |sha: &str| -> Option<Vec<u8>> {
        let bytes = stored(sha)?;
        (hash(&bytes) == sha).then_some(bytes)
    };
    let (controls, decls, machine) = declarations(piece)?;
    let mut items = Vec::new();
    for (idx, (id, d)) in decls.iter().enumerate() {
        let missing = |what: &str, sha: &str| {
            logic_refused(
                id,
                vec![refusal(
                    "asset",
                    format!("the piece carries no {what} asset {sha}"),
                    json!({"asset": sha}),
                )],
            )
        };
        let given = asset(&d.program).ok_or_else(|| missing("program", &d.program))?;
        // The linker first, before the subset check and the rewrite (#190); an item without links
        // is never linked.
        let (mut given, mut libraries, mut functions, mut lib_data, mut link_ns) =
            (given, Vec::new(), Functions::new(), None, 0);
        if !d.links.is_empty() {
            let packs = links::packs(piece).ok_or_else(bad)?;
            let link_refused = |refusals| {
                Refused(
                    json!({"ok": false, "code": "link_refused", "item": id, "refusals": refusals}),
                )
            };
            let started = std::time::Instant::now();
            libraries = links::resolve(&d.links, &packs, stored, planted).map_err(link_refused)?;
            let (bytes, f, data) =
                links::merge(&given, &libraries, planted).map_err(link_refused)?;
            link_ns = started.elapsed().as_nanos() as u64;
            given = bytes;
            functions = f;
            lib_data = data;
            if d.debug.is_some() {
                // A sidecar's DWARF stands for the program object, not the merged module.
                return Err(logic_refused(id, vec![refusal("debug", "a debug sidecar isn't read for an item with links yet: its offsets stand for the program before the link".into(), json!({"field": "debug"}))]));
            }
        }
        if planted.linker_adds_linking_section {
            given = links::empty_linking(given);
        }
        let linked = !d.links.is_empty() || planted.linker_adds_linking_section;
        let lines = match &d.debug {
            None => None,
            Some(sha) => {
                let side = asset(sha).ok_or_else(|| missing("debug", sha))?;
                Some(Lines::new(&given, &side).map_err(|e| {
                    logic_refused(id, vec![refusal("debug", e, json!({"field": "debug"}))])
                })?)
            }
        };
        // sandbox@1's check and rewrite in the role logic (#238): the only bytes that reach the engine.
        let budget = Budget {
            fuel: d.fuel,
            stack: d.stack,
            memory: d.memory,
        };
        let (bytes, hash) = if planted.runs_unchecked {
            (given.clone(), hash(&given))
        } else {
            let sandbox = Sandbox {
                planted: deep_sandbox_wasmtime::service::Planted {
                    rewrite: planted.rewrite,
                    ..Default::default()
                },
            };
            match sandbox.rewrite(&given, "logic", &budget) {
                Ok((out, _)) => (out.bytes, out.hash),
                Err(Ok(r)) => {
                    return Err(Refused(
                        json!({"ok": false, "code": "subset_refused", "item": id, "refusals": refusals_json(&r)}),
                    ))
                }
                Err(Err(e)) => {
                    return Err(Refused(
                        json!({"ok": false, "code": "rewrite_failed", "item": id, "what": e}),
                    ))
                }
            }
        };
        let (layout, mut refused, mut mirrors) =
            region_map(idx, &decls, &controls, &sources, planted);
        let past = history.entry(id.clone()).or_default();
        if !past.iter().any(|l| l.digest == layout.digest) {
            past.push(layout.clone());
        }
        // The write region inside memory, checked here; the read region traps with kind bounds.
        let memory = memory_bytes(&given);
        let reads_at = global_at(&given, "reads_at");
        let writes_at = global_at(&given, "writes_at");
        let (Some(reads_at), Some(writes_at)) = (reads_at, writes_at) else {
            return Err(logic_refused(
                id,
                vec![refusal(
                    "region",
                    "reads_at and writes_at are immutable i32 globals holding an address".into(),
                    json!({}),
                )],
            ));
        };
        if u64::from(writes_at) + u64::from(layout.size("writes")) > memory {
            refused.push(refusal(
                "region",
                format!("the write region, {} bytes at {writes_at}, passes the end of memory at {memory}", layout.size("writes")),
                json!({"region": "writes"}),
            ));
        }
        let mut regions = vec![
            ("the read region", reads_at, layout.size("reads")),
            ("the write region", writes_at, layout.size("writes")),
        ];
        // The emit region: each kind's count and max_per_step rows, in declaration order.
        let emits_at = global_at(&given, "emits_at");
        if !d.emits.is_empty() {
            let size: u64 = d.emits.iter().map(|e| u64::from(e.size())).sum();
            match emits_at {
                None => refused.push(refusal(
                    "region",
                    "an item that emits exports emits_at, an immutable i32 global holding an address".into(),
                    json!({"field": "emits"}),
                )),
                Some(at) => {
                    let (start, end) = (u64::from(at), u64::from(at) + size);
                    if let Some(why) = clash(start, end, memory, &regions, &[]) {
                        refused.push(refusal(
                            "region",
                            format!("the emit region, {size} bytes at {at}, {why}"),
                            json!({"region": "emits"}),
                        ));
                    }
                    regions.push(("the emit region", at, size as u32));
                }
            }
        }
        let services_at = global_at(&given, "services_at");
        let asked =
            crate::services::asked(&d.services, services, services_at, memory, &mut regions)
                .unwrap_or_else(|r| {
                    refused.extend(r);
                    Vec::new()
                });
        // The libraries' data, placed after the program's, must keep clear of its regions and its services' (#190).
        if let Some((start, end)) = lib_data {
            for (name, at, n) in &regions {
                if *at < end && u64::from(start) < u64::from(*at) + u64::from(*n) {
                    refused.push(refusal(
                        "links",
                        format!("the libraries' data, bytes {start} to {end}, overlaps {name}, {n} bytes at {at}"),
                        json!({"region": name}),
                    ));
                }
            }
        }
        let assets_at = global_at(&given, "assets_at");
        let mut assets = Vec::new();
        for sha in &d.assets {
            assets.push((sha.clone(), asset(sha).ok_or_else(|| missing("data", sha))?));
        }
        if !assets.is_empty() {
            match assets_at {
                None => refused.push(refusal(
                    "region",
                    "an item with assets exports assets_at, an immutable i32 global holding an address".into(),
                    json!({"field": "assets"}),
                )),
                Some(at) => {
                    refused.extend(placed(&assets, at, memory, &regions, &data_segments(&given)));
                    let len: usize = assets.iter().map(|(_, b)| 4 + b.len()).sum();
                    regions.push(("the assets", at, len as u32));
                }
            }
        }
        let preview = d.preview.as_ref().map(|(reads, writes)| {
            let p = Preview::of(reads, writes, &controls, global_at(&given, "preview_at"));
            refused.extend(p.check(&given, memory, &regions));
            p
        });
        let segments = data_segments(&given);
        refused.extend(crate::mirrors::placed(
            &mut mirrors,
            &given,
            memory,
            &mut regions,
            &segments,
        ));
        match regions_digest(&given) {
            Err(e) => refused.push(refusal("regions_digest", e, json!({}))),
            Ok(Some(v)) if v != layout.digest => {
                refused.extend(stale(&layout, v, &history[id], planted))
            }
            Ok(_) => {}
        }
        let saves = match d
            .saves
            .as_ref()
            .map(|v| saves_of(v, &layout, memory, &asset, planted))
        {
            None => None,
            Some(Ok(s)) => Some(s),
            Some(Err(r)) => {
                refused.push(r);
                None
            }
        };
        if !refused.is_empty() {
            return Err(logic_refused(id, refused));
        }
        let content = {
            let mut b = hash.clone().into_bytes();
            b.push(0);
            b.extend(d.given.as_bytes());
            for (sha, _) in &assets {
                b.push(0);
                b.extend(sha.as_bytes());
            }
            format!("{:016x}", h64(&b))
        };
        items.push(Item {
            id: id.clone(),
            program: d.program.clone(),
            bytes,
            hash,
            given,
            step: d.step,
            turn: d.turn,
            due: d.due.as_ref().map(|n| {
                layout
                    .entries
                    .iter()
                    .find(|e| e.region == "writes" && &e.name == n)
                    .expect("due names a write")
                    .offset
            }),
            reads: d.reads.clone(),
            writes: d.writes.clone(),
            layout,
            reads_at,
            writes_at,
            fuel: d.fuel,
            stack: d.stack,
            every: d.every,
            ring: d.ring,
            lines,
            content,
            assets,
            assets_at: assets_at.unwrap_or(0),
            libraries: std::mem::take(&mut libraries),
            functions: std::mem::take(&mut functions),
            linked,
            link_ns,
            fixtures: BTreeMap::new(),
            saves,
            emits: d.emits.clone(),
            emits_at: emits_at.unwrap_or(0),
            services: asked,
            services_at: services_at.unwrap_or(0),
            mirrors,
            preview,
        });
    }
    // A save holds every item at one instant, so a piece with saves steps at one rate.
    if items.iter().any(|i| i.saves.is_some()) && !items.windows(2).all(|w| w[0].step == w[1].step)
    {
        let id = items
            .iter()
            .find(|i| i.saves.is_some())
            .map_or("", |i| i.id.as_str());
        return Err(logic_refused(
            id,
            vec![refusal(
                "saves",
                "a piece with saves has every logic item at one step rate".into(),
                json!({"field": "saves"}),
            )],
        ));
    }
    let limits = piece
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(id, c)| Some((id.clone(), Limit::of(c)?)))
        .collect();
    Ok(Piece {
        seed,
        class,
        controls,
        limits,
        sources,
        tour: piece.get("tour").cloned(),
        items,
        machine,
        document: hash(piece.to_string().as_bytes()),
    })
}
