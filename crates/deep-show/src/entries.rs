//! Issue #297 (Text `text@1`: entries): what a text control an entry text shows takes, as it is
//! typed and as an entry, in the type the document's entry texts draw in; and the planted
//! controls and checks that take what they shouldn't.

use deep_canvas_marks::entries::{self, Lax, Refusal};
use deep_canvas_marks::scene::Type;
use serde_json::{json, Value};

use crate::hub::Hub;

/// The planted controls and checks of an entry's range: a check that takes a grapheme its faces
/// can't draw, a control that takes a grapheme that draws no ink, and one with no mark limit.
pub(crate) const TAKES_GLYPH: &str = "entry_takes_missing_glyph";
pub(crate) const TAKES_HIDDEN: &str = "control_takes_hidden";
pub(crate) const NO_MARK_LIMIT: &str = "control_no_mark_limit";
/// The planted text that normalizes the entry it shows to NFC on the input track.
pub(crate) const NORMALIZES_TRACK: &str = "entry_normalizes_track";
/// #297's planted names deep-show holds.
pub(crate) const PLANTED: [&str; 5] = [
    TAKES_GLYPH,
    TAKES_HIDDEN,
    NO_MARK_LIMIT,
    NORMALIZES_TRACK,
    OWN_ENTRIES_ONLY,
];

impl Hub<'_> {
    /// The type `form`'s entry texts draw in: the look it names, else the session's, light.
    pub(crate) fn entry_type(&self, form: &Value) -> Type {
        self.look_of(form)
            .map_or_else(|| self.look.light_type.clone(), |l| l.light_type)
    }

    /// The scenario's planted laxness of an entry's range.
    pub(crate) fn entry_lax(&self) -> Lax {
        let p = self.scenario.module_planted.as_deref();
        Lax {
            glyphs: p == Some(TAKES_GLYPH),
            hidden: p == Some(TAKES_HIDDEN),
            marks: p == Some(NO_MARK_LIMIT),
        }
    }

    /// Why `value` is out of the range of `form`'s text control `control`, which an entry text
    /// shows; `None` where it is in range or no entry text shows the control.
    pub(crate) fn entry_refused(
        &self,
        form: &Value,
        control: &str,
        value: &str,
    ) -> Option<Refusal> {
        let doc = form.as_object()?;
        if !entries::shown_control(doc, control) {
            return None;
        }
        let ty = self.entry_type(form);
        let mut shaper = deep_text::Shaper::new();
        entries::refused(doc, control, value, &ty, &mut shaper, self.entry_lax())
    }

    /// Whether the planted text that normalizes its entries to NFC on the track holds for
    /// `control` of `form`.
    pub(crate) fn normalizes_entries(&self, form: &Value, control: &str) -> bool {
        self.scenario.module_planted.as_deref() == Some(NORMALIZES_TRACK)
            && form
                .as_object()
                .is_some_and(|d| entries::shown_control(d, control))
    }

    /// Why typing `s` after `before` into `control` is refused, whole: the field as it would then
    /// hold it, judged as an entry is.
    pub(crate) fn typed_refused(
        &self,
        form: &Value,
        control: &str,
        before: &str,
        s: &str,
    ) -> Option<Refusal> {
        self.entry_refused(form, control, &format!("{before}{s}"))
    }
}

/// The planted copy that draws only its own viewer's entries.
pub(crate) const OWN_ENTRIES_ONLY: &str = "entry_own_viewer_only";

/// Whether any text or mark set of `form` shows an entry.
pub(crate) fn shows_entries(form: &Value) -> bool {
    let items = form.get("items").and_then(Value::as_object);
    items
        .into_iter()
        .flatten()
        .any(|(_, i)| entries::is_entry_text(i) || entries::has_entry_column(i))
}

