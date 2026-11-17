use super::*;

impl Hub<'_> {
    /// Opens every shared document: from the state folder's record when it has one (a restart),
    /// else at revision 0, the stored document.
    pub fn open_shared(&mut self) {
        let scenario = self.scenario;
        for (id, seed) in &scenario.seeds {
            let mut doc = seed.clone();
            if let Some(fields) = doc.as_object_mut() {
                fields.insert("id".into(), json!(id.to_ascii_lowercase()));
            }
            let checked = check_packed(&doc, &self.startup.sealed, &self.packs);
            let mut issues = checked.issues;
            // #407: a film a claim's definition audits holds the film audit's issues too.
            if let Some(found) = self.admission_issues(id, &doc) {
                issues.extend(found);
            }
            let mut shared = Shared {
                id: id.clone(),
                doc,
                owners: Owners::new(),
                revs: vec![Rev {
                    rev: 0,
                    base_rev: 0,
                    writer: None,
                    patch: None,
                    reason: String::new(),
                    changed: BTreeSet::new(),
                    before: BTreeMap::new(),
                    paths: Paths::new(),
                    envelope_before: None,
                    issues: Rc::new(issues),
                    notices: OnceCell::from(checked.notices),
                    hash: OnceCell::new(),
                    current_at: None,
                }],
                lost: BTreeMap::new(),
                older: BTreeSet::new(),
                referrers: None,
            };
            if let Some(state) = &self.scenario.state {
                restore(
                    &mut shared,
                    state,
                    &self.startup.sealed,
                    &self.packs,
                    self.scenario.planted,
                );
            }
            shared.find_older();
            self.shared.insert(id.clone(), shared);
        }
    }

    /// The index of the revision a read shows: the newest one current at the hub's time.
    pub fn shown(&self, doc: &str) -> Option<usize> {
        let shared = self.shared.get(doc)?;
        shared
            .revs
            .iter()
            .rposition(|r| r.current_at.is_none_or(|t| t <= self.now))
    }

    /// The writer a call acts as, and the session it acts for.
    fn acting(&self, via: &Via) -> Option<(Writer, Option<String>)> {
        let (writer, _) = self.writer(via)?;
        let session = self.session_of(via, &writer);
        Some((writer, session))
    }

    /// `lost` for this writer on this document, reported once.
    fn take_lost(&mut self, doc: &str, writer: &Writer, reply: &mut Map<String, Value>) {
        let lost = self
            .shared
            .get_mut(doc)
            .and_then(|s| s.lost.remove(&writer.text()))
            .unwrap_or_default();
        if !lost.is_empty() {
            reply.insert("lost".into(), json!(lost));
        }
    }

    /// A patch or an undo, checked at `checked` (the clock's time, else 0) after arriving at
    /// `arrived`: its reply, the Patch result.
    pub fn patch(&mut self, call: &PatchCall, arrived: Option<i64>, checked: i64) -> Value {
        let mut reply = Map::new();
        let outcome = self.check_patch(call, checked, &mut reply);
        let current_rev = self.shared.get(&call.doc).map_or(0, |s| s.current().rev);
        let zero = json!({"created": {}, "updated": 0, "deleted": {}, "unchanged": true});
        let (name, rev, achieved, undo, issues, ids, current) = match outcome {
            Outcome::Applied(a) => {
                let Applied {
                    rev,
                    achieved,
                    cost,
                    undo,
                    ids,
                    current_at,
                    carried,
                    notices,
                } = *a;
                reply.insert("cost_delta".into(), cost);
                if !notices.is_empty() {
                    reply.insert("notices".into(), Value::Array(notices));
                }
                ("applied", rev, achieved, undo, carried, ids, current_at)
            }
            Outcome::Refused(issues) => (
                "refused",
                current_rev,
                zero,
                Vec::new(),
                issues,
                Map::new(),
                None,
            ),
            Outcome::Conflict { ids, writers } => {
                let writers: Vec<Value> = writers.iter().map(Writer::to_json).collect();
                reply.insert("conflict".into(), json!({"ids": ids, "writers": writers}));
                let issue = Issue {
                    ids: ids.clone(),
                    ..Issue::envelope(
                        "stale_base",
                        "base".into(),
                        json!(ids),
                        "another writer changed what this patch touches since its base",
                    )
                };
                let none = Map::new();
                (
                    "conflict",
                    current_rev,
                    zero,
                    Vec::new(),
                    vec![issue],
                    none,
                    None,
                )
            }
        };
        reply.insert("outcome".into(), json!(name));
        reply.insert("rev".into(), json!(rev));
        reply.insert("ids".into(), Value::Object(ids));
        reply.insert("achieved".into(), achieved);
        // Errors first, inlined up to the read cap, with `truncated` when cut.
        let mut issues: Vec<Value> = issues.iter().map(Issue::to_json).collect();
        planted_fix(self.scenario.planted, &mut issues);
        order_issues(&mut issues);
        let shown = inline_count(&issues);
        if shown < issues.len() {
            reply.insert("truncated".into(), truncated(&issues, shown));
        }
        issues.truncate(shown);
        reply.insert("issues".into(), json!(issues));
        // Nothing applied changes nothing.
        if !reply.contains_key("cost_delta") {
            let none = json!({"cpu_ms": 0, "gpu_ms": 0, "vertices": 0, "lights": 0, "gpu_mb": 0});
            reply.insert("cost_delta".into(), none);
        }
        reply.insert("undo".into(), json!(undo));
        // The expansions of the revision current after the patch (#306), as its check made them.
        if let Some(expansions) = self.expansions.get(&call.doc) {
            crate::packs::reply(expansions, None, false, &mut reply);
        }
        if let Some(arrived) = arrived {
            reply.insert("arrived".into(), json!(arrived));
            reply.insert("checked".into(), json!(checked));
            reply.insert("current".into(), json!(current));
        }
        Value::Object(reply)
    }

    fn check_patch(
        &mut self,
        call: &PatchCall,
        checked: i64,
        reply: &mut Map<String, Value>,
    ) -> Outcome {
        let refused = |code: &'static str, path: &str, what: &str| {
            Outcome::Refused(vec![Issue::envelope(code, path.into(), Value::Null, what)])
        };
        let Some((writer, session)) = self.acting(&call.via) else {
            return refused("ref_unresolved", "session", "the call binds to no session");
        };
        if !self.shared.contains_key(&call.doc) {
            return refused("ref_unresolved", "doc", "no shared document has this ID");
        }
        self.take_lost(&call.doc, &writer, reply);
        // A writer's quota: patches applied in the second before this check, the bytes a message
        // carries and the documents it writes; the items its layer holds are counted below.
        let quota = session
            .as_ref()
            .and_then(|s| self.scenario.quotas.get(s))
            .copied()
            .unwrap_or_default();
        if let Some(cap) = quota.patches_per_s {
            let times = self.applied_at.entry(writer.text()).or_default();
            times.retain(|t| *t > checked - FLICKS);
            if times.len() >= cap as usize {
                let what = "this writer's patches a second are spent";
                return refused("over_quota", "patch", what);
            }
        }
        if let (Some(cap), Body::Patch(p)) = (quota.msg_bytes, &call.body) {
            let bytes = serde_json::to_vec(p).map_or(usize::MAX, |b| b.len());
            if bytes > cap as usize {
                let what = format!(
                    "the patch is {bytes} bytes; this writer's messages carry at most {cap}"
                );
                return refused("too_large", "patch", &what);
            }
        }
        let written = self.written.get(&writer.text());
        if let Some(cap) = quota.docs {
            let count = written.map_or(0, |w| w.len());
            if !written.is_some_and(|w| w.contains(&call.doc)) && count >= cap as usize {
                let what = format!("this writer writes at most {cap} shared documents");
                return refused("over_quota", "doc", &what);
            }
        }
        let shared = &self.shared[&call.doc];
        let cur = shared.current().rev;
        let (patch, base, undoing) = match &call.body {
            Body::Patch(p) => (p.clone(), p["base"].as_u64().unwrap_or(cur), None),
            Body::Undo { patch, of } => {
                let Some(target) = shared
                    .revs
                    .iter()
                    .position(|r| r.patch.as_deref() == Some(of))
                else {
                    return refused(
                        "ref_unresolved",
                        "undo/of",
                        "no revision applied this patch",
                    );
                };
                let t = &shared.revs[target];
                // An agent can't undo your change, and nobody undoes over another writer's.
                if t.writer.as_ref() != Some(&writer) {
                    let what = "an undo is by the writer whose change it undoes";
                    return refused("undo_conflict", "undo/of", what);
                }
                if shared.revs[target + 1..]
                    .iter()
                    .any(|r| r.writer.as_ref() != Some(&writer) && overlaps(&r.paths, &t.paths))
                {
                    let what = "another writer changed what this undo would put back";
                    return refused("undo_conflict", "undo/of", what);
                }
                let p = json!({"patch": patch, "doc": call.doc, "base": cur,
                               "reason": format!("undo {of}"), "ops": []});
                (p, cur, Some(target))
            }
        };
        if base > cur {
            return refused("stale_base", "base", "no such revision yet");
        }
        // A stale base rebases when no ID the patch touches changed since; otherwise it's a
        // conflict naming both writers. (The planted path-granular rebase merges a patch whose
        // paths no later revision wrote, as computed on its base.)
        let mut base_doc = None;
        let mut path_merge: Option<Value> = None;
        if base < cur && undoing.is_none() {
            let targets_only = self.scenario.planted == Some(Planted::RebaseCountsOpTargetsOnly);
            let (base_items, _) = shared.at(base as usize);
            let touches = touched_in(&patch, &base_items, targets_only);
            let mut ids = BTreeSet::new();
            let mut writers = vec![writer.clone()];
            for r in &shared.revs[base as usize + 1..] {
                let hit: Vec<&String> = r.changed.intersection(&touches).collect();
                if !hit.is_empty() {
                    ids.extend(hit.into_iter().cloned());
                    if let Some(w) = r.writer.as_ref().filter(|w| !writers.contains(w)) {
                        writers.push(w.clone());
                    }
                }
            }
            // Planted (#1941): every stale patch a conflict, on all it touches.
            if ids.is_empty() && self.scenario.planted == Some(Planted::StaleFixNeverRebases) {
                ids = touches.clone();
            }
            if !ids.is_empty() {
                let by_path = self.scenario.planted == Some(Planted::RebaseByPath)
                    && written_paths(&patch).is_some_and(|written| {
                        !shared.revs[base as usize + 1..].iter().any(|r| {
                            r.paths
                                .iter()
                                .any(|p| p.1.is_empty() || written.contains(p))
                        })
                    });
                if !by_path {
                    let ids = ids.into_iter().collect();
                    return Outcome::Conflict { ids, writers };
                }
                path_merge = Some(shared.at(base as usize).0.into_owned());
            }
            // A reorder's key falls between its neighbors as the patch's base had them.
            let reorders = patch["ops"]
                .as_array()
                .is_some_and(|ops| ops.iter().any(|o| o["op"] == "reorder"));
            if reorders {
                base_doc = Some(shared.at(base as usize).0.into_owned());
            }
        }

        // The writer's layer, added when it has none: a change to the envelope, so the whole
        // document is checked again.
        let layer_text = writer.text();
        let found = layer_of(&shared.doc, &writer);
        let added = found.is_none().then(|| shared.envelope());
        let layer = match found {
            Some(l) => l,
            None => {
                let mut doc =
                    std::mem::take(&mut self.shared.get_mut(&call.doc).expect("open").doc);
                let l = self.add_layer(&mut doc, &writer);
                self.shared.get_mut(&call.doc).expect("open").doc = doc;
                l
            }
        };
        let shared = self.shared.get_mut(&call.doc).expect("open");
        // The patch applies to the writer's layer as the load migrated it (#1960), so an op
        // names a param by its current name: the layer's pack-kind items take their migrated
        // kind and params first, and come back as stored when the patch doesn't commit.
        let stored = pack_kinds::store_migrations(&mut shared.doc, &layer, &self.packs);
        let take_back = |shared: &mut Shared, patched: &Patched| {
            rollback(&mut shared.doc, patched);
            for (id, was) in &stored {
                shared.doc["items"][id.as_str()] = was.clone();
            }
            if let Some((fields, owners)) = &added {
                let items = shared.doc["items"].take();
                shared.doc = Value::Object(fields.clone());
                shared.doc["items"] = items;
                shared.owners = owners.clone();
            }
        };
        let applied = match undoing {
            Some(target) => {
                // The pack versions it named in place of others, named back (#1961).
                let pins = shared.revs[target]
                    .envelope_before
                    .as_ref()
                    .map(|(fields, _)| fields.get("packs").cloned().unwrap_or(Value::Null))
                    .filter(|was| *was != shared.at(target).0["packs"]);
                let t = &shared.revs[target];
                put_back(&mut shared.doc, &t.before, &t.paths, &layer).map(|mut p| {
                    if let Some(was) = pins {
                        p.packs_before = Some(std::mem::replace(&mut shared.doc["packs"], was));
                    }
                    p
                })
            }
            None => {
                // The build knows the kinds its canvas modules register, too.
                let kinds = self.startup.sealed.kinds();
                let known = |kind: &str| {
                    knows(kind) || !matches!(lookup(&kinds, kind), Lookup::UnknownKind)
                };
                let writing = Writing {
                    layer: &layer,
                    writer: &layer_text,
                    you: writer.kind == WriterKind::You,
                    base: base_doc.as_ref(),
                    knows: &known,
                    packs: Some(&self.packs),
                };
                match path_merge.take() {
                    Some(mut on_base) => {
                        match apply_ops(&mut on_base, &patch, "patch", &call.doc, &writing) {
                            Ok(_) => Ok(merge_paths(&mut shared.doc, &on_base, &patch)),
                            Err(e) => Err(e),
                        }
                    }
                    None => apply_ops(&mut shared.doc, &patch, "patch", &call.doc, &writing),
                }
            }
        };
        let mut patched = match applied {
            Ok(p) => p,
            Err(issue) => {
                take_back(shared, &Patched::default());
                return Outcome::Refused(vec![*issue]);
            }
        };
        let changed = patched.changed(&shared.doc);
        let last = Rc::clone(&shared.current().issues);
        // Re-checked incrementally where the patch reached only items; else in full, which
        // expands the recipe instances again (#306): the one check, never per frame.
        let mut expansions = None;
        let mut notices = Vec::new();
        let issues = if added.is_some() {
            None
        } else {
            if shared.referrers.as_ref().is_none_or(|(rev, _)| *rev != cur) {
                shared.referrers = Some((cur, Referrers::of(&shared.doc)));
            }
            let (_, referrers) = shared.referrers.as_ref().expect("made above");
            recheck_with(
                &shared.doc,
                &last,
                &changed,
                &self.startup.sealed,
                referrers,
                &self.packs,
            )
        }
        .unwrap_or_else(|| {
            let result = check_packed(&shared.doc, &self.startup.sealed, &self.packs);
            expansions = Some(result.expansions);
            notices = result.notices;
            result.issues
        });
        // #407: a film a claim's definition audits gets the film audit's issues at show time,
        // read afresh on the patched document; those its last good revision had come back
        // carried.
        let now = shared.doc.clone();
        let audited = self.admission_issues(&call.doc, &now);
        let shared = self.shared.get_mut(&call.doc).expect("open");
        let issues = match audited {
            Some(found) => {
                let mut kept: Vec<Issue> = issues
                    .into_iter()
                    .filter(|i| !crate::film_audit::audit_code(i.code))
                    .collect();
                kept.extend(found);
                kept
            }
            None => issues,
        };
        // An undo may put back an issue the revision it undoes was made on already held.
        let mut allowed = (*last).clone();
        if let Some(t) = undoing.filter(|t| *t > 0) {
            allowed.extend(shared.revs[t - 1].issues.iter().cloned());
        }
        let planted = self.scenario.planted;
        let refusals = blocking(&issues, &allowed, &shared.doc, &layer, &changed, planted);
        if !refusals.is_empty() {
            take_back(shared, &patched);
            return Outcome::Refused(refusals);
        }
        // #935: a strip or spawn template naming a generated sound's asset before its audio.gen
        // passes; only a document that declares `sounds` is read again.
        if shared.doc.get("sounds").is_some() {
            let now = shared.doc.clone();
            let unpassed = self.unpassed_sounds(&now);
            let shared = self.shared.get_mut(&call.doc).expect("open");
            if !unpassed.is_empty() {
                take_back(shared, &patched);
                return Outcome::Refused(unpassed);
            }
        }
        let shared = self.shared.get_mut(&call.doc).expect("open");
        let kept = carried(&issues, &allowed, planted);
        // The marks module checks what the patch wrote, and counts what it costs.
        let cost = match marks_check(
            &shared.doc,
            &patched.before,
            &self.look.light,
            &self.startup.sealed,
        ) {
            Ok(cost) => cost,
            Err(issue) => {
                take_back(shared, &patched);
                return Outcome::Refused(vec![*issue]);
            }
        };
        if let Some(cap) = quota.items {
            let mine =
                |i: Option<&Value>| i.is_some_and(|i| i["layer"].as_str() == Some(layer.as_str()));
            let now = shared.doc["items"]
                .as_object()
                .map_or(0, |i| i.values().filter(|v| mine(Some(v))).count());
            // What the patch added to the layer: what it created or took, less what it deleted.
            let added: i64 = patched
                .before
                .iter()
                .map(|(id, was)| {
                    i64::from(mine(shared.doc["items"].get(id))) - i64::from(mine(was.as_ref()))
                })
                .sum();
            if now > cap as usize && added > 0 {
                take_back(shared, &patched);
                let what =
                    format!("this writer's layer would hold {now} items; its quota is {cap}");
                return refused("over_quota", "items", &what);
            }
        }
        let achieved = patched.achieved(&shared.doc);
        let (undo, ids) = (patched.undo(&shared.doc), patched.ids.clone());
        // A dry run returns what the commit would, and commits nothing.
        if patch.get("dry_run") == Some(&json!(true)) {
            take_back(shared, &patched);
            reply.insert("dry_run".into(), json!(true));
            return Outcome::Applied(Box::new(Applied {
                rev: cur,
                achieved,
                cost,
                undo: Vec::new(),
                ids,
                current_at: None,
                carried: kept,
                notices: self.notices_reply(&call.doc, &notices),
            }));
        }
        if shared.older.contains(&layer) {
            for (id, was) in store_migrations(&mut shared.doc, &layer) {
                patched.before.entry(id).or_insert(Some(was));
            }
        }
        // A pack kind's items at an earlier major of their pinned pack's kind, too (#1956).
        for (id, was) in pack_kinds::store_migrations(&mut shared.doc, &layer, &self.packs) {
            patched.before.entry(id).or_insert(Some(was));
        }
        // Each item the layer's migration moved before the ops, as the revision before held it.
        for (id, was) in &stored {
            // Planted (#1960): the store keeps its migrated params under the major it was saved at.
            if planted == Some(Planted::StoreMigratedParamsUnderSavedMajor) {
                if let Some(item) = shared.doc["items"].get_mut(id) {
                    item["kind"] = was["kind"].clone();
                }
            }
            patched.before.insert(id.clone(), Some(was.clone()));
        }
        let patch_id = patch["patch"].as_str().unwrap_or_default().to_string();
        let current_at = self.scenario.clock.map(|c| c.latch_from(checked));
        let next = Rev {
            rev: cur + 1,
            base_rev: base,
            writer: Some(writer.clone()),
            patch: Some(patch_id.clone()),
            reason: patch["reason"].as_str().unwrap_or_default().to_string(),
            changed,
            paths: paths_of(&patched.before, &shared.doc),
            before: patched.before.clone(),
            // A layer added, or another pack version named (#1961): the envelope before.
            envelope_before: added.clone().or_else(|| {
                patched.packs_before.as_ref().map(|packs| {
                    let (mut fields, owners) = shared.envelope();
                    fields.insert("packs".into(), packs.clone());
                    (fields, owners)
                })
            }),
            issues: Rc::new(issues),
            // The check ran before the writer's layer was migrated and stored: `read` takes the
            // stored revision's notices when asked.
            notices: OnceCell::new(),
            hash: OnceCell::new(),
            current_at,
        };
        if self.commit(&call.doc, next, session, &recorded_by(&call.via), &achieved) {
            if let Some(expansions) = expansions {
                let doc = &self.shared[&call.doc].doc;
                let planted = self.scenario.planted;
                let cache = &mut self.expansion_cache;
                let expansions = crate::packs::planted_cache(planted, cache, doc, expansions);
                self.expansions.insert(call.doc.clone(), expansions);
            }
            // The writer's layer holds no older major now: this patch migrated it.
            let shared = self.shared.get_mut(&call.doc).expect("open");
            shared.older.remove(&layer);
            // Its referrers follow the items it changed to the revision it made.
            if let Some((rev, referrers)) = shared.referrers.as_mut().filter(|(r, _)| *r == cur) {
                let now = shared.revs.last().expect("committed");
                for (id, was) in &now.before {
                    referrers.update(id, was.as_ref(), shared.doc["items"].get(id));
                }
                *rev = now.rev;
            }
            self.applied_at
                .entry(writer.text())
                .or_default()
                .push(checked);
            self.written
                .entry(writer.text())
                .or_default()
                .insert(call.doc.clone());
        } else {
            // Acknowledged as applied here, and never current: the writer hears on its next call.
            let shared = self.shared.get_mut(&call.doc).expect("open");
            take_back(shared, &patched);
            shared.lost.entry(writer.text()).or_default().push(patch_id);
        }
        Outcome::Applied(Box::new(Applied {
            rev: cur + 1,
            achieved,
            cost,
            undo,
            ids,
            current_at,
            carried: kept,
            notices: self.notices_reply(&call.doc, &notices),
        }))
    }

    /// A layer for `writer` in `doc`, after every other: its ID from the writer, titled with the
    /// agent's name.
    pub fn add_layer(&self, doc: &mut Value, writer: &Writer) -> String {
        let id = writer.layer_id();
        let last = doc["layers"]
            .as_object()
            .and_then(|l| l.values().filter_map(|v| v["order"].as_str()).max())
            .map(str::to_string);
        let seed = writer.text();
        let order = deep_canvas::document::key_between(last.as_deref(), None, seed.as_bytes())
            .unwrap_or_else(|| "z".into());
        let title = self.agent_name(writer).unwrap_or_else(|| "You".into());
        if !doc["layers"].is_object() {
            doc["layers"] = json!({});
        }
        doc["layers"][&id] = json!({"writer": writer.text(), "title": title, "order": order});
        id
    }

    /// Commits `next`, already applied to the document: each layer it changed written to its
    /// file by hash, then its `doc.patched` event appended, which makes it current. False when a
    /// layer file couldn't be written: the revision never becomes current, nothing of it is
    /// recorded, and the caller takes it back out.
    fn commit(
        &mut self,
        doc: &str,
        next: Rev,
        session: Option<String>,
        recorded_by: &str,
        achieved: &Value,
    ) -> bool {
        let patch = next.patch.clone().unwrap_or_default();
        let fault = self.scenario.commit_fault.as_ref();
        if fault == Some(&CommitFault::LayerFileFails(patch.clone())) {
            return false;
        }
        let shared = &self.shared[doc];
        if let Some(state) = &self.scenario.state {
            // The layers it changed: its items' layers before and after, and every layer whose
            // entry in `layers` or whose other entries it changed.
            let mut layers: BTreeSet<String> = BTreeSet::new();
            for id in &next.changed {
                let now = shared.doc["items"][id]["layer"].as_str();
                let was = next.before.get(id).and_then(|w| w.as_ref());
                for l in [now, was.and_then(|w| w["layer"].as_str())]
                    .into_iter()
                    .flatten()
                {
                    layers.insert(l.to_string());
                }
            }
            if let Some((fields, owners)) = &next.envelope_before {
                for (id, l) in shared.doc["layers"].as_object().into_iter().flatten() {
                    if fields.get("layers").and_then(|ls| ls.get(id)) != Some(l) {
                        layers.insert(id.clone());
                    }
                }
                for (k, l) in owners.iter().chain(shared.owners.iter()) {
                    if owners.get(k) != shared.owners.get(k) {
                        layers.insert(l.clone());
                    }
                }
            }
            let mut written = Vec::new();
            for layer in &layers {
                let bytes = layer_file(doc, &shared.doc, &shared.owners, layer);
                match evidence::put(&state.join("layers"), &bytes) {
                    Ok(sha) => written.push(sha),
                    Err(_) => return false,
                }
            }
            if fault == Some(&CommitFault::KillAfterLayerFile(patch.clone())) {
                // As SIGKILL would: no answer, nothing after.
                std::process::abort();
            }
            let record = state.join("record.jsonl");
            let log_pos = fs::read_to_string(&record).map_or(0, |t| t.lines().count()) + 1;
            let writer = next.writer.as_ref().expect("a commit has a writer");
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64);
            let event = json!({
                "v": 1,
                "id": ulid_of(&format!("{doc}|{}|{patch}", next.rev)),
                "kind": "doc.patched",
                "subject": format!("doc:{doc}"),
                "writer": recorded_by,
                "actor": "you",
                "scope": "you",
                "ts": ts,
                "log_pos": log_pos,
                "data": {
                    "doc": format!("doc:{doc}"),
                    "rev": next.rev,
                    "patch": patch,
                    "writer": writer.kind.name(),
                    "achieved": achieved,
                },
                "evidence": written,
            });
            let line = json!({"log_pos": log_pos, "session": session, "event": event});
            let appended = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&record)
                .and_then(|mut f| writeln!(f, "{line}"));
            if appended.is_err() {
                return false;
            }
        }
        self.shared
            .get_mut(doc)
            .expect("committed to an open document")
            .revs
            .push(next);
        true
    }

    /// A whole revision of a shared document: the writer's layer replaced by the payload's items
    /// and entries, diffed against what that layer held, so another writer's entries never count
    /// as removed and stay as they are.
    pub fn show_shared(&mut self, show: &Show) -> Value {
        let refused =
            |code: &str| json!({"outcome": "refused", "code": code, "issues": [], "snapshots": []});
        let Some((writer, session)) = self.acting(&show.via) else {
            return refused("no_session");
        };
        let Some(panel) = self
            .scenario
            .docs
            .get(&show.doc)
            .and_then(|p| self.scenario.panels.get(p))
        else {
            return refused("ref_unresolved");
        };
        let mut reply = Map::new();
        self.take_lost(&show.doc, &writer, &mut reply);
        let shared = &self.shared[&show.doc];
        let cur = shared.current().rev;
        let last = Rc::clone(&shared.current().issues);
        let (was_doc, was_owners) = (&shared.doc, &shared.owners);
        let mut doc = was_doc.clone();
        let mut owners = was_owners.clone();
        let layer = match layer_of(&doc, &writer) {
            Some(l) => l,
            None => self.add_layer(&mut doc, &writer),
        };

        // The payload: the layer and its writer come from the connection, never from it.
        let mut issues = Vec::new();
        let claimed = "the layer and its writer come from the connection, never the payload";
        let payload = show.document.as_object().cloned().unwrap_or_default();
        if let Some(source) = doc.get("source") {
            let what = "a view of the record is rebuilt from the record, never written";
            issues.push(Issue::envelope(
                "record_view",
                "source".into(),
                source.clone(),
                what,
            ));
        }
        // The writer's quota: the bytes its message carries, the documents it writes and the
        // items its layer would hold.
        let quota = session
            .as_ref()
            .and_then(|s| self.scenario.quotas.get(s))
            .copied()
            .unwrap_or_default();
        let bytes = serde_json::to_vec(&show.document).map_or(usize::MAX, |b| b.len());
        if quota.msg_bytes.is_some_and(|cap| bytes > cap as usize) {
            let what = "the revision is larger than this writer's messages may be";
            issues.push(Issue::envelope(
                "too_large",
                String::new(),
                json!(bytes),
                what,
            ));
        }
        let written = self.written.get(&writer.text());
        let new_doc = !written.is_some_and(|w| w.contains(&show.doc));
        if quota
            .docs
            .is_some_and(|cap| new_doc && written.map_or(0, |w| w.len()) >= cap as usize)
        {
            let what = "this writer writes no more shared documents";
            issues.push(Issue::envelope(
                "over_quota",
                "doc".into(),
                json!(show.doc),
                what,
            ));
        }
        let count = payload
            .get("items")
            .and_then(Value::as_object)
            .map_or(0, Map::len);
        if quota.items.is_some_and(|cap| count > cap as usize) {
            let what = "this writer's layer would hold more items than its quota";
            issues.push(Issue::envelope(
                "over_quota",
                "items".into(),
                json!(count),
                what,
            ));
        }
        for key in ["layers", "writer"] {
            if let Some(v) = payload.get(key) {
                issues.push(Issue::envelope(
                    "unknown_field",
                    key.into(),
                    v.clone(),
                    claimed,
                ));
            }
        }
        // The writer's layer, emptied, then filled with the payload's entries.
        if let Some(Value::Object(items)) = doc.get_mut("items") {
            items.retain(|_, i| i["layer"].as_str() != Some(layer.as_str()));
        }
        drop_owned(&mut doc, &mut owners, &layer);
        let mut view = Map::new();
        let empty = Map::new();
        for map in std::iter::once("items").chain(ID_MAPS.iter().copied()) {
            let mut stamped = Map::new();
            for (id, entry) in payload
                .get(map)
                .and_then(Value::as_object)
                .unwrap_or(&empty)
            {
                let mut entry = entry.clone();
                if map == "items" {
                    if let Some(l) = entry.get("layer") {
                        let path = format!("items/{id}/layer");
                        issues.push(Issue::error("unknown_field", id, path, l.clone(), claimed));
                    }
                    entry["layer"] = json!(layer);
                }
                if doc[map].get(id).is_some() {
                    let what = "another writer's layer holds this ID";
                    let path = format!("{map}/{id}");
                    issues.push(Issue::error("not_your_layer", id, path, json!(id), what));
                    continue;
                }
                if !doc[map].is_object() {
                    doc[map] = json!({});
                }
                doc[map][id] = entry.clone();
                if map != "items" {
                    owners.insert((map.to_string(), id.clone()), layer.clone());
                }
                stamped.insert(id.clone(), entry);
            }
            view.insert(map.to_string(), Value::Object(stamped));
        }

        // Diffed against what the writer's layer held; the planted twin against everything.
        let whole = self.scenario.planted == Some(Planted::DiffsWholeDocument);
        let held_by = |map: &str, id: &str, entry: &Value| {
            whole
                || if map == "items" {
                    entry["layer"].as_str() == Some(layer.as_str())
                } else {
                    was_owners.get(&(map.to_string(), id.to_string())) == Some(&layer)
                }
        };
        let view = Value::Object(view);
        let diff = whole_diff_by(
            Some(was_doc),
            &view,
            &held_by,
            &|_, _, _| true,
            &show.removes,
        );
        let diff = match diff {
            Ok(diff) => Some(diff),
            Err(missing) => {
                issues.extend(missing);
                None
            }
        };
        let changed = changed_between(was_doc, &doc);
        let started = Instant::now();
        let result = check_packed(&doc, &self.startup.sealed, &self.packs);
        let check_ms = started.elapsed().as_secs_f64() * 1000.0;
        let planted = self.scenario.planted;
        issues.extend(blocking(
            &result.issues,
            &last,
            &doc,
            &layer,
            &changed,
            planted,
        ));
        issues.extend(carried(&result.issues, &last, planted));
        issues.extend(foreign_writes(&doc, &owners, &layer));
        let mine = |id: &String| {
            ["bound_values", "status_bindings"]
                .iter()
                .any(|m| owners.get(&(m.to_string(), id.clone())) == Some(&layer))
        };
        let unreadable = unreadable_handles(&doc, |h| self.can_read(&writer, h));
        issues.extend(unreadable.into_iter().filter(|i| i.ids.iter().any(mine)));
        let mut drawn = None;
        // A revision with 3D writer layers renders back on the GPU (#378), as a sole writer's does.
        let three = deep_canvas_scene3d::scene::has_3d(&doc);
        if !three && !issues.iter().any(|i| i.severity == "error" && !i.carried) {
            // Each recipe instance's derived items draw in its place (#306).
            let shown = drawable(&crate::packs::drawn(&doc, &result.expansions));
            // #499: a video image item draws its frame at the revision's time.
            let (_, pictures) = self.videos_at(&shown, show.t, false);
            self.renderer.videos = pictures;
            match self.renderer.prepare(
                shown.as_object().expect("a document is an object"),
                show.t,
                &self.look.light,
                self.look.status.as_ref(),
                &self.record(),
                &self.scenario.evidence,
            ) {
                Ok(d) => drawn = Some(d),
                Err(Unfit { code, path }) => issues.push(unfit_issue(code, path)),
            }
        }
        reply.insert("rev".into(), json!(cur));
        let notices = self.notices_reply(&show.doc, &result.notices);
        if !notices.is_empty() {
            reply.insert("notices".into(), Value::Array(notices));
        }
        let timing = show.include.iter().any(|i| matches!(i, Include::Timing));
        let rules_ms =
            timing.then(|| crate::packs::timings(&doc, &result, &self.startup.sealed, &self.packs));
        crate::packs::reply(
            &result.expansions,
            Some((check_ms, rules_ms)),
            timing,
            &mut reply,
        );
        // #403: in a claim that names the document, an item of a kind this build doesn't know
        // blocks its checks, naming the kind, as on a sole writer's revision.
        let blocked = self.blocked_in_claim(show, &result.notices);
        if !blocked.is_empty() {
            reply.insert("blocked".into(), Value::Array(blocked));
        }
        if self.issue_reply(&issues, &mut reply) {
            return refused_reply(reply, &issues, show.check);
        }

        // Committed: the document becomes this revision, with its expansions (#306).
        self.expansions
            .insert(show.doc.clone(), result.expansions.clone());
        let shared = self.shared.get_mut(&show.doc).expect("open");
        let before = changed
            .iter()
            .filter(|id| shared.doc["items"].get(*id).is_some() || doc["items"].get(*id).is_some())
            .map(|id| (id.clone(), shared.doc["items"].get(id).cloned()))
            .collect();
        let patched = Patched {
            before,
            ..Patched::default()
        };
        let achieved = patched.achieved(&doc);
        let paths = paths_of(&patched.before, &doc);
        let envelope_before = Some(shared.envelope());
        let was = (
            std::mem::replace(&mut shared.doc, doc),
            std::mem::replace(&mut shared.owners, owners),
        );
        let rev = cur + 1;
        let next = Rev {
            rev,
            base_rev: cur,
            writer: Some(writer.clone()),
            patch: Some(ulid_of(&format!("{}|{rev}|whole", show.doc))),
            reason: "whole revision".into(),
            changed,
            before: patched.before,
            paths,
            envelope_before,
            issues: Rc::new(result.issues),
            notices: OnceCell::from(result.notices.clone()),
            hash: OnceCell::new(),
            current_at: None,
        };
        if !self.commit(&show.doc, next, session, &recorded_by(&show.via), &achieved) {
            let shared = self.shared.get_mut(&show.doc).expect("open");
            (shared.doc, shared.owners) = was;
            reply.insert("outcome".into(), json!("refused"));
            return Value::Object(reply);
        }
        self.written
            .entry(writer.text())
            .or_default()
            .insert(show.doc.clone());
        self.shared.get_mut(&show.doc).expect("open").find_older();
        reply.insert("rev".into(), json!(rev));
        if let Some(diff) = diff {
            diff_reply(diff, &mut reply);
        }
        let visible = panel.visible;
        if three && visible && show.include.iter().any(|i| matches!(i, Include::Pixels)) {
            let shown = self.shared[&show.doc].doc.clone();
            self.pending3d = Some(self.draw3d(&shown, show.t, show.size));
            self.pending_light = self.light3d(&shown, show.t);
        }
        self.present(show, visible, drawn.as_ref(), reply)
    }

    /// `read`: the revision shown, as the reader sees it.
    pub fn read(&mut self, doc: &str, via: Option<&Via>) -> Value {
        let reader = via.and_then(|v| self.acting(v)).map(|(w, _)| w);
        let (Some(k), Some(shared)) = (self.shown(doc), self.shared.get(doc)) else {
            // A deep_show document (one writer's layer, #393) reads as its current revision,
            // stored as its check stamped it (#1162).
            let current = self
                .revisions
                .get(doc)
                .and_then(|rows| rows.iter().find(|r| r.state == "current"));
            return match current {
                Some(row) => json!({"rev": row.rev, "hash": row.hash, "draws": draws(&row.doc),
                                    "issues": [], "document": row.doc}),
                None => json!({"outcome": "refused", "code": "ref_unresolved"}),
            };
        };
        let (shown, owners) = shared.at(k);
        let layer = reader.as_ref().and_then(|w| layer_of(&shown, w));
        let in_layer = |id: &String| shown["items"][id]["layer"].as_str() == layer.as_deref();
        let issues: Vec<Value> = shared.revs[k]
            .issues
            .iter()
            .filter(|i| reader.is_none() || i.ids.iter().any(in_layer))
            .map(Issue::to_json)
            .collect();
        let mut reply = Map::new();
        reply.insert("rev".into(), json!(shared.revs[k].rev));
        reply.insert("hash".into(), json!(shared.hash(k, &self.startup.sealed)));
        // What draws: with each instance's derived items and the expansions where the document
        // names packs (#306), the current revision's as its check made them; an older revision
        // is checked again for its own.
        if shown["packs"].as_array().is_some_and(|p| !p.is_empty()) {
            let current = k + 1 == shared.revs.len();
            match self.expansions.get(doc).filter(|_| current) {
                Some(expansions) => {
                    let drawn = crate::packs::drawn(&shown, expansions);
                    reply.insert("draws".into(), json!(draws(&drawn)));
                    crate::packs::reply(expansions, None, false, &mut reply);
                }
                None => {
                    let checked = check_packed(&shown, &self.startup.sealed, &self.packs);
                    let planted = self.scenario.planted;
                    let cache = &mut self.expansion_cache;
                    let expansions =
                        crate::packs::planted_cache(planted, cache, &shown, checked.expansions);
                    reply.insert("draws".into(), json!(draws(&checked.lowered)));
                    crate::packs::reply(&expansions, None, false, &mut reply);
                }
            }
        } else {
            reply.insert("draws".into(), json!(draws(&shown)));
        }
        reply.insert("issues".into(), json!(issues));
        // The notices of the revision's check, `migrated` among them (#1959).
        let notices = self.shared[doc].revs[k]
            .notices
            .get_or_init(|| check_packed(&shown, &self.startup.sealed, &self.packs).notices);
        reply.insert("notices".into(), json!(self.notices_reply(doc, notices)));
        reply.insert("files".into(), json!(files(doc, &shown, &owners)));
        // The document as the load's migration left it, before expansion (#1960).
        let opened = pack_kinds::loaded(&shown, &self.startup.sealed, &self.packs);
        reply.insert("opened".into(), opened);
        reply.insert("document".into(), shown.into_owned());
        if let Some(w) = reader {
            self.take_lost(doc, &w, &mut reply);
        }
        Value::Object(reply)
    }

    /// `history`: every revision that changed the item, in order.
    pub fn history(&self, doc: &str, item: &str) -> Value {
        let rows: Vec<Value> = self
            .shared
            .get(doc)
            .into_iter()
            .flat_map(|s| s.revs.iter())
            .filter(|r| r.changed.contains(item))
            .map(|r| {
                let writer = r.writer.as_ref().map(Writer::to_json);
                json!({"rev": r.rev, "patch": r.patch, "writer": writer, "reason": r.reason})
            })
            .collect();
        json!({"history": rows})
    }

    /// `by_writer`: each layer's writer, the items it holds now and the patches its writer
    /// applied, in order.
    pub fn by_writer(&self, doc: &str) -> Value {
        let (Some(k), Some(shared)) = (self.shown(doc), self.shared.get(doc)) else {
            return json!({"writers": []});
        };
        let (shown, _) = shared.at(k);
        let mut rows = Vec::new();
        for (layer, entry) in shown["layers"].as_object().into_iter().flatten() {
            let Some(writer) = entry["writer"].as_str().and_then(writer_of_text) else {
                continue;
            };
            let mut items: Vec<&String> = shown["items"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, i)| i["layer"].as_str() == Some(layer.as_str()))
                .map(|(id, _)| id)
                .collect();
            items.sort();
            let patches: Vec<&String> = shared.revs[..=k]
                .iter()
                .filter(|r| r.writer.as_ref() == Some(&writer))
                .filter_map(|r| r.patch.as_ref())
                .collect();
            rows.push(json!({"writer": writer.to_json(), "layer": layer, "items": items, "patches": patches}));
        }
        json!({"writers": rows})
    }

    /// `revisions` of a shared document: every committed revision, the newest current. A view of
    /// the record has none: it's rebuilt from projections as of an event (Revision).
    pub fn shared_revisions(&self, doc: &str) -> Value {
        let shared = &self.shared[doc];
        if shared.doc.get("source").is_some() {
            return json!({"revisions": []});
        }
        let last = shared.current().rev;
        let rows: Vec<Value> = shared
            .revs
            .iter()
            .enumerate()
            .map(|(k, r)| {
                json!({
                    "rev": r.rev,
                    "base_rev": r.base_rev,
                    "writer": r.writer.as_ref().map(Writer::to_json),
                    "hash": shared.hash(k, &self.startup.sealed),
                    "state": if r.rev == last { "current" } else { "superseded" },
                    "patches": r.patch.iter().collect::<Vec<_>>(),
                })
            })
            .collect();
        json!({"revisions": rows})
    }

    /// Runs the scenario's calls, one reply each in call order. On the clock, calls arrive at
    /// their `at`; each writer's patches wait in its own queue, and one checker takes them in
    /// turn across writers, one at a time, so one writer's flood never delays another's patch.
    pub fn run_calls(&mut self) -> Vec<Value> {
        // #499: the media module's own check reads its planted wrong program from here.
        deep_canvas_media::plant(self.scenario.module_planted.as_deref());
        self.open_shared();
        let calls = &self.scenario.calls;
        let Some(clock) = self.scenario.clock else {
            return calls.iter().map(|c| self.call(c)).collect();
        };
        let mut replies = vec![Value::Null; calls.len()];
        let mut order: Vec<usize> = (0..calls.len()).collect();
        order.sort_by_key(|i| (self.scenario.at[*i], *i));
        let fifo = self.scenario.planted == Some(Planted::OneFifoCheckQueue);
        let mut queues: Vec<(String, VecDeque<usize>)> = Vec::new();
        let mut turn = 0usize;
        let mut free_at = 0i64;
        let mut next = 0usize;
        loop {
            let queued = queues.iter().any(|(_, q)| !q.is_empty());
            let arrival = order.get(next).map(|i| self.scenario.at[*i]);
            match arrival {
                // What arrives by the time the checker is free is queued before it takes one.
                Some(at) if !queued || at <= free_at => {
                    let i = order[next];
                    next += 1;
                    // A plug-in's panel scripts run up to the call (#401), terminals take the
                    // output that arrived by then (#402), and captures the frames (#105).
                    self.advance_ring(at);
                    self.advance_terms(at);
                    self.advance_capture(at);
                    self.now = at;
                    let Call::Patch(p) = &calls[i] else {
                        replies[i] = self.call(&calls[i]);
                        continue;
                    };
                    let key = match (fifo, self.acting(&p.via)) {
                        (true, _) => String::new(),
                        (false, Some((w, _))) => w.text(),
                        (false, None) => {
                            replies[i] = self.patch(p, Some(at), at);
                            continue;
                        }
                    };
                    // A coalesce key keeps only the latest value: a waiting patch of this writer's
                    // with the same key is superseded by this one.
                    if let Some(c) = coalesce_key(p) {
                        let writer = self.acting(&p.via).map(|(w, _)| w.text());
                        for (_, q) in &mut queues {
                            let same = |j: &usize| match &calls[*j] {
                                Call::Patch(o) => {
                                    coalesce_key(o) == Some(c)
                                        && self.acting(&o.via).map(|(w, _)| w.text()) == writer
                                }
                                _ => false,
                            };
                            if let Some(k) = q.iter().position(same) {
                                let j = q.remove(k).expect("found");
                                let Call::Patch(o) = &calls[j] else { continue };
                                replies[j] = self.superseded(o, self.scenario.at[j], None, p);
                            }
                        }
                    }
                    let queued = queues.iter().any(|(_, q)| !q.is_empty());
                    if !queued {
                        free_at = free_at.max(at);
                    }
                    match queues.iter_mut().find(|(k, _)| *k == key) {
                        Some((_, q)) => q.push_back(i),
                        None => queues.push((key, VecDeque::from([i]))),
                    }
                }
                _ if queued => {
                    // The next writer in turn with a patch waiting.
                    let n = queues.len();
                    let w = (1..=n)
                        .map(|k| (turn + k) % n)
                        .find(|w| !queues[*w].1.is_empty())
                        .expect("a queue holds a patch");
                    turn = w;
                    let i = queues[w].1.pop_front().expect("not empty");
                    free_at += clock.check;
                    self.now = free_at;
                    let Call::Patch(p) = &calls[i] else {
                        unreachable!("only patches are queued")
                    };
                    replies[i] = self.patch(p, Some(self.scenario.at[i]), free_at);
                    // Over its quota with a coalesce key, a patch whose key a later patch of its
                    // writer's carries is superseded by that one instead.
                    let over = replies[i]["issues"]
                        .as_array()
                        .is_some_and(|l| l.iter().any(|x| x["code"] == "over_quota"));
                    if let (true, Some(c)) = (over, coalesce_key(p)) {
                        let writer = self.acting(&p.via).map(|(w, _)| w.text());
                        let later = queues.iter().flat_map(|(_, q)| q.iter()).find(|j| {
                            matches!(&calls[**j], Call::Patch(o) if coalesce_key(o) == Some(c)
                                && self.acting(&o.via).map(|(w, _)| w.text()) == writer)
                        });
                        if let Some(Call::Patch(o)) = later.map(|j| &calls[*j]) {
                            replies[i] = self.superseded(p, self.scenario.at[i], Some(free_at), o);
                        }
                    }
                }
                _ => break,
            }
        }
        // A patch reply the queue built itself, or a superseded one, skipped `call`'s stamp.
        for reply in &mut replies {
            self.stamp(reply);
        }
        replies
    }
}

