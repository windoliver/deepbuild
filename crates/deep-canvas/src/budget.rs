//! Budget classes (issue #379; canvas primitives: The cost model, its budget class table). A
//! document names its class in `budget.class` and may only tighten its caps; the check refuses a
//! document whose estimate passes them, and the meter steps a live view down against them.

use serde_json::Value;

/// A megabyte as the budget table writes it: 10^6 bytes.
pub const MB: u64 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Class {
    CoreView,
    DataView,
    Figure,
    WorkProduct,
    Showpiece,
    Export,
}

/// A class's caps, as the table gives them or a document tightened them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    /// Frame GPU and CPU time in ms; export has no frame cap.
    pub gpu_ms: Option<f64>,
    pub cpu_ms: Option<f64>,
    /// GPU memory per window (per film for export).
    pub gpu_bytes: u64,
    /// The render scale while moving: the class's base.
    pub scale_moving: f64,
}

pub const CLASSES: [Class; 6] = [
    Class::CoreView,
    Class::DataView,
    Class::Figure,
    Class::WorkProduct,
    Class::Showpiece,
    Class::Export,
];

impl Class {
    pub fn name(self) -> &'static str {
        match self {
            Class::CoreView => "core_view",
            Class::DataView => "data_view",
            Class::Figure => "figure",
            Class::WorkProduct => "work_product",
            Class::Showpiece => "showpiece",
            Class::Export => "export",
        }
    }

    pub fn parse(name: &str) -> Option<Class> {
        CLASSES.into_iter().find(|c| c.name() == name)
    }

    /// The budget class table's row.
    pub fn limits(self) -> Limits {
        let (gpu_ms, cpu_ms, mb, scale_moving) = match self {
            Class::CoreView => (Some(1.0), Some(2.0), 64, 1.0),
            Class::DataView => (Some(2.0), Some(2.0), 128, 1.0),
            Class::Figure => (Some(2.0), Some(4.0), 256, 1.0),
            Class::WorkProduct => (Some(2.0), Some(4.0), 256, 0.75),
            Class::Showpiece => (Some(10.0), Some(4.0), 256, 0.5),
            Class::Export => (None, None, 300, 1.0),
        };
        Limits {
            gpu_ms,
            cpu_ms,
            gpu_bytes: mb * MB,
            scale_moving,
        }
    }
}

/// The document's class and its caps, each the stricter of the class's and the document's
/// `budget`; `None` when it names no class (or one that isn't a class, which the check refuses).
pub fn of(doc: &Value) -> Option<(Class, Limits)> {
    let budget = doc.get("budget")?;
    let class = Class::parse(budget.get("class")?.as_str()?)?;
    let mut limits = class.limits();
    let tighter = |cap: Option<f64>, key: &str| match (cap, budget.get(key).and_then(Value::as_f64))
    {
        (Some(c), Some(d)) => Some(c.min(d)),
        (None, Some(d)) => Some(d),
        (c, None) => c,
    };
    limits.gpu_ms = tighter(limits.gpu_ms, "frame_gpu_ms");
    limits.cpu_ms = tighter(limits.cpu_ms, "frame_cpu_ms");
    if let Some(mb) = budget.get("gpu_mb").and_then(Value::as_f64) {
        limits.gpu_bytes = limits.gpu_bytes.min((mb * MB as f64) as u64);
    }
    Some((class, limits))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_document_only_tightens_its_class() {
        let (class, l) = of(&json!({"budget": {"class": "work_product", "frame_gpu_ms": 5, "frame_cpu_ms": 1, "gpu_mb": 512}})).unwrap();
        assert_eq!(class, Class::WorkProduct);
        assert_eq!(
            (l.gpu_ms, l.cpu_ms, l.gpu_bytes),
            (Some(2.0), Some(1.0), 256 * MB)
        );
        assert!(of(&json!({"budget": {"class": "huge"}})).is_none());
        assert!(of(&json!({})).is_none());
    }
}
