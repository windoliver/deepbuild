//! #2485: what effects.audit's host reads of a frame's particles: the overdraw target their
//! counted fragments add into, read back as the most any px took, and their passes' GPU times.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_scene3d_render::Profiler;

use super::{timings, Effects};
use crate::reference::target;

impl Effects {
    /// #2485: the overdraw target, made at `size` and cleared, which the frame's counted
    /// particles add their fragments into.
    pub(super) fn counts_job(&mut self, device: &Device, size: [u32; 2]) -> Job {
        if self.counts.as_ref().is_none_or(|c| c.0 != size) {
            let tex = target(device, "particles overdraw", size);
            let view = tex.create_view(&Default::default());
            self.counts = Some((size, tex, view));
        }
        let into = self.counts.as_ref().expect("made above").2.clone();
        Box::new(move |encoder| {
            encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("particles overdraw"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &into,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
        })
    }

    /// #2485: the most fragments any px took from the last frame's counted particles, taken so
    /// no later read reports them again; `None` when no frame counted them since.
    pub fn read_overdraw(&mut self, device: &Device) -> Option<u32> {
        let (_, tex, _) = self.counts.take()?;
        let bytes = crate::reference::read(device, &tex, wgpu::TextureAspect::All, 8);
        let (w, h) = (tex.width() as usize, tex.height() as usize);
        let row = (w * 8).div_ceil(256) * 256;
        let most = (0..h)
            .flat_map(|y| (0..w).map(move |x| y * row + x * 8))
            .map(|i| half(u16::from_le_bytes([bytes[i], bytes[i + 1]])))
            .fold(0.0f32, f32::max);
        Some(most.round() as u32)
    }
}

/// #2485: a profiler a host sets on its effects to time one frame's passes.
pub fn profiler(device: &Device) -> Option<Profiler> {
    let p = wgpu_profiler::GpuProfiler::new(&device.device, Default::default()).ok()?;
    Some(Arc::new(std::sync::Mutex::new(p)))
}

/// #2485: each pass's GPU time (ms) by label, of the frame `p` timed since it was set, once its
/// queries have resolved; empty where the device takes no timestamps.
pub fn pass_ms(device: &Device, p: &Profiler) -> BTreeMap<String, f64> {
    let mut p = p.lock().unwrap_or_else(|e| e.into_inner());
    let mut enc = device.device.create_command_encoder(&Default::default());
    p.resolve_queries(&mut enc);
    device.queue.submit([enc.finish()]);
    if p.end_frame().is_err() {
        return BTreeMap::new();
    }
    let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
    let period = device.queue.get_timestamp_period();
    let mut out = BTreeMap::new();
    while let Some(results) = p.process_finished_frame(period) {
        out = timings(&results).1;
    }
    out
}

/// An IEEE half's value.
fn half(bits: u16) -> f32 {
    let (sign, exp, frac) = (bits >> 15, (bits >> 10) & 0x1f, f32::from(bits & 0x3ff));
    let v = match exp {
        0 => frac * (-24f32).exp2(),
        31 => f32::INFINITY,
        e => (1.0 + frac / 1024.0) * (f32::from(e) - 15.0).exp2(),
    };
    if sign == 1 {
        -v
    } else {
        v
    }
}