/// #1972's planted fixes: a full path's fix that names `items/<path>` without the item's ID, and
/// the envelope's fix without `reason`.
fn planted_fix(planted: Option<Planted>, issues: &mut [Value]) {
    let reason = deep_canvas::document::patch_schema::ENVELOPE
        .iter()
        .find(|f| f.name == "reason")
        .map(|f| format!("\"reason\": <{}>, ", f.takes))
        .unwrap_or_default();
    for issue in issues {
        let Some(fix) = issue["fix"].as_str() else {
            continue;
        };
        let fix = match planted {
            Some(Planted::PatchFixPathWithoutId) if fix.contains("items/<id>/") => {
                let actual = issue["actual"].as_str().unwrap_or_default();
                format!("Write the path from its section: items/{actual}.")
            }
            Some(Planted::PatchFixEnvelopeWithoutReason) => fix.replace(&reason, ""),
            _ => continue,
        };
        issue["fix"] = json!(fix);
    }
}

/// The `(ID, path)` pairs a patch's ops write, the path below the item; `None` when an op writes
/// a whole item (a create, delete, move or reorder).
fn written_paths(patch: &Value) -> Option<Paths> {
    let mut out = Paths::new();
    for op in patch["ops"].as_array()? {
        let (Some("set" | "unset"), Some(id), Some(path)) =
            (op["op"].as_str(), op["id"].as_str(), op["path"].as_str())
        else {
            return None;
        };
        let rest = path.strip_prefix(&format!("items/{id}/"))?;
        out.insert((id.to_string(), rest.to_string()));
    }
    Some(out)
}

