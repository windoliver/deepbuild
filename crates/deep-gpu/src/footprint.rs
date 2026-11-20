//! The process's physical footprint, split into what we can name and the rest (#1431; technical
//! design: Numbers version 0 has to hold, "The app's footprint"). A reading holds the footprint,
//! the heap no gauge names, every gauge a holder in the process keeps ([`deep_canvas::gauge`]),
//! and `unaccounted`: the footprint less the heap less the gauges, what no one can name, such as
//! GPU memory no gauge counts. A gauge whose bytes are in the heap is taken out of `heap`, so no
//! byte is named twice. Beside them it carries the GPU device's own report of what it holds. A
//! value that can't be read is unknown, naming the read, never 0, and nothing taken from it is
//! known either. A minute with a missing read is void and never averaged in.

use deep_canvas::gauge::{self, Place};
use serde_json::{json, Value};
use web_time::Instant;

/// What a read gave: its bytes, or why it couldn't be read.
pub type Got = Result<u64, String>;

/// Where each field is read from, as a report names it.
pub const FOOTPRINT_READ: &str = "proc_pid_rusage(RUSAGE_INFO_V2).ri_phys_footprint";
pub const HEAP_READ: &str = "mach_vm_region_recurse(malloc regions, vm.self_region_footprint): resident + compressed - reusable pages";
pub const DEVICE_READ: &str = "MTLDevice.currentAllocatedSize";

/// The reads a reading takes, so a planted program can stand in for any of them.
#[derive(Clone, Copy)]
pub struct Readers {
    pub footprint: fn() -> Got,
    pub heap: fn() -> Got,
    pub device: fn() -> Got,
}

/// The system's own reads.
pub const SYSTEM: Readers = Readers {
    footprint,
    heap,
    device,
};

/// One gauge as read.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub name: &'static str,
    pub place: Place,
    pub entries: u64,
    pub bytes: u64,
    pub bound: gauge::Bound,
}

/// One reading of the process.
#[derive(Clone, Debug)]
pub struct Reading {
    pub footprint: Got,
    /// What the allocator holds in the footprint, the gauges' bytes included.
    pub heap: Got,
    pub device: Got,
    pub gauges: Vec<Row>,
    /// How long reading the gauges took.
    pub gauges_ms: f64,
}

#[cfg(target_os = "macos")]
mod sys {
    extern "C" {
        pub fn proc_pid_rusage(pid: i32, flavor: i32, out: *mut [u64; 64]) -> i32;
        pub static mach_task_self_: u32;
        pub static vm_page_size: usize;
        pub fn mach_vm_region_recurse(
            task: u32,
            address: *mut u64,
            size: *mut u64,
            depth: *mut u32,
            info: *mut [u32; 21],
            count: *mut u32,
        ) -> i32;
        pub fn sysctlbyname(
            name: *const std::ffi::c_char,
            old: *mut std::ffi::c_void,
            old_len: *mut usize,
            new: *const std::ffi::c_void,
            new_len: usize,
        ) -> i32;
    }
}

/// The process's physical footprint, as Activity Monitor's Memory column reads it.
pub fn footprint() -> Got {
    footprint_of(std::process::id() as i32)
}

/// Process `pid`'s physical footprint.
#[cfg(target_os = "macos")]
pub fn footprint_of(pid: i32) -> Got {
    let mut out = [0u64; 64];
    // SAFETY: rusage_info_v2 is 232 bytes, within `out`; the call writes only that.
    let status = unsafe { sys::proc_pid_rusage(pid, 2, &mut out) };
    if status != 0 {
        return Err(format!(
            "returned {status}: {}",
            std::io::Error::last_os_error()
        ));
    }
    // A 16-byte UUID, then u64s: user and system time, two wakeup counts, page-ins, wired,
    // resident, then the physical footprint.
    Ok(out[9])
}

#[cfg(not(target_os = "macos"))]
pub fn footprint_of(_pid: i32) -> Got {
    Err(format!("{} has no such read", std::env::consts::OS))
}

