//! The GPU seam (issue #140; canvas primitives: Seam and backend; technical design: the GPU
//! backend among the platform seams): its backend's name and version, the tier's feature table
//! checked at startup, the quirk table as reviewed data, and the adapter it picks. A feature is
//! withheld at device creation only by `--withhold` or a quirk row, never by a code branch, and
//! the quirk table's digest enters every content key and result the backend feeds.

use serde_json::{json, Value};

pub use deep_canvas_seams::Backend;

/// The GPU seam's backend in this build: wgpu on the platform's API, its version wgpu's own.
pub const BACKEND: Backend = Backend {
    name: if cfg!(target_os = "macos") {
        "wgpu-metal"
    } else {
        "wgpu"
    },
    version: env!("DEEP_WGPU_VERSION"),
};

/// A row of a tier's feature table: a required row refuses an adapter without it; a gated row
/// names the fallback its absent path takes and the fixtures of the paths it gates.
#[derive(Clone, Copy, Debug)]
pub struct Row {
    pub feature: &'static str,
    pub wgpu: wgpu::Features,
    pub required: bool,
    pub fallback: Option<&'static str>,
    pub fixtures: &'static [&'static str],
}

impl Row {
    pub fn json(&self) -> Value {
        let flags: Vec<&str> = self.wgpu.iter_names().map(|(n, _)| n).collect();
        json!({"feature": self.feature, "wgpu": flags, "required": self.required, "fallback": self.fallback, "fixtures": self.fixtures})
    }
}

/// The macOS tier: Apple GPUs on Metal.
pub const TIER: &str = "metal-apple";

/// The macOS tier's feature table (technical design: the GPU backend's feature table per tier).
pub const TABLE: [Row; 3] = [
    // Texture maps transcode to BC on macOS, and the decoded-image cap counts the reference Mac's
    // BC bytes (canvas primitives: Material: texture maps), so the tier has no path without it.
    Row {
        feature: "texture_compression_bc",
        wgpu: wgpu::Features::TEXTURE_COMPRESSION_BC,
        required: true,
        fallback: None,
        fixtures: &[],
    },
    Row {
        feature: "timestamps",
        wgpu: wgpu::Features::TIMESTAMP_QUERY,
        required: false,
        fallback: Some("cpu_timing"),
        fixtures: &["pass_timing"],
    },
    Row {
        feature: "depth_clip_control",
        wgpu: wgpu::Features::DEPTH_CLIP_CONTROL,
        required: false,
        fallback: Some("pancaked_near_plane"),
        fixtures: &["depth_clip"],
    },
];

pub fn row(feature: &str) -> Option<&'static Row> {
    TABLE.iter().find(|r| r.feature == feature)
}

/// The table's features whose every flag `features` has.
pub fn holds(features: wgpu::Features) -> Vec<&'static str> {
    TABLE
        .iter()
        .filter(|r| features.contains(r.wgpu))
        .map(|r| r.feature)
        .collect()
}

/// The required features a device lacks, read from the device itself.
pub fn missing(device: &wgpu::Device) -> Vec<&'static str> {
    let has = device.features();
    TABLE
        .iter()
        .filter(|r| r.required && !has.contains(r.wgpu))
        .map(|r| r.feature)
        .collect()
}

/// An adapter as the seam reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub name: String,
    pub vendor: u32,
    pub device: u32,
    pub driver: String,
    /// `integrated_gpu`, `discrete_gpu`, `virtual_gpu`, `cpu` or `other`.
    pub kind: String,
    pub memory: u64,
    /// A test adapter standing on the platform's (test-seam builds).
    pub test: bool,
}

impl Identity {
    pub fn json(&self) -> Value {
        json!({"name": self.name, "vendor": self.vendor, "device": self.device, "driver": self.driver,
            "type": self.kind, "memory": self.memory, "test": self.test})
    }
}

/// A row of the quirk table: on its backend, an adapter matching every field the row gives has
/// the row's feature withheld at device creation, for the row's reason.
#[derive(Clone, Debug)]
pub struct Quirk {
    pub backend: String,
    pub vendor: Option<u32>,
    pub device: Option<u32>,
    pub driver: Option<String>,
    pub withholds: Option<&'static str>,
    pub reason: String,
}

impl Quirk {
    fn matches(&self, a: &Identity) -> bool {
        self.backend == BACKEND.name
            && self.vendor.is_none_or(|v| v == a.vendor)
            && self.device.is_none_or(|d| d == a.device)
            && self.driver.as_ref().is_none_or(|d| *d == a.driver)
    }
}

