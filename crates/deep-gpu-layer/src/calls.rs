use serde_json::Value;

#[cfg(feature = "test-meter")]
use crate::allocations;
use crate::{
    budget, calibrate, columns, compare, compile, conformance, effects, envelope, film, fix,
    frames, full_lane, golden, guard, host, interp_suite, live, marks2d, opframe, parity,
    particles, plugin, records, refused, relation, seam, simplify, steps_ref, textures, timing,
    tone, trails, validation, view3d, App,
};

impl App {
    pub(super) fn call(&mut self, out: &str, call: &Value) -> Value {
        match call["call"].as_str() {
            Some("frames") => frames::call(self, out, call),
            Some("surface") => self.surface(),
            Some("resources") => self.resources(),
            Some("health") => self.health(),
            Some("buffer") => self.buffer(call),
            Some("conformance") => conformance::call(self, out, call),
            Some("render") => frames::render(self, call),
            Some("compile") => compile::call(self, call),
            Some("lose_device") => compile::lose_device(self),
            Some("release_job") => compile::release_job(self),
            Some("gated") => seam::gated(self, call),
            Some("seam_suite") => seam::seam_suite(self, out, call),
            Some("validate") => validation::validate(self, out, call),
            Some("check_render") => validation::check_render(self, call),
            Some("compare") => compare::compare(self, call),
            Some("declare_dark") => compare::declare(self, call),
            Some("decisions") => compare::decisions(self),
            Some("plugin") => plugin::call(self, out, call),
            Some("view3d") => view3d::call(self, out, call),
            Some("relation") => relation::call(self, out, call),
            Some("full_lane") => full_lane::call(self, out, call),
            Some("particles") => particles::call(self, out, call),
            Some("trail") => trails::call(self, out, call),
            Some("simplify") => simplify::call(out, call),
            Some("workers") => textures::workers(self),
            Some("tone") => tone::call(self, out, call),
            Some("host") => host::call(self, out, call),
            Some("guard") => guard::call(self, out, call),
            Some("operators") => effects::operators(self),
            Some("calibrate") => calibrate::calibrate(self),
            Some("reference") => effects::reference(self, out, call),
            Some("check_operator") if opframe::wants(call) => opframe::call(self, out, call),
            Some("check_operator") => effects::check_operator(self, out, call),
            Some("op") => effects::op(self, call),
            Some("columns") => columns::call(self, call),
            Some("exact") => effects::exact(self, out),
            Some("cross_gpu") => effects::cross_gpu(self, call),
            Some("index_record") => records::index_record(self, out, call),
            Some("cross_index") => records::cross_index(call),
            Some("op_table") => steps_ref::op_table(),
            Some("steps_reference") => steps_ref::steps_reference(self, out),
            Some("interp_suite") => interp_suite::call(self, call),
            Some("golden") => golden::golden(self, out, call),
            Some("decide") => golden::decide(self, call),
            Some("live") => live::call(self, out, call),
            #[cfg(feature = "test-faults")]
            Some("raise_errors") => self.raise_errors(call),
            Some("live_frame") => parity::live_frame(self, out, call),
            Some("layers") => marks2d::layers(self, out, call),
            Some("window2d") => marks2d::window2d(self, out, call),
            Some("vello_gpu") => marks2d::vello_gpu(self),
            Some("spike2d") => marks2d::spike2d(self, out, call),
            Some("film2d") => film::film2d(self, out, call),
            Some("canonical") => live::canonical(self, out, call),
            Some("frame_budget") => budget::call(self, call),
            Some("envelope") => envelope::call(self, out, call),
            Some("envelope_counts") => envelope::counts(self, call),
            Some("envelope_opens") => envelope::opens(self, call),
            Some("budget_fix") => fix::call(self, out, call),
            Some("adapter") => timing::adapter(self),
            Some("tick") => timing::tick(self, call),
            #[cfg(feature = "test-meter")]
            Some("allocate") => allocations::allocate(self, call),
            #[cfg(feature = "test-meter")]
            Some("release") => allocations::release(self, call),
            _ => refused("bad_input", "unknown call"),
        }
    }
}