/// What the allocator holds in the footprint: the pages of the regions malloc tags as its own, resident or compressed,
/// less those it gave back as reusable. Free blocks on pages it keeps are in the footprint, so they're the heap's too;
/// the bytes in use alone would move `unaccounted` each time the heap frees blocks or reuses them. The regions are read
/// as the footprint counts them (`vm.self_region_footprint`, the footprint tool's reading), so the pages of a block
/// `realloc` moved, or of a purgeable region made volatile, which the footprint leaves out, aren't counted either.
#[cfg(target_os = "macos")]
pub fn heap() -> Got {
    // VM_MEMORY_MALLOC to VM_MEMORY_MALLOC_PROB_GUARD (<mach/vm_statistics.h>).
    const MALLOC: [u32; 10] = [1, 2, 3, 4, 7, 8, 9, 11, 12, 13];
    let on: i32 = 1;
    // SAFETY: sets this task's own flag from `on`; nothing is read back.
    let set = unsafe {
        sys::sysctlbyname(
            c"vm.self_region_footprint".as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            (&on as *const i32).cast(),
            size_of::<i32>(),
        )
    };
    if set != 0 {
        return Err(format!(
            "vm.self_region_footprint: {}",
            std::io::Error::last_os_error()
        ));
    }
    // vm_region_submap_info_64's words (<mach/vm_region.h>): the user tag, the resident and swapped-out pages, whether
    // the region is a submap, and the reusable pages.
    let [tag, resident, swapped, submap, reusable] = [5, 6, 8, 12, 16];
    let (mut address, mut pages) = (0u64, 0u64);
    loop {
        let (mut size, mut depth, mut info, mut count) = (0u64, 0u32, [0u32; 21], 21u32);
        // SAFETY: the call writes at most `count` words of `info` and the region's address and size.
        let status = unsafe {
            sys::mach_vm_region_recurse(
                sys::mach_task_self_,
                &mut address,
                &mut size,
                &mut depth,
                &mut info,
                &mut count,
            )
        };
        match status {
            0 => {}
            // KERN_INVALID_ADDRESS: past the last region.
            // SAFETY: the system's page size, set before main.
            1 => return Ok(pages * unsafe { sys::vm_page_size } as u64),
            e => return Err(format!("returned {e}")),
        }
        if info[submap] == 0 && MALLOC.contains(&info[tag]) {
            let held = u64::from(info[resident]) + u64::from(info[swapped]);
            pages += held.saturating_sub(u64::from(info[reusable]));
        }
        address += size;
    }
}

#[cfg(not(target_os = "macos"))]
pub fn heap() -> Got {
    Err(format!("{} has no such read", std::env::consts::OS))
}

/// What the process's GPU device says it holds.
pub fn device() -> Got {
    crate::memory::system_allocated().ok_or_else(|| "no Metal device answers".to_string())
}

/// The process now: the heap and the gauges, then the device, then the footprint, so what the
/// others hold is in it.
pub fn read(readers: Readers) -> Reading {
    let heap = (readers.heap)();
    let start = Instant::now();
    let gauges = gauge::all()
        .into_iter()
        .map(|g| {
            let (entries, bytes) = g.read();
            Row {
                name: g.name,
                place: g.place,
                entries,
                bytes,
                bound: g.bound,
            }
        })
        .collect();
    let gauges_ms = start.elapsed().as_secs_f64() * 1000.0;
    let device = (readers.device)();
    let footprint = (readers.footprint)();
    Reading {
        footprint,
        heap,
        device,
        gauges,
        gauges_ms,
    }
}

impl Reading {
    /// The bytes every gauge names.
    pub fn named(&self) -> u64 {
        self.gauges.iter().map(|g| g.bytes).sum()
    }

    /// The heap less the bytes the gauges name in it.
    pub fn unnamed_heap(&self) -> Option<i64> {
        let named: u64 = (self.gauges.iter())
            .filter(|g| g.place == Place::Heap)
            .map(|g| g.bytes)
            .sum();
        self.heap.as_ref().ok().map(|h| *h as i64 - named as i64)
    }

