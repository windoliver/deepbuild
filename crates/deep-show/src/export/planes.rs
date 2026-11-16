//! Issue #518: `frame_planes`, the export's GPU conversion pass on given BGRA8 frames from the
//! evidence store, as `frame_hash` is its hash pass on given frames: each frame's NV12 planes,
//! the Y plane and the interleaved CbCr plane, kept in the evidence store by SHA-256.

use serde_json::{json, Value};

use super::{no_software_adapter, Guard};
use crate::hub::Hub;

impl Hub<'_> {
    /// The conversion pass an export runs for a 4:2:0 codec, or the planted pass that rounds
    /// each block's chroma down.
    pub(super) fn nv12_pass(&self, gpu: &deep_gpu::device::Device) -> deep_gpu::nv12::Nv12 {
        let planted = deep_gpu::nv12::Planted {
            chroma_rounds_down: self.guard_planted(Guard::Nv12RoundsDown),
        };
        deep_gpu::nv12::Nv12::new(&gpu.device, planted)
    }

    /// `frame_planes`: each frame's Y and CbCr planes by the export's conversion pass.
    pub fn frame_planes(&mut self, frames: &[([u32; 2], String)], software: bool) -> Value {
        if software {
            return no_software_adapter();
        }
        let Some(gpu) = self.gpu3().map(|g| g.device().clone()) else {
            return json!({"outcome": "refused", "code": "gpu_unavailable"});
        };
        let pass = self.nv12_pass(&gpu);
        let hash = deep_gpu::blake3::Blake3::new(&gpu.device, Default::default());
        let lost = || json!({"outcome": "refused", "code": "device_lost"});
        let mut planes = Vec::new();
        for ([w, h], sha) in frames {
            let Some(bytes) = crate::evidence::read(&self.scenario.evidence, sha) else {
                return json!({"outcome": "refused", "code": "unknown_asset", "asset": sha});
            };
            let even = *w > 0 && *h > 0 && w % 2 == 0 && h % 2 == 0;
            if !even || bytes.len() as u64 != u64::from(*w) * u64::from(*h) * 4 {
                return json!({"outcome": "refused", "code": "bad_frame", "asset": sha, "size": [w, h]});
            }
            let mut hashed = hash.frames(&gpu.device, &gpu.queue, [*w, *h]);
            let mut converted = pass.planes(&gpu.device, &gpu.queue, &hashed, [*w, *h]);
            let nv12 = hashed
                .push(&bytes)
                .and_then(|_| converted.after_push())
                .and_then(|_| converted.finish());
            let Ok(Some(nv12)) = nv12 else {
                return lost();
            };
            let (y, cbcr) = nv12.split_at((*w * *h) as usize);
            let put = |plane: &[u8]| crate::evidence::put(&self.scenario.evidence, plane);
            match (put(y), put(cbcr)) {
                (Ok(y), Ok(cbcr)) => planes.push(json!({"y": y, "cbcr": cbcr})),
                _ => return json!({"outcome": "refused", "code": "evidence_unwritable"}),
            }
        }
        let adapter = gpu.adapter.as_ref().map(|a| a.name.clone());
        json!({"outcome": "converted", "planes": planes, "conversion": deep_gpu::nv12::VERSION,
            "adapter": {"name": adapter, "software": false}})
    }
}
