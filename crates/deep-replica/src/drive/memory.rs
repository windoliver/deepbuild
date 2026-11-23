//! #1431: the replica's reading of its own process (`{"call": "footprint"}`), and the planted memory and readers the
//! suites must catch in it (`{"call": "texture"}` and `DEEP_DRIVE_PLANT`, in a build with the env-plants feature only).

use std::time::SystemTime;

use deep_canvas::gauge::{Gauge, Place};
use deep_gpu::footprint::{self, Got, Readers};
use deep_gpu::memory::{self, Planted};
use serde_json::{json, Value};

use super::Plant;

/// The planted textures a suite asks to gauge: GPU memory, as the device reports it.
pub static PLANTED: Gauge = Gauge::new("planted texture", Place::Device, 16, 16_000_000_000);

/// The planted leak's buffer, made at each whole minute since launch.
const LEAK: u64 = 1_000_000;

/// The planted memory the process holds, and when its replica launched.
pub struct Memory {
    plant: Option<Plant>,
    textures: Vec<(Planted, Option<u64>)>,
    leaked: Vec<Planted>,
    since: Option<SystemTime>,
}

/// The footprint of a process that doesn't exist: the system call fails, as it does on any error.
fn failing() -> Got {
    footprint::footprint_of(-1)
}

/// The planted reader: the same failed read, given as 0.
fn zero() -> Got {
    Ok(footprint::footprint_of(-1).unwrap_or(0))
}

impl Memory {
    pub fn new(plant: Option<Plant>) -> Memory {
        Memory {
            plant,
            textures: Vec::new(),
            leaked: Vec::new(),
            since: None,
        }
    }

    /// A replica launched: the planted leak counts its minutes from here.
    pub fn launched(&mut self) {
        self.since.get_or_insert_with(SystemTime::now);
    }

    /// The planted leak: an ungauged buffer outside the heap for each whole minute of wall time since launch, the
    /// minutes a suite's clock counts, a minute the Mac sleeps through included.
    pub fn leak(&mut self) {
        let Some(since) = self
            .since
            .filter(|_| self.plant == Some(Plant::LeaksUngaugedBuffer))
        else {
            return;
        };
        let minutes = (since.elapsed().unwrap_or_default().as_secs() / 60) as usize;
        while self.leaked.len() < minutes {
            let Some((buffer, _)) = memory::planted(LEAK, false) else {
                return;
            };
            self.leaked.push(buffer);
        }
    }

    /// The process's reading now.
    pub fn footprint(&mut self) -> Value {
        self.leak();
        let readers = match self.plant {
            Some(Plant::FootprintReadFails) => Readers {
                footprint: failing,
                ..footprint::SYSTEM
            },
            Some(Plant::FootprintReadsZero) => Readers {
                footprint: zero,
                ..footprint::SYSTEM
            },
            _ => footprint::SYSTEM,
        };
        json!({"reading": deep_app::footprint::reading(readers)})
    }

    /// `{"texture": {"bytes", "gauge"}}`: a planted texture of `bytes` on the GPU, every byte written and held, counted
    /// by its gauge or by none.
    #[cfg(feature = "env-plants")]
    pub fn texture(&mut self, call: &Value) -> Result<Value, super::Fail> {
        let t = &call["texture"];
        let (Some(bytes), Some(gauge)) =
            (t["bytes"].as_u64().filter(|b| *b > 0), t["gauge"].as_bool())
        else {
            return Err(super::fail("bad_input", "texture is {bytes, gauge}"));
        };
        let Some((made, size)) = memory::planted(bytes, true) else {
            return Err(super::fail(
                "no_device",
                "no Metal device makes the texture",
            ));
        };
        if gauge {
            PLANTED.add(1, size);
        }
        self.textures.push((made, gauge.then_some(size)));
        Ok(json!({"texture": {"bytes": bytes, "device_bytes": size, "gauge": gauge}}))
    }
}

impl Memory {
    /// The replica closed: what was planted in it goes with it.
    pub fn closed(&mut self) {
        for (_, gauged) in self.textures.drain(..) {
            if let Some(size) = gauged {
                PLANTED.sub(1, size);
            }
        }
        self.leaked.clear();
        self.since = None;
    }
}

impl Drop for Memory {
    fn drop(&mut self) {
        self.closed();
    }
}