/// The planted path-granular rebase's merge: each path the patch wrote on its base, set to what
/// it holds there in the current document.
fn merge_paths(doc: &mut Value, on_base: &Value, patch: &Value) -> Patched {
    let mut done = Patched::default();
    for (id, path) in written_paths(patch).unwrap_or_default() {
        let before = doc["items"].get(&id).cloned();
        done.before.entry(id.clone()).or_insert(before);
        let parts: Vec<&str> = path.split('/').collect();
        let mut from = &on_base["items"][&id];
        for p in &parts {
            from = &from[*p];
        }
        let value = from.clone();
        let Some((last, head)) = parts.split_last() else {
            continue;
        };
        let mut at = &mut doc["items"][&id];
        for p in head {
            at = &mut at[*p];
        }
        match (value.is_null(), at.as_object_mut()) {
            (true, Some(map)) => {
                map.shift_remove(*last);
            }
            (false, _) => at[*last] = value,
            _ => {}
        }
    }
    done
}

/// A patch's coalesce key.
fn coalesce_key(call: &PatchCall) -> Option<&str> {
    match &call.body {
        Body::Patch(p) => p["coalesce_key"].as_str(),
        Body::Undo { .. } => None,
    }
}

impl Hub<'_> {
    /// The reply of a patch a later one with its coalesce key superseded: nothing applied, and
    /// the patch that carries its value.
    fn superseded(
        &self,
        call: &PatchCall,
        arrived: i64,
        checked: Option<i64>,
        by: &PatchCall,
    ) -> Value {
        let rev = self.shared.get(&call.doc).map_or(0, |s| s.current().rev);
        let by = match &by.body {
            Body::Patch(p) => p["patch"].clone(),
            Body::Undo { patch, .. } => json!(patch),
        };
        json!({
            "outcome": "superseded",
            "rev": rev,
            "superseded_by": by,
            "ids": {},
            "achieved": {"created": {}, "updated": 0, "deleted": {}, "unchanged": true},
            "issues": [],
            "cost_delta": {"cpu_ms": 0, "gpu_ms": 0, "vertices": 0, "lights": 0, "gpu_mb": 0},
            "undo": [],
            "arrived": arrived,
            "checked": checked,
            "current": null,
        })
    }
}

/// The paths a revision wrote, as `(ID, path)`: `""` for an item it created or deleted, else
/// each field of the item it changed, and each member of `params` and `at` (Patch: an undo is
/// refused if another writer has touched those paths since).
pub fn paths_of(before: &BTreeMap<String, Option<Value>>, doc: &Value) -> Paths {
    let mut out = Paths::new();
    for (id, was) in before {
        match (was, doc["items"].get(id)) {
            (Some(Value::Object(a)), Some(Value::Object(b))) => {
                let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
                for k in keys.into_iter().filter(|k| a.get(*k) != b.get(*k)) {
                    match (a.get(k), b.get(k)) {
                        (Some(Value::Object(x)), Some(Value::Object(y)))
                            if k == "params" || k == "at" =>
                        {
                            let members: BTreeSet<&String> = x.keys().chain(y.keys()).collect();
                            for m in members.into_iter().filter(|m| x.get(*m) != y.get(*m)) {
                                out.insert((id.clone(), format!("{k}/{m}")));
                            }
                        }
                        _ => {
                            out.insert((id.clone(), k.clone()));
                        }
                    }
                }
            }
            (a, b) if a.as_ref() != b => {
                out.insert((id.clone(), String::new()));
            }
            _ => {}
        }
    }
    out
}