    /// The footprint less the heap less the gauges; unknown when the footprint or the heap is.
    pub fn unaccounted(&self) -> Option<i64> {
        let footprint = *self.footprint.as_ref().ok()?;
        Some(footprint as i64 - self.unnamed_heap()? - self.named() as i64)
    }

    /// Each read that failed: the field, the read and its error.
    pub fn unknown(&self) -> Vec<(&'static str, &'static str, String)> {
        [
            ("footprint", FOOTPRINT_READ, &self.footprint),
            ("heap", HEAP_READ, &self.heap),
            ("device", DEVICE_READ, &self.device),
        ]
        .into_iter()
        .filter_map(|(field, read, got)| got.as_ref().err().map(|e| (field, read, e.clone())))
        .collect()
    }

    /// Each gauge past one of its bounds, naming it and the bound.
    pub fn over(&self) -> Vec<String> {
        let mut over = Vec::new();
        for g in &self.gauges {
            if g.entries > g.bound.entries {
                over.push(format!(
                    "{} holds {} entries, past its bound of {}",
                    g.name, g.entries, g.bound.entries
                ));
            }
            if g.bytes > g.bound.bytes {
                over.push(format!(
                    "{} holds {} bytes, past its bound of {}",
                    g.name, g.bytes, g.bound.bytes
                ));
            }
        }
        over
    }

    pub fn json(&self) -> Value {
        let gauges: Vec<Value> = self
            .gauges
            .iter()
            .map(|g| {
                json!({
                    "name": g.name,
                    "on": g.place.name(),
                    "entries": g.entries,
                    "bytes": g.bytes,
                    "bound": {"entries": g.bound.entries, "bytes": g.bound.bytes},
                })
            })
            .collect();
        let unknown: Vec<Value> = self
            .unknown()
            .into_iter()
            .map(|(field, read, error)| json!({"field": field, "read": read, "error": error}))
            .collect();
        json!({
            "footprint": self.footprint.as_ref().ok(),
            "heap": self.unnamed_heap(),
            "gauges": gauges,
            "unaccounted": self.unaccounted(),
            "device": self.device.as_ref().ok(),
            "unknown": unknown,
            "over": self.over(),
            "gauges_ms": self.gauges_ms,
        })
    }
}

/// The last minutes of readings taken through a run, by the run's own clock: each minute's mean of
/// every field, or void when a read in it was missing or no reading reached it; a void minute is
/// never averaged in.
pub struct Minutes {
    keep: usize,
    rows: std::collections::VecDeque<(u64, Minute)>,
}

#[derive(Clone, Debug, Default)]
pub struct Minute {
    pub reads: u32,
    pub missing: Vec<String>,
    sums: [i128; 4],
}

impl Minutes {
    /// A series that keeps its last `keep` minutes.
    pub fn new(keep: usize) -> Minutes {
        Minutes {
            keep: keep.max(1),
            rows: Default::default(),
        }
    }

    fn push(&mut self, minute: u64) {
        self.rows.push_back((minute, Minute::default()));
        while self.rows.len() > self.keep {
            self.rows.pop_front();
        }
    }

    /// A reading taken `seconds` into the run.
    pub fn add(&mut self, seconds: f64, r: &Reading) {
        let at = (seconds.max(0.0) / 60.0) as u64;
        let next = self.rows.back().map_or(at, |(m, _)| m + 1);
        for minute in next.max(at.saturating_sub(self.keep as u64))..at {
            self.push(minute);
        }
        if self.rows.back().map(|(m, _)| *m) != Some(at) {
            self.push(at);
        }
        let m = &mut self.rows.back_mut().expect("pushed above").1;
        m.reads += 1;
        let (Some(footprint), Some(heap), Some(unaccounted)) =
            (r.footprint.as_ref().ok(), r.unnamed_heap(), r.unaccounted())
        else {
            let missing = r
                .unknown()
                .into_iter()
                .map(|(field, read, e)| format!("{field}: {read}: {e}"));
            m.missing.extend(missing);
            return;
        };
        let fields = [
            i128::from(*footprint),
            i128::from(heap),
            i128::from(r.named()),
            i128::from(unaccounted),
        ];
        for (s, v) in m.sums.iter_mut().zip(fields) {
            *s += v;
        }
    }

