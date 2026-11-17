use super::*;

impl Hub<'_> {
    pub(super) fn kinds_planted(&self) -> Option<Planted> {
        self.startup.kinds
    }

    /// The listing as this process holds it, with the packs installed and the plug-ins' entries.
    pub fn kinds_listing(&self) -> Listing {
        let sealed = &self.startup.sealed;
        let planted = self.kinds_planted();
        let mut l = listing(
            sealed,
            planted,
            self.registries_reply(),
            &self.scenario.plugin_entries,
        );
        // #202: each installed pack's recipe-backed kinds, as entries of kind@1.
        if planted != Some(Planted::ListingWithoutPackEntries) {
            let head = l.rows[0].clone();
            for row in self.pack_kind_rows() {
                let mut e = row.entry;
                if let (Some(t), Some(h)) = (row.example, e["example"].as_str()) {
                    l.examples.insert(h.to_string(), t);
                }
                one_shape(&mut e, &head, sealed, planted);
                if let Some(list) = l.rows[0]["entries"].as_array_mut() {
                    list.push(e);
                }
            }
        }
        l
    }

    /// Each admitted pack's kinds backed by recipes (Pack: kinds in any pack): its schema from its
    /// recipe's inputs, its example by hash, its kit's result and its cost at defaults beside its
    /// largest counts over its params' extremes.
    pub(super) fn pack_kind_rows(&self) -> Vec<KindRow> {
        let mut out = Vec::new();
        for pack in self.packs.all() {
            let id = pack.id.text();
            let origin = if self.pack_authors.contains_key(&id) {
                "agent"
            } else {
                "pack"
            };
            for (name, kind) in &pack.kinds {
                let Some(recipe) = pack.recipes.get(&kind.recipe) else {
                    continue;
                };
                let properties: Map<String, Value> = recipe
                    .inputs
                    .iter()
                    .map(|(n, i)| {
                        let ty = match i.ty.as_str() {
                            "number" => "number",
                            "integer" => "integer",
                            "bool" => "boolean",
                            "text" | "ID" | "choice" => "string",
                            "records" | "vec3" | "range" => "array",
                            _ => "object",
                        };
                        let mut s = json!({"type": ty, "default": i.default});
                        if let Some(lo) = i.min {
                            s["minimum"] = json!(lo);
                        }
                        if let Some(hi) = i.max {
                            s["maximum"] = json!(hi);
                        }
                        if !i.options.is_empty() {
                            s["enum"] = json!(i.options);
                        }
                        (n.clone(), s)
                    })
                    .collect();
                let schema = json!({"type": "object", "properties": properties, "required": [], "additionalProperties": false});
                // Its first example, by the hash its pack lists it under.
                let example = kind.examples.first().map(|(sha, _)| sha.clone());
                let shape = json!({"schema": schema, "pack": id, "recipe": kind.recipe});
                let since = pack.id.version.to_string();
                let e = json!({
                    "name": name, "registry": "kind@1", "origin": origin, "pack": id,
                    "recipe": kind.recipe, "minor": kind.minor, "binds": "author",
                    "schema": schema,
                    "example": example,
                    "examples": kind.examples.iter().map(|(sha, _)| sha.clone()).collect::<Vec<_>>(),
                    "since": since, "digest": entry_digest("kind@1", name, &shape, &since),
                    "children": kind.children, "capabilities": kind.capabilities,
                    "rules": kind.rules.iter().map(|r| json!({"code": r.code, "expr": r.expr.text})).collect::<Vec<_>>(),
                    "kit": kind.kit,
                    "cost": {"class": kind.class.name(), "at_defaults": kind.at_defaults, "at_extremes": kind.at_extremes},
                    "description": format!("{name}, a kind backed by the recipe {} of {id}", kind.recipe),
                });
                let text = example.and_then(|sha| kind.texts.get(&sha).cloned());
                out.push(KindRow {
                    entry: e,
                    example: text,
                });
            }
        }
        out
    }

    /// `{"call": "deep_kinds", …}`.
    pub fn kinds_reply(&self, call: &Value) -> Value {
        let empty = Map::new();
        let c = call.as_object().unwrap_or(&empty);
        let op = c.get("op").and_then(Value::as_str).unwrap_or_default();
        let allowed: &[&str] =
            match op {
                "list" => &["registry", "cursor"],
                "word" => &["word"],
                "search" => &["query", "cursor"],
                "read" => &["example", "guide", "offset"],
                "gallery" => &["cursor"],
                "sheet" | "step_ceilings" => &[],
                "field" => &["path"],
                "bindings" => &["doc", "item", "language"],
                _ => return refused(
                    "enum",
                    "/op",
                    "Give op as one of list, word, search, read, gallery, sheet, step_ceilings, field or bindings.",
                    op,
                ),
            };
        // A field the op doesn't take is refused at its path; null reads as left out.
        for (k, v) in c {
            if k == "call" || k == "op" || v.is_null() {
                continue;
            }
            if !allowed.contains(&k.as_str()) {
                return refused(
                    "unlisted_field",
                    &format!("/{k}"),
                    &format!("Leave out {k}: {op} takes only {}.", allowed.join(", ")),
                    k,
                );
            }
        }
        let text = |k: &str| c.get(k).and_then(Value::as_str);
        let cursor = text("cursor");
        match op {
            "list" => self.kinds_list(text("registry"), cursor),
            "word" => match text("word") {
                Some(w) => crate::kinds_word::answer(&self.packs.all().collect::<Vec<_>>(), w),
                None => refused(
                    "required",
                    "/word",
                    "Give word, the word another tool uses.",
                    "",
                ),
            },
            "search" => match text("query") {
                Some(q) => self.kinds_search(q, cursor),
                None => refused(
                    "required",
                    "/query",
                    "Give query, the words a hit must hold.",
                    "",
                ),
            },
            "read" => match (text("example"), text("guide")) {
                (Some(hash), None) => self.kinds_read_example(hash),
                (None, Some(name)) => {
                    let offset = c.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
                    self.kinds_read_guide(name, offset)
                }
                _ => refused(
                    "required",
                    "/example",
                    "Give example, a hash, or guide, a name.",
                    "",
                ),
            },
            "gallery" => self.kinds_gallery(cursor),
            "field" => match text("path") {
                Some(p) if p == "patch" || p.starts_with("patch.") => patch_field(p),
                Some(p) => self.kinds_field(p),
                None => refused(
                    "required",
                    "/path",
                    "Give path, <kind>@<major>.<field> for one field, <kind>@<major> for all of them, or patch or patch.<op> for a patch's fields.",
                    "",
                ),
            },
            "bindings" => self.kinds_bindings(text("doc"), text("item"), text("language")),
            // The logic module's step ceilings (Logic: work across steps, #546).
            "step_ceilings" => json!({"step_ceilings": deep_logic::budget::ceilings(
                self.kinds_planted() == Some(Planted::StepCeilingsCap)
            )}),
            _ => self.kinds_sheet(),
        }
    }

    /// `op: bindings` (#548): a document's logic item's typed bindings in the pinned language, Rust,
    /// from its region map in declaration order, which its declarations alone give, so a program
    /// is built against them before it exists.
    pub(super) fn kinds_bindings(
        &self,
        doc: Option<&str>,
        item: Option<&str>,
        language: Option<&str>,
    ) -> Value {
        if language != Some("rust") {
            return refused(
                "enum",
                "/language",
                "Give language as rust, the pinned language.",
                language.unwrap_or_default(),
            );
        }
        let (Some(doc), Some(item)) = (doc, item) else {
            return refused(
                "required",
                "/item",
                "Give doc and item, the logic item whose bindings these are.",
                "",
            );
        };
        let Some(form) = self.forms.get(doc) else {
            return refused(
                "ref_unresolved",
                "/doc",
                "Give doc, a document the hub holds.",
                doc,
            );
        };
        let maps = crate::logic::piece_json(form)
            .map(|p| deep_logic::piece::region_maps(&p, &Default::default()));
        let Some((_, layout, emits)) = maps
            .and_then(Result::ok)
            .and_then(|m| m.into_iter().find(|(id, _, _)| id == item))
        else {
            return refused(
                "ref_unresolved",
                "/item",
                "Give item, a logic item of the document that check admits.",
                item,
            );
        };
        let by_name = self.kinds_planted() == Some(Planted::BindingsByName);
        json!({"bindings": deep_logic::bindings::rust(item, &layout, &emits, by_name)})
    }

    /// `op: field` (#1971): one line per field, printed from the listing's kind entry: the field's
    /// row (name, type, unit, range, default and its grammar's forms) with the kind's canvas module
    /// and stability. `<kind>@<major>` answers every field in the listing's order. A miss is
    /// `unknown_field`, naming the close names the document check gives, renames first.
    pub(super) fn kinds_field(&self, path: &str) -> Value {
        let sealed = &self.startup.sealed;
        let planted = self.kinds_planted();
        // The kind ends at the first dot after its major: `test.slab@3.width`.
        let cut = path
            .find('@')
            .and_then(|at| path[at..].find('.').map(|d| at + d));
        let (kind, field) = match cut {
            Some(d) => (&path[..d], Some(&path[d + 1..])),
            None => (path, None),
        };
        let rows = kind_rows(sealed, planted);
        let Some(e) = rows.iter().map(|r| &r.entry).find(|e| e["name"] == kind) else {
            let close =
                deep_canvas::document::kind_names(kind, &sealed.kinds(), &[], sealed.close_fault);
            return field_miss(path, &format!("{kind} is no kind this build lists"), &close);
        };
        let mut fields: Vec<&Value> = e["fields"].as_array().into_iter().flatten().collect();
        if planted == Some(Planted::FieldWithoutCorner) && kind == "test.slab@3" {
            fields.retain(|f| f["name"] != "corner");
        }
        let line = |f: &Value| {
            let mut l = f.clone();
            l["path"] = json!(format!("{kind}.{}", f["name"].as_str().unwrap_or_default()));
            l["module"] = e["module"].clone();
            l["stability"] = e["stability"].clone();
            if planted == Some(Planted::FieldLine600Bytes) && l["path"] == "test.slab@3.width" {
                // `,"pad":""` is 9 bytes.
                let pad = 600usize.saturating_sub(l.to_string().len() + 9);
                l["pad"] = json!(" ".repeat(pad));
            }
            if planted == Some(Planted::FieldSizeJsonAlone) && l["path"] == "slab@1.size" {
                if let Some(o) = l.as_object_mut() {
                    o.remove("grammar");
                    o.remove("forms");
                }
            }
            l
        };
        let Some(name) = field else {
            let mut lines: Vec<Value> = fields.into_iter().map(line).collect();
            if planted == Some(Planted::FieldObjectByName) {
                lines.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
            }
            return json!({"path": path, "lines": lines});
        };
        if let Some(f) = fields.iter().find(|f| f["name"] == name) {
            return json!({"path": path, "lines": [line(f)]});
        }
        let registry = sealed.kinds();
        let close = match deep_canvas::kinds::lookup(&registry, kind) {
            deep_canvas::kinds::Lookup::Known { entry, .. } => {
                let fault = sealed.close_fault;
                let owners = deep_canvas::document::owners(name, entry, &registry, fault);
                deep_canvas::document::field_names(
                    name,
                    entry,
                    entry.current(),
                    &owners,
                    &[],
                    fault,
                )
            }
            _ => Vec::new(),
        };
        let have: Vec<&str> = fields.iter().filter_map(|f| f["name"].as_str()).collect();
        let what = if close.is_empty() {
            format!(
                "{kind} has no field {name}; its fields are {}",
                have.join(", ")
            )
        } else {
            format!("{kind} has no field {name}")
        };
        field_miss(path, &what, &close)
    }

    pub(super) fn corpus(&self) -> Option<Corpus> {
        Corpus::read(self.scenario.gallery.as_deref())
    }

    pub(super) fn kinds_list(&self, registry: Option<&str>, cursor: Option<&str>) -> Value {
        let l = self.kinds_listing();
        let rows: Vec<Value> = match registry {
            Some(name) => l.rows.into_iter().filter(|r| r["name"] == name).collect(),
            None => l.rows,
        };
        let (row0, entry0) = cursor
            .and_then(|c| c.split_once('.'))
            .and_then(|(a, b)| Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?)))
            .unwrap_or((0, 0));
        let mut out = l.header.clone();
        out["packs"] = self.packs_listed();
        let mut size = out.to_string().len() + 64;
        let mut page: Vec<Value> = Vec::new();
        let mut next = None;
        'rows: for (i, row) in rows.iter().enumerate().skip(row0) {
            let mut head = row.clone();
            let entries = head
                .as_object_mut()
                .and_then(|o| o.remove("entries"))
                .and_then(|e| e.as_array().cloned())
                .unwrap_or_default();
            let from = if i == row0 { entry0 } else { 0 };
            let mut kept: Vec<Value> = Vec::new();
            let head_size = head.to_string().len() + 16;
            if size + head_size > PAGE_BUDGET && !page.is_empty() {
                next = Some(format!("{i}.{from}"));
                break;
            }
            size += head_size;
            for (j, e) in entries.iter().enumerate().skip(from) {
                let n = e.to_string().len() + 1;
                if size + n > PAGE_BUDGET && !(page.is_empty() && kept.is_empty()) {
                    if row.get("entries").is_some() {
                        head["entries"] = json!(kept);
                    }
                    page.push(head);
                    next = Some(format!("{i}.{j}"));
                    break 'rows;
                }
                size += n;
                kept.push(e.clone());
            }
            if row.get("entries").is_some() {
                head["entries"] = json!(kept);
            }
            page.push(head);
        }
        out["registries"] = json!(page);
        if let Some(n) = next {
            out["next"] = json!(n);
        }
        out
    }

    /// The packs installed here (#1720), each with its version and origin, its recipes and the
    /// kind each of its words maps to.
    pub(super) fn packs_listed(&self) -> Value {
        let packs: Vec<Value> = self
            .packs
            .all()
            .map(|p| {
                let recipes: Vec<String> = p
                    .recipes
                    .values()
                    .map(|r| format!("{}@{}", r.id, r.major))
                    .collect();
                let aliases: Map<String, Value> = p
                    .aliases
                    .iter()
                    .map(|(word, a)| (word.clone(), a["target"].clone()))
                    .collect();
                // #1958: a retired version stays listed, as retired.
                let state = if self.packs.is_retired(&p.id.text()) { "retired" } else { "installed" };
                json!({"pack": p.id.id, "version": p.id.version.to_string(), "state": state,
                       "origin": self.pack_origin(&p.id.text()), "recipes": recipes, "aliases": aliases})
            })
            .collect();
        Value::Array(packs)
    }

    /// Hits for every word of `query`, best first: the gallery's examples, the guides, then the
    /// listing's entries, each ranked by how many of its texts hold the query's words.
    pub(super) fn kinds_search(&self, query: &str, cursor: Option<&str>) -> Value {
        let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
        let corpus = self.corpus();
        let mut hits: Vec<(usize, usize, String, Value)> = Vec::new();
        let mut consider = |rank: usize, texts: &[&str], hit: Value| {
            let hay = texts.join(" ").to_lowercase();
            if words.is_empty() || !words.iter().all(|w| hay.contains(w.as_str())) {
                return;
            }
            // A word in a name or title counts twice.
            let head = texts.first().copied().unwrap_or_default().to_lowercase();
            let score: usize = words
                .iter()
                .map(|w| 1 + usize::from(head.contains(w.as_str())))
                .sum();
            let name = hit["name"].as_str().unwrap_or_default().to_string();
            hits.push((usize::MAX - score, rank, name, hit));
        };
        if let Some(c) = &corpus {
            for e in &c.examples {
                let mut texts = vec![e.title.as_str()];
                texts.extend(e.words.iter().map(String::as_str));
                consider(
                    0,
                    &texts,
                    json!({"kind": "example", "name": e.title, "title": e.title, "hash": e.hash}),
                );
            }
            for (name, title, _) in &c.guides {
                consider(
                    1,
                    &[title.as_str(), name.as_str()],
                    json!({"kind": "guide", "name": name, "title": title}),
                );
            }
        }
        for row in self.kinds_listing().rows {
            for e in row["entries"].as_array().into_iter().flatten() {
                let name = e["name"].as_str().unwrap_or_default();
                let description = e["description"].as_str().unwrap_or_default();
                let mut hit = json!({"kind": "entry", "name": name, "title": description, "registry": row["name"]});
                if let Some(h) = e["example"].as_str() {
                    hit["hash"] = json!(h);
                }
                consider(2, &[name, description], hit);
            }
        }
        hits.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));
        let all: Vec<Value> = hits.into_iter().map(|h| h.3).collect();
        if all.is_empty() {
            return json!({"hits": [], "code": "no_match"});
        }
        let (page, next) = paged(&all, cursor);
        let mut out = json!({"hits": page});
        if let Some(n) = next {
            out["next"] = json!(n);
        }
        out
    }

    /// An example by its hash: its stored bytes, served only when they hash to it.
    pub(super) fn kinds_read_example(&self, hash: &str) -> Value {
        if let Some(text) = self.kinds_listing().examples.get(hash) {
            return json!({"example": hash, "text": text});
        }
        let corpus = self.corpus();
        let Some(e) = corpus
            .as_ref()
            .and_then(|c| c.examples.iter().find(|e| e.hash == hash))
        else {
            return refused(
                "not_found",
                "/example",
                "Give the hash of an example deep_kinds lists or a search found.",
                hash,
            );
        };
        let bytes = corpus.as_ref().and_then(|c| c.bytes(&e.file));
        match bytes {
            Some(b) if sha256_hex(&b) == hash => match String::from_utf8(b) {
                Ok(text) => {
                    let mut out = json!({"example": hash, "title": e.title, "text": text});
                    if let Some(s) = e.source.as_ref().and_then(|f| corpus.as_ref()?.bytes(f)) {
                        out["source"] = json!({"file": e.source, "text": String::from_utf8_lossy(&s)});
                    }
                    out
                }
                Err(_) => refused("unavailable", "/example", "The example isn't UTF-8 text; it is not served.", hash),
            },
            _ => refused(
                "unavailable",
                "/example",
                "The example's stored bytes don't match its hash, so it is never served; reinstall the gallery.",
                hash,
            ),
        }
    }

    /// A guide's page at `offset` bytes: at most a page of its text, cut on a character, saying
    /// whether it was cut and where the next page starts.
    pub(super) fn kinds_read_guide(&self, name: &str, offset: usize) -> Value {
        let corpus = self.corpus();
        let mut text = corpus.as_ref().and_then(|c| {
            let (_, _, file) = c.guides.iter().find(|(n, _, _)| n == name)?;
            String::from_utf8(c.bytes(file)?).ok()
        });
        if self.kinds_planted() == Some(Planted::PatchesWithoutReorder) && name == "patches" {
            text = Some(patches_guide(Some("reorder")));
        }
        // The planted dice game keys its throws by the step's seed, at 264 in its read region.
        if self.kinds_planted() == Some(Planted::DiceFromStepSeed) {
            text = text.map(|t| {
                t.replace(
                    "(local.set $key (i64.load (i32.const 1024)))",
                    "(local.set $key (i64.load (i32.const 264)))",
                )
            });
        }
        let Some(text) = text else {
            return refused(
                "not_found",
                "/guide",
                "Give a guide's name as a search hit gives it.",
                name,
            );
        };
        if offset > text.len() || !text.is_char_boundary(offset) {
            return refused(
                "range",
                "/offset",
                "Give 0 or the next offset a page gave.",
                &offset.to_string(),
            );
        }
        let mut end = (offset + GUIDE_PAGE).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        let truncated = end < text.len();
        let mut out = json!({"guide": name, "offset": offset, "text": &text[offset..end], "truncated": truncated});
        if truncated {
            out["next"] = json!(end);
        }
        out
    }

    /// The gallery's examples, each verified only when its last corpus run on this module-set
    /// digest played at least the steps it declares; else unverified with the steps played, or
    /// not run.
    pub(super) fn kinds_gallery(&self, cursor: Option<&str>) -> Value {
        let here = &self.startup.sealed.set_digest;
        let by_exit = self.kinds_planted() == Some(Planted::VerifiedByExit);
        let rows: Vec<Value> =
            self.corpus()
                .map(|c| c.examples)
                .unwrap_or_default()
                .into_iter()
                .map(|e| {
                    let last = self.scenario.corpus_runs.iter().rev().find(|r| {
                        r["example"] == e.hash.as_str() && r["module_set"] == here.as_str()
                    });
                    let mut row = json!({"hash": e.hash, "title": e.title, "steps": e.steps});
                    match last {
                        None => row["status"] = json!("not_run"),
                        Some(r) => {
                            let played = r["played"].as_u64().unwrap_or(0);
                            let verified = if by_exit {
                                r["exit"] == 0
                            } else {
                                played >= e.steps
                            };
                            row["status"] = json!(if verified { "verified" } else { "unverified" });
                            row["played"] = json!(played);
                        }
                    }
                    row
                })
                .collect();
        let (page, next) = paged(&rows, cursor);
        let mut out = json!({"examples": page});
        if let Some(n) = next {
            out["next"] = json!(n);
        }
        out
    }

    pub(super) fn kinds_sheet(&self) -> Value {
        let l = self.kinds_listing();
        let drop_packs = self.kinds_planted() == Some(Planted::SheetWithoutPackEntries);
        let text = sheet_text(&sheet_lines(&l.rows, drop_packs));
        json!({"module_set": self.startup.sealed.set_digest, "bytes": text.len(), "text": text})
    }
}
