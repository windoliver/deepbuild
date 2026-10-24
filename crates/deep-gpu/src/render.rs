//! Render modules (issue #377): what draws into a GPU surface's slot. A render module declares
//! every GPU resource it holds, so a lost device rebuilds each of them from the module's own
//! inputs, and its passes, each into one of the frame's places. It hands the frame one encode per
//! pass, which the encode workers record in parallel and submit in the passes' frame order.

use std::collections::HashSet;
use std::sync::Arc;

use deep_canvas::registry::PLACES;

use crate::device::Device;
use crate::encode::Job;

/// What a frame's encodes draw into.
#[derive(Clone)]
pub struct Target {
    pub frame: u64,
    pub size: [u32; 2],
    pub view: wgpu::TextureView,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Resolution {
    Full,
    Half,
    Quarter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Determinism {
    Exact,
    SameMachine,
    LiveOnly,
}

/// A pass a render module adds to the frame: into one of the frame's places at an order key, with
/// the targets it reads and writes, its resolution, its cost and its determinism class.
#[derive(Clone, Debug)]
pub struct Pass {
    pub name: String,
    pub place: &'static str,
    pub order: u32,
    pub reads: Vec<&'static str>,
    pub writes: Vec<&'static str>,
    pub resolution: Resolution,
    pub ns_per_px: f32,
    pub determinism: Determinism,
}

/// The passes' names in frame order: by place, then order key, then name. Refuses a pass into a
/// place that isn't one, a cost that isn't a finite non-negative number, two passes of one name,
/// and a read of a target no earlier pass writes, since a pass sees only targets earlier in that
/// order.
pub fn plan(passes: &[Pass]) -> Result<Vec<String>, String> {
    let mut placed = Vec::with_capacity(passes.len());
    for p in passes {
        let place = PLACES.iter().position(|q| *q == p.place).ok_or_else(|| {
            format!(
                "illegal_place: pass `{}` goes into `{}`, which is not a place",
                p.name, p.place
            )
        })?;
        if !(p.ns_per_px.is_finite() && p.ns_per_px >= 0.0) {
            return Err(format!(
                "bad_cost: pass `{}` declares {} ns per pixel",
                p.name, p.ns_per_px
            ));
        }
        placed.push((place, p));
    }
    placed.sort_by(|(a, p), (b, q)| (a, p.order, &p.name).cmp(&(b, q.order, &q.name)));
    let mut written: HashSet<&str> = HashSet::new();
    let mut names: Vec<String> = Vec::with_capacity(placed.len());
    for (_, p) in placed {
        if names.contains(&p.name) {
            return Err(format!("duplicate_pass: two passes named `{}`", p.name));
        }
        if let Some(t) = p.reads.iter().find(|t| !written.contains(**t)) {
            return Err(format!(
                "unwritten_read: pass `{}` reads `{t}`, which no earlier pass writes",
                p.name
            ));
        }
        written.extend(p.writes.iter().copied());
        names.push(p.name.clone());
    }
    Ok(names)
}

pub trait RenderModule: Send {
    fn name(&self) -> &'static str;
    /// The names of the GPU resources it declares.
    fn declared(&self) -> Vec<&'static str>;
    /// The passes it adds to the frame.
    fn passes(&self) -> Vec<Pass>;
    /// Builds (or, after a device loss, rebuilds) every declared resource on `device`.
    fn build(&mut self, device: &Device) -> Result<(), String>;
    /// The device epoch its declared resources were last built on.
    fn built_on(&self) -> Option<u64>;
    /// What the last build left to upload (asset bytes for the buffers it made), which the view
    /// writes over later frames within the budget class's `upload_bytes_per_frame`.
    fn take_uploads(&mut self) -> Vec<(wgpu::Buffer, Arc<[u8]>)> {
        Vec::new()
    }
    /// The frame's encodes, each named by the pass it records.
    fn layers(&mut self, device: &Device, target: &Target) -> Vec<(String, Job)>;
}