    /// Whether minute `n` has a reading.
    pub fn taken(&self, n: u64) -> bool {
        self.rows.iter().any(|(m, row)| *m == n && row.reads > 0)
    }

    /// Minute `n`'s mean unaccounted bytes, or `None` when it was void or isn't kept.
    pub fn unaccounted(&self, n: u64) -> Option<f64> {
        self.rows
            .iter()
            .find(|(m, _)| *m == n)
            .and_then(|(_, m)| mean(m, 3))
    }

    /// The mean unaccounted bytes over the minutes kept that aren't void, and how many are void.
    pub fn mean_unaccounted(&self) -> (Option<f64>, usize) {
        let known: Vec<f64> = self.rows.iter().filter_map(|(_, m)| mean(m, 3)).collect();
        let mean = (!known.is_empty()).then(|| known.iter().sum::<f64>() / known.len() as f64);
        (mean, self.rows.len() - known.len())
    }

    pub fn json(&self) -> Value {
        let rows: Vec<Value> = self
            .rows
            .iter()
            .map(|(n, m)| {
                if mean(m, 3).is_none() {
                    let why = if m.reads == 0 {
                        vec!["no reading".to_string()]
                    } else {
                        m.missing.clone()
                    };
                    return json!({"minute": n, "void": true, "reads": m.reads, "missing": why});
                }
                json!({
                    "minute": n,
                    "void": false,
                    "reads": m.reads,
                    "footprint": mean(m, 0),
                    "heap": mean(m, 1),
                    "gauges": mean(m, 2),
                    "unaccounted": mean(m, 3),
                })
            })
            .collect();
        Value::Array(rows)
    }
}

/// A minute's mean of one field, or `None` when it is void.
fn mean(m: &Minute, field: usize) -> Option<f64> {
    (m.reads > 0 && m.missing.is_empty()).then(|| m.sums[field] as f64 / f64::from(m.reads))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failing() -> Got {
        Err("planted: the read fails".into())
    }
    fn known() -> Got {
        Ok(1_000)
    }

    #[test]
    fn a_failed_read_is_unknown_and_names_the_read() {
        let r = read(Readers {
            footprint: failing,
            heap: known,
            device: known,
        });
        let j = r.json();
        assert_eq!(j["footprint"], Value::Null);
        assert_eq!(j["unaccounted"], Value::Null);
        assert_eq!(j["unknown"][0]["field"], "footprint");
        assert_eq!(j["unknown"][0]["read"], FOOTPRINT_READ);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_system_reads_this_process() {
        let r = read(SYSTEM);
        let (f, h) = (*r.footprint.as_ref().unwrap(), *r.heap.as_ref().unwrap());
        assert!(f > 1_000_000 && h > 0 && h < f * 4, "{f} {h}");
        let j = r.json();
        let named: i64 = r.named() as i64;
        assert_eq!(
            j["unaccounted"].as_i64(),
            Some(f as i64 - j["heap"].as_i64().unwrap() - named)
        );
    }

    #[test]
    fn a_minute_with_a_missing_read_is_void() {
        let mut m = Minutes::new(60);
        let ok = Reading {
            footprint: Ok(100),
            heap: Ok(40),
            device: Ok(0),
            gauges: Vec::new(),
            gauges_ms: 0.0,
        };
        let bad = Reading {
            footprint: Err("gone".into()),
            ..ok.clone()
        };
        m.add(1.0, &ok);
        m.add(61.0, &ok);
        m.add(62.0, &bad);
        // Minute 2 has no reading; minute 3 has one.
        m.add(190.0, &ok);
        assert_eq!(m.unaccounted(0), Some(60.0));
        assert_eq!(m.unaccounted(1), None);
        assert_eq!(m.json()[1]["void"], true);
        assert_eq!(m.json()[2]["missing"][0], "no reading");
        // Only minutes 0 and 3 are averaged: two void minutes aren't.
        assert_eq!(m.mean_unaccounted(), (Some(60.0), 2));
    }
}