/// The quirk table, reviewed data in this crate (`quirks.json`), and its digest.
#[derive(Clone, Debug)]
pub struct Quirks {
    pub rows: Vec<Quirk>,
    pub digest: String,
}

impl Quirks {
    pub fn shipped() -> Quirks {
        Quirks::parse(include_str!("quirks.json")).expect("the shipped quirk table reads")
    }

    /// `{"rows": [{"backend", "match": {"vendor"?, "device"?, "driver"?}, "withholds"?,
    /// "workaround"?, "reason"}]}`. No backend has a workaround yet, so a row turning one on is
    /// refused rather than read as doing nothing.
    pub fn parse(text: &str) -> Result<Quirks, String> {
        let v: Value = serde_json::from_str(text).map_err(|e| format!("the quirk table: {e}"))?;
        let mut rows = Vec::new();
        for (i, r) in v["rows"]
            .as_array()
            .ok_or("the quirk table has no rows")?
            .iter()
            .enumerate()
        {
            let m = &r["match"];
            let id = |k: &str| match &m[k] {
                Value::Null => Ok(None),
                x => x
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .map(Some)
                    .ok_or(format!("quirk row {i}: match.{k} is a number")),
            };
            let withholds = match r["withholds"].as_str() {
                None => None,
                Some(f) => Some(
                    row(f)
                        .ok_or(format!(
                            "quirk row {i} withholds {f}, which the {TIER} table doesn't hold"
                        ))?
                        .feature,
                ),
            };
            if let Some(w) = r["workaround"].as_str() {
                return Err(format!(
                    "quirk row {i} turns on {w}, a workaround no backend has"
                ));
            }
            let text = |k: &str| {
                r[k].as_str()
                    .map(String::from)
                    .ok_or(format!("quirk row {i}: {k}"))
            };
            rows.push(Quirk {
                backend: text("backend")?,
                vendor: id("vendor")?,
                device: id("device")?,
                driver: m["driver"].as_str().map(String::from),
                withholds,
                reason: text("reason")?,
            });
        }
        let digest = deep_canvas::canon::revision_hash(&v, &deep_canvas::canon::NoShape)
            .map_err(|e| format!("the quirk table: {e}"))?;
        Ok(Quirks { rows, digest })
    }
}

/// What the seam starts from.
#[derive(Clone)]
pub struct Startup {
    /// Features of the table withheld at device creation on the picked adapter.
    pub withhold: Vec<&'static str>,
    pub quirks: Quirks,
    /// Test adapters enumerated in place of the platform's (test-seam builds), each standing on
    /// the platform's first adapter and reporting exactly the table features listed with it.
    pub adapters: Option<Vec<(Identity, Vec<&'static str>)>>,
    /// Planted `picks_first_adapter`: the first adapter enumerated, whatever it grants.
    pub picks_first: bool,
    /// Planted `withholds_in_code`: the first gated feature withheld by a code branch on vendor
    /// 4660 and device 22136, with no quirk row.
    pub withholds_in_code: bool,
}

impl Default for Startup {
    fn default() -> Self {
        Startup {
            withhold: Vec::new(),
            quirks: Quirks::shipped(),
            adapters: None,
            picks_first: false,
            withholds_in_code: false,
        }
    }
}

/// The adapter the seam picked and what its device is created with.
#[derive(Clone, Debug)]
pub struct Choice {
    pub adapter: Identity,
    pub raw: wgpu::Adapter,
    /// The table's features the adapter reports.
    pub reported: Vec<&'static str>,
    /// Those withheld at device creation by `--withhold` or a quirk row.
    pub withheld: Vec<&'static str>,
    /// The quirk table's digest.
    pub quirks: String,
    pub request: wgpu::Features,
}

/// A startup the seam refuses: `missing_feature` (an adapter without a required feature) or
/// `no_device`.
#[derive(Clone, Debug)]
pub struct Refusal {
    pub code: &'static str,
    pub adapter: Option<String>,
    pub missing: Vec<&'static str>,
    pub reason: String,
}

impl Refusal {
    pub fn no_device(reason: impl Into<String>) -> Refusal {
        Refusal {
            code: "no_device",
            adapter: None,
            missing: Vec::new(),
            reason: reason.into(),
        }
    }
}

fn kind(t: wgpu::DeviceType) -> &'static str {
    match t {
        wgpu::DeviceType::IntegratedGpu => "integrated_gpu",
        wgpu::DeviceType::DiscreteGpu => "discrete_gpu",
        wgpu::DeviceType::VirtualGpu => "virtual_gpu",
        wgpu::DeviceType::Cpu => "cpu",
        wgpu::DeviceType::Other => "other",
    }
}