impl Hub<'_> {
    /// `form`'s own frame at `t` as the copy of `player` draws it, from the copy's merged `track`
    /// (planted: only its own player's entries): its PNG's SHA-256 in the evidence store, and
    /// what its entry texts show.
    pub(crate) fn copy_frame(
        &mut self,
        form: &Value,
        track: Value,
        player: u8,
        t: i64,
    ) -> Result<(String, Value), Value> {
        let own = self.scenario.module_planted.as_deref() == Some(OWN_ENTRIES_ONLY);
        let kept: Vec<Value> = track
            .as_array()
            .into_iter()
            .flatten()
            .filter(|e| !own || e["player"] == player)
            .cloned()
            .collect();
        // The entry texts read the whole form (its net item seats the match), with the copy's
        // track, then the drawn items alone draw; the text module's plants apply as the scheduler's
        // operator applies them.
        let mut whole = form.clone();
        whole["track"] = json!(kept);
        let planted = entries::planted(self.scenario.module_planted.as_deref());
        let applied = whole.as_object().and_then(|d| {
            let items = d.get("items")?.as_object()?;
            entries::apply(d, items, t, planted)
        });
        if let Some(items) = applied {
            whole["items"] = Value::Object(items);
        }
        let doc = crate::shared::drawable(&whole);
        let marked = form.clone();
        let drawn = self
            .renderer
            .prepare(
                doc.as_object().expect("a document is an object"),
                t,
                (&self.look.light, &crate::snapshot::text_type(&self.look)),
                self.look.status.as_ref(),
                &self.record(),
                &self.scenario.evidence,
            )
            .map_err(|u| json!({"code": u.code, "path": u.path}))?;
        let shown = shown_of(&marked, Some(&drawn.frame), None);
        let size = crate::snapshot::px(drawn.frame.size);
        let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
        let png = crate::snapshot::png(self.renderer.raster(&drawn, size, Some(ground)), size);
        let sha = crate::evidence::put(&self.scenario.evidence, &png)
            .map_err(|_| json!({"code": "not_written"}))?;
        Ok((sha, Value::Object(shown)))
    }
}

/// The error an entry out of its range answers: the control, the value, why, and what it names.
pub(crate) fn refusal_json(control: &str, value: &Value, r: &Refusal) -> Value {
    let mut out =
        json!({"code": "out_of_range", "control": control, "value": value, "reason": r.reason()});
    for (k, v) in r.named().as_object().into_iter().flatten() {
        out[k] = v.clone();
    }
    out
}

/// `eval`'s `shown` (#297): for every entry text `doc` holds, the string `frame` draws for it,
/// keyed by its ID, and for every row of a mark set's entry column by `<set>#<key>`: the shaped
/// run's shown text, cut with `…` where it overflows; `""` for one that draws nothing. `runs`
/// are the text module's shaped runs, where the frame came from the scheduler.
pub(crate) fn shown_of(
    doc: &Value,
    frame: Option<&deep_canvas_marks::scene::Frame>,
    runs: Option<
        &std::collections::BTreeMap<String, std::sync::Arc<deep_canvas_marks::modules::Run>>,
    >,
) -> serde_json::Map<String, Value> {
    use deep_canvas_marks::scene::Mark;
    let items = doc.get("items").and_then(Value::as_object);
    let mut out = serde_json::Map::new();
    let mut sets = std::collections::BTreeSet::new();
    for (id, i) in items.into_iter().flatten() {
        if entries::is_entry_text(i) {
            out.insert(id.clone(), json!(""));
        }
        if entries::has_entry_column(i) {
            sets.insert(id.clone());
        }
    }
    let Some(frame) = frame else { return out };
    let mut shaper: Option<deep_text::Shaper> = None;
    for drawn in frame.layers.iter().flat_map(|l| (&l.marks).into_iter()) {
        let Mark::Text { item, spec, .. } = &drawn.mark else {
            continue;
        };
        let base = item.split('#').next().unwrap_or_default();
        let ours = (out.contains_key(item.as_str()) && !item.contains('#'))
            || (item.contains('#') && sets.contains(base));
        if !ours {
            continue;
        }
        let kept = runs.and_then(|r| r.get(item)).filter(|r| r.spec == *spec);
        let shown = match (kept, spec.shaper_spec()) {
            (Some(r), _) => r.shaped.shown.clone(),
            (None, Some(s)) => shaper
                .get_or_insert_with(deep_text::Shaper::new)
                .shape(&s)
                .shown
                .clone(),
            (None, None) => spec.text.clone(),
        };
        out.insert(item.clone(), json!(shown));
    }
    out
}
