use std::collections::BTreeMap;

#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub t: i64,
    pub size: [u32; 2],
    pub linear: Vec<f32>,
    pub exposure: f64,
    pub rgba: Vec<u8>,
    pub ids: Vec<u32>,
    pub picks: BTreeMap<u32, String>,
    pub roles: BTreeMap<String, [u8; 3]>,
    pub reduce: Option<Reduce>,
    pub passes: BTreeMap<String, ItemPass>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ItemPass {
    pub overdraw: Option<f64>,
    pub gpu_ms: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LightQuery {
    pub picks: Option<Vec<u32>>,
    pub exposure: f64,
    pub white: f64,
    pub black: f64,
    pub weights: [f64; 3],
    pub floor: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LightSums {
    pub px: u64,
    pub over: u64,
    pub under: u64,
    pub log2: f64,
}

pub type Reducing = dyn Fn(&LightQuery) -> Option<LightSums> + Send + Sync;

#[derive(Clone)]
pub struct Reduce(pub std::sync::Arc<Reducing>);

impl std::fmt::Debug for Reduce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Reduce")
    }
}
