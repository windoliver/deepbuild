//! A revision's drawn form checked (#306, #387), and the revision made its session's current one:
//! what a whole revision shares with a patch to a minted document and with a document opened from
//! the record (#1721).

use super::*;

impl Hub<'_> {
    /// The form that draws: `doc` with each recipe instance's derived items in its place (#306),
    /// less the items in `skipped` (#403), its check phases and, for a session on screen, its frame
    /// at `t`, run clean before it becomes current: what an operator can't evaluate is an issue of
    /// the revision too, naming the operator's module (#387). A read an operator didn't declare is
    /// the module's fault, not the document's, so it fails the frame and refuses nothing. The frame
    /// is run only while `issues`, which what it finds is added to, holds no error.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn checked_form(
        &mut self,
        doc_id: &str,
        doc: &Value,
        expansions: &[Expansion],
        skipped: &[String],
        t: i64,
        timing: Option<&mut Map<String, Value>>,
        issues: &mut Vec<Issue>,
    ) -> Value {
        let drawn = crate::packs::drawn(doc, expansions);
        let mut form = crate::verdict::without(&drawn, skipped);
        if let Err(r) = self.inline_tables(&mut form) {
            issues.push(unfit_issue(r.code, r.path));
        }
        issues.extend(self.inline_vectors(&mut form));
        issues.extend(crate::picks::check(&form));
        // #466: an operator transition's pass, checked before any frame draws it.
        issues.extend(crate::film_operator::check(&form));
        issues.extend(deep_canvas_input::point::check(&form));
        // #542: text and scroll controls' fields.
        issues.extend(deep_canvas_input::text::check(&form));
        issues.extend(deep_canvas_input::scroll::check(&form));
        // #903: the tour's keys.
        issues.extend(deep_canvas_input::tour::check(&form));
        // #544: a spawn's reads of a logic item's occurrences, checked against its emits
        // before any step runs; then the logic items baked into the lists their readers read.
        if !deep_canvas_media::planted("undeclared_field_reads_zero") {
            issues.extend(crate::spawn::undeclared_issues(&form));
        }
        issues.extend(self.inline_baked(&mut form));
        // #533: then each logic item's program inlined for the logic module's steps.
        self.inline_programs(&mut form);
        // Mark set columns that read a column source, resolved and narrowed by the core's
        // column view at the frame's step (#397); #538: and keyed copy's fit check, timed.
        issues.extend(self.checked_view(doc_id, &mut form, t, timing));
        if issues.iter().any(|i| i.severity == "error" && !i.carried) {
            return form;
        }
        let visible = self.doc_visible(doc_id);
        let (op_issues, drawing) = self.probe(&form, t, visible, None);
        for i in op_issues.iter().filter(|i| i.code != "undeclared_read") {
            issues.push(op_issue(i));
        }
        if let Some(drawing) = drawing.filter(|_| op_issues.is_empty()) {
            // #499: a video image item draws its frame at the revision's time.
            let (_, pictures) = self.videos_at(doc, t, false);
            self.renderer.videos = pictures;
            if let Err(Unfit { code, path }) = self
                .renderer
                .prepare_drawing(&drawing, &self.scenario.evidence)
            {
                issues.push(unfit_issue(code, path));
            }
        }
        form
    }

    /// `row` as the newest revision of `doc`, in the current one's place unless it is refused.
    pub(crate) fn push_row(&mut self, doc: &str, row: Row) {
        let rows = self.revisions.entry(doc.to_string()).or_default();
        if row.state == "current" {
            for r in rows.iter_mut().filter(|r| r.state == "current") {
                r.state = "superseded";
            }
        }
        rows.push(row);
    }

    /// The checked revision that draws `form` becomes `doc`'s session's current one, shown at `t`.
    pub(crate) fn make_current(&mut self, doc: &str, form: Value, t: i64) {
        if !self.sessions.contains_key(doc) {
            let fresh = self.new_session();
            self.sessions.insert(doc.to_string(), fresh);
        }
        // #1967: a recording this revision's cell grids play, converted at its probe.
        let readings = self.readings();
        if let Some(s) = self.sessions.get_mut(doc) {
            s.set_readings(readings);
        }
        // #504: the session loads the played form: the drawn form with the document's input track
        // and the session's picks, shown at `t`.
        let again = self.forms.insert(doc.to_string(), form).is_some();
        if again && self.planted(Planted::ReloadRebuildsEveryPart) {
            // Planted (#504): a revision presented again rebuilds every part, kept or cached.
            let startup = self.startup;
            self.sched = Scheduler::new(&startup.sealed, self.options());
            let fresh = self.new_session();
            self.sessions.insert(doc.to_string(), fresh);
        }
        self.replay(doc, t);
        self.first_frames.remove(doc);
        self.asleep.remove(doc);
    }
}