/// The memory an adapter reports: on Metal, the working set its device recommends.
fn memory(a: &wgpu::Adapter) -> u64 {
    #[cfg(target_os = "macos")]
    {
        use objc2_metal::MTLDevice as _;
        // SAFETY: the Metal adapter is only read, while `a` keeps it alive.
        if let Some(hal) = unsafe { a.as_hal::<wgpu::hal::api::Metal>() } {
            return hal.raw_device().recommendedMaxWorkingSetSize();
        }
    }
    let _ = a;
    0
}

/// Picks the adapter that grants the most of the tier's features, ties to the highest reported
/// memory, then to enumeration order.
pub fn pick(startup: &Startup) -> Result<Choice, Refusal> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let platform = pollster::block_on(instance.enumerate_adapters(wgpu::Backends::PRIMARY));
    let candidates: Vec<(Identity, Vec<&'static str>, wgpu::Adapter)> = match &startup.adapters {
        Some(test) => {
            let raw = platform
                .first()
                .ok_or_else(|| Refusal::no_device("no GPU adapter"))?;
            test.iter()
                .map(|(a, reported)| (a.clone(), reported.clone(), raw.clone()))
                .collect()
        }
        None => platform
            .into_iter()
            .map(|raw| {
                let info = raw.get_info();
                let a = Identity {
                    name: info.name.clone(),
                    vendor: info.vendor,
                    device: info.device,
                    driver: format!("{} {}", info.driver, info.driver_info)
                        .trim()
                        .to_string(),
                    kind: kind(info.device_type).into(),
                    memory: memory(&raw),
                    test: false,
                };
                (a, holds(raw.features()), raw)
            })
            .collect(),
    };
    let mut best: Option<(usize, Choice)> = None;
    for (adapter, reported, raw) in candidates {
        let rows: Vec<&str> = startup
            .quirks
            .rows
            .iter()
            .filter(|q| q.matches(&adapter))
            .filter_map(|q| q.withholds)
            .collect();
        let withheld: Vec<&'static str> = reported
            .iter()
            .copied()
            .filter(|f| startup.withhold.contains(f) || rows.contains(f))
            .collect();
        let mut granted: Vec<&'static str> = reported
            .iter()
            .copied()
            .filter(|f| !withheld.contains(f))
            .collect();
        if startup.withholds_in_code && adapter.vendor == 4660 && adapter.device == 22136 {
            let first = TABLE.iter().find(|r| !r.required).map(|r| r.feature);
            granted.retain(|f| Some(*f) != first);
        }
        let mut request = granted
            .iter()
            .filter_map(|f| row(f))
            .fold(wgpu::Features::empty(), |all, r| all | r.wgpu);
        // The meter's timestamps inside encoders and passes come with pass timestamps (#379).
        if request.contains(wgpu::Features::TIMESTAMP_QUERY) {
            request |= raw.features()
                & (wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS
                    | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES);
        }
        let better = best.as_ref().is_none_or(|(n, b)| {
            !startup.picks_first && (granted.len(), adapter.memory) > (*n, b.adapter.memory)
        });
        if better {
            let choice = Choice {
                adapter,
                raw,
                reported,
                withheld,
                quirks: startup.quirks.digest.clone(),
                request,
            };
            best = Some((granted.len(), choice));
        }
    }
    best.map(|(_, c)| c)
        .ok_or_else(|| Refusal::no_device("no GPU adapter"))
}

#[cfg(test)]
mod tests {
    use super::{Quirks, BACKEND};

    /// The backend's version is the wgpu this crate is locked to, so a new wgpu misses every
    /// cache its old version keyed.
    #[test]
    fn the_backend_version_is_wgpus() {
        let lock = include_str!("../../../Cargo.lock");
        assert!(lock.contains(&format!(
            "name = \"wgpu\"\nversion = \"{}\"",
            BACKEND.version
        )));
    }

    /// The shipped quirk table reads, and a changed reason changes its digest.
    #[test]
    fn a_changed_row_changes_the_digest() {
        let row = |reason: &str| {
            format!(
                r#"{{"rows": [{{"backend": "wgpu-metal", "match": {{"vendor": 1}}, "withholds": "timestamps", "reason": "{reason}"}}]}}"#
            )
        };
        let a = Quirks::parse(&row("a")).unwrap();
        assert_eq!(a.rows[0].withholds, Some("timestamps"));
        assert_ne!(a.digest, Quirks::parse(&row("b")).unwrap().digest);
        assert!(Quirks::shipped().rows.is_empty());
    }
}
