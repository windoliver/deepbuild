//! Issue #501: the device gate's live output, for `soak`: a media document's mix played on this
//! machine's default output, on the real clock. A mixer thread keeps a lock-free ring filled from
//! the player; the device's render callback copies from it, and when the ring holds less than the
//! callback asks for, it fills the rest with silence and counts one underrun and its length. Only
//! that callback counts: nothing is estimated. macOS only (CoreAudio's default output unit);
//! elsewhere `soak` answers `no_output`.

use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};

use deep_canvas_media::mix::Player;
use serde_json::{json, Value};

/// The ring's fill in frames, what the mixer keeps ahead of the device: about 43 ms at 48 kHz.
const TARGET: usize = 2048;
/// Frames the mixer renders at a time.
const CHUNK: usize = 256;

/// A single-producer, single-consumer ring of interleaved stereo f32 samples, held as bits. The
/// consumer allocates nothing and takes no lock.
pub struct Ring {
    buf: Vec<AtomicU32>,
    written: AtomicUsize,
    read: AtomicUsize,
    underruns: AtomicU64,
    short_frames: AtomicU64,
    taken_frames: AtomicU64,
}

impl Ring {
    pub fn new(frames: usize) -> Ring {
        Ring {
            buf: (0..2 * frames).map(|_| AtomicU32::new(0)).collect(),
            written: AtomicUsize::new(0),
            read: AtomicUsize::new(0),
            underruns: AtomicU64::new(0),
            short_frames: AtomicU64::new(0),
            taken_frames: AtomicU64::new(0),
        }
    }

    /// Frames the producer can write now.
    pub fn free(&self) -> usize {
        let held = self.written.load(Ordering::Relaxed) - self.read.load(Ordering::Acquire);
        (self.buf.len() - held) / 2
    }

    /// The producer's write: `samples` (whole frames) must fit in `free`.
    pub fn push(&self, samples: &[f32]) {
        let w = self.written.load(Ordering::Relaxed);
        for (i, s) in samples.iter().enumerate() {
            self.buf[(w + i) % self.buf.len()].store(s.to_bits(), Ordering::Relaxed);
        }
        self.written.store(w + samples.len(), Ordering::Release);
    }

    /// The consumer's read into `out` (whole frames): what the ring lacks is silence, one underrun.
    pub fn pull(&self, out: &mut [f32]) {
        let r = self.read.load(Ordering::Relaxed);
        let n = (self.written.load(Ordering::Acquire) - r).min(out.len());
        for (i, o) in out[..n].iter_mut().enumerate() {
            *o = f32::from_bits(self.buf[(r + i) % self.buf.len()].load(Ordering::Relaxed));
        }
        out[n..].fill(0.0);
        self.read.store(r + n, Ordering::Release);
        self.taken_frames
            .fetch_add((out.len() / 2) as u64, Ordering::Relaxed);
        if n < out.len() {
            self.underruns.fetch_add(1, Ordering::Relaxed);
            self.short_frames
                .fetch_add(((out.len() - n) / 2) as u64, Ordering::Relaxed);
        }
    }

    /// Underruns so far, the frames of silence they filled, and the frames the consumer took.
    pub fn counts(&self) -> (u64, u64, u64) {
        let l = |a: &AtomicU64| a.load(Ordering::Relaxed);
        (
            l(&self.underruns),
            l(&self.short_frames),
            l(&self.taken_frames),
        )
    }
}

/// Plays `player` on the default output for `seconds` of real time and answers the gate's stats.
#[cfg(not(target_os = "macos"))]
pub fn soak(_player: Player, _seconds: u64) -> Value {
    json!({"outcome": "refused", "code": "no_output"})
}

/// Plays `player` on the default output for `seconds` of real time and answers the gate's stats.
#[cfg(target_os = "macos")]
pub fn soak(mut player: Player, seconds: u64) -> Value {
    use std::time::{Duration, Instant};
    let rate = player.mix.rate;
    let Some(device) = mac::default_output() else {
        return json!({"outcome": "refused", "code": "no_output"});
    };
    let ring = Ring::new(TARGET);
    let mut chunk = vec![0f32; 2 * CHUNK];
    let mut fill = |player: &mut Player| {
        while ring.free() >= CHUNK {
            player.read(&mut chunk);
            ring.push(&chunk);
        }
    };
    fill(&mut player);
    let unit = match mac::Unit::start(&ring, rate) {
        Ok(u) => u,
        Err(status) => {
            return json!({"outcome": "refused", "code": "device_failed", "status": status})
        }
    };
    let begun = Instant::now();
    let deadline = begun + Duration::from_secs(seconds);
    std::thread::scope(|s| {
        s.spawn(|| {
            mac::interactive();
            while Instant::now() < deadline {
                fill(&mut player);
                std::thread::sleep(Duration::from_millis(1));
            }
        });
    });
    let played = begun.elapsed().as_secs_f64();
    drop(unit);
    let (underruns, short, taken) = ring.counts();
    // A device that stopped asking would count no underrun: what it took must cover the play.
    if (taken as f64) < (played - 1.0) * rate as f64 {
        return json!({"outcome": "refused", "code": "interrupted", "frames": taken, "played": played});
    }
    json!({"outcome": "played", "seconds": seconds, "stats": {
        "underruns": underruns,
        "underrun_time": short as f64 / rate as f64,
        "latency": device.latency() + TARGET as f64 / rate as f64,
    }})
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;

    use super::Ring;

    const fn code(b: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*b)
    }

    #[repr(C)]
    struct ComponentDescription {
        kind: u32,
        sub_kind: u32,
        manufacturer: u32,
        flags: u32,
        flags_mask: u32,
    }

    #[repr(C)]
    struct StreamFormat {
        sample_rate: f64,
        format_id: u32,
        format_flags: u32,
        bytes_per_packet: u32,
        frames_per_packet: u32,
        bytes_per_frame: u32,
        channels_per_frame: u32,
        bits_per_channel: u32,
        reserved: u32,
    }

    type Render =
        extern "C" fn(*mut c_void, *mut u32, *const c_void, u32, u32, *mut BufferList) -> i32;

    #[repr(C)]
    struct RenderCallback {
        proc_: Render,
        ref_con: *mut c_void,
    }

    #[repr(C)]
    struct Buffer {
        channels: u32,
        bytes: u32,
        data: *mut c_void,
    }

    #[repr(C)]
    struct BufferList {
        count: u32,
        buffers: [Buffer; 1],
    }

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "AudioToolbox", kind = "framework")]
    extern "C" {
        fn AudioComponentFindNext(
            after: *mut c_void,
            desc: *const ComponentDescription,
        ) -> *mut c_void;
        fn AudioComponentInstanceNew(component: *mut c_void, out: *mut *mut c_void) -> i32;
        fn AudioComponentInstanceDispose(unit: *mut c_void) -> i32;
        fn AudioUnitSetProperty(
            unit: *mut c_void,
            id: u32,
            scope: u32,
            element: u32,
            data: *const c_void,
            size: u32,
        ) -> i32;
        fn AudioUnitInitialize(unit: *mut c_void) -> i32;
        fn AudioUnitUninitialize(unit: *mut c_void) -> i32;
        fn AudioOutputUnitStart(unit: *mut c_void) -> i32;
        fn AudioOutputUnitStop(unit: *mut c_void) -> i32;
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }

    const SYSTEM_OBJECT: u32 = 1;
    const GLOBAL: u32 = code(b"glob");
    const OUTPUT: u32 = code(b"outp");

    /// One property of a CoreAudio object, if it reads.
    fn property<T: Copy + Default>(object: u32, selector: u32, scope: u32) -> Option<T> {
        let address = Address {
            selector,
            scope,
            element: 0,
        };
        let mut value = T::default();
        let mut size = std::mem::size_of::<T>() as u32;
        // SAFETY: `value` is `size` writable bytes and `address` a live property address.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                (&raw mut value).cast(),
            )
        };
        (status == 0 && size as usize == std::mem::size_of::<T>()).then_some(value)
    }

    /// The default output device.
    pub struct Device(u32);

    /// The default output device, or `None` when the machine has none.
    pub fn default_output() -> Option<Device> {
        property::<u32>(SYSTEM_OBJECT, code(b"dOut"), GLOBAL)
            .filter(|&d| d != 0)
            .map(Device)
    }

    impl Device {
        /// The output latency the device reports, in seconds: its latency, safety offset and
        /// buffer, and its first output stream's latency.
        pub fn latency(&self) -> f64 {
            let frames = |selector: &[u8; 4]| {
                property::<u32>(self.0, code(selector), OUTPUT).unwrap_or(0) as f64
            };
            let stream = property::<u32>(self.0, code(b"stm#"), OUTPUT)
                .and_then(|s| property::<u32>(s, code(b"ltnc"), GLOBAL))
                .unwrap_or(0) as f64;
            let rate = property::<f64>(self.0, code(b"nsrt"), GLOBAL)
                .filter(|r| *r > 0.0)
                .unwrap_or(48_000.0);
            (frames(b"ltnc") + frames(b"saft") + frames(b"fsiz") + stream) / rate
        }
    }

    /// The device's render callback: the ring's samples, or silence and an underrun.
    extern "C" fn render(
        ring: *mut c_void,
        _: *mut u32,
        _: *const c_void,
        _: u32,
        frames: u32,
        data: *mut BufferList,
    ) -> i32 {
        // SAFETY: `ring` is the Ring `Unit::start` was given, which outlives the unit; `data` is
        // this call's buffer list, one interleaved stereo f32 buffer by the format set on the unit.
        unsafe {
            let ring = &*(ring as *const Ring);
            if data.is_null() || (*data).count == 0 || (*data).buffers[0].data.is_null() {
                return 0;
            }
            let b = &(*data).buffers[0];
            let n = (b.bytes as usize / 4).min(2 * frames as usize) & !1;
            ring.pull(std::slice::from_raw_parts_mut(b.data.cast::<f32>(), n));
        }
        0
    }

    /// The running default output unit; dropping it stops and disposes of it.
    pub struct Unit(*mut c_void);

    impl Unit {
        /// Opens the default output at `rate`, float32 stereo interleaved, pulling from `ring`.
        pub fn start(ring: &Ring, rate: i64) -> Result<Unit, i32> {
            let desc = ComponentDescription {
                kind: code(b"auou"),
                sub_kind: code(b"def "),
                manufacturer: code(b"appl"),
                flags: 0,
                flags_mask: 0,
            };
            let format = StreamFormat {
                sample_rate: rate as f64,
                format_id: code(b"lpcm"),
                // Float, packed.
                format_flags: 1 | 8,
                bytes_per_packet: 8,
                frames_per_packet: 1,
                bytes_per_frame: 8,
                channels_per_frame: 2,
                bits_per_channel: 32,
                reserved: 0,
            };
            let callback = RenderCallback {
                proc_: render,
                ref_con: (ring as *const Ring).cast_mut().cast(),
            };
            let ok = |s: i32| if s == 0 { Ok(()) } else { Err(s) };
            // SAFETY: each call gets the unit it made and properties of the sizes they name;
            // the unit is disposed of on any failure and on drop.
            unsafe {
                let component = AudioComponentFindNext(std::ptr::null_mut(), &desc);
                if component.is_null() {
                    return Err(-1);
                }
                let mut unit = std::ptr::null_mut();
                ok(AudioComponentInstanceNew(component, &mut unit))?;
                let unit = Unit(unit);
                let size = |n: usize| n as u32;
                // kAudioUnitProperty_StreamFormat (8) and _SetRenderCallback (23), input scope (1).
                ok(AudioUnitSetProperty(
                    unit.0,
                    8,
                    1,
                    0,
                    (&raw const format).cast(),
                    size(std::mem::size_of::<StreamFormat>()),
                ))?;
                ok(AudioUnitSetProperty(
                    unit.0,
                    23,
                    1,
                    0,
                    (&raw const callback).cast(),
                    size(std::mem::size_of::<RenderCallback>()),
                ))?;
                ok(AudioUnitInitialize(unit.0))?;
                ok(AudioOutputUnitStart(unit.0))?;
                Ok(unit)
            }
        }
    }

    impl Drop for Unit {
        fn drop(&mut self) {
            // SAFETY: the unit this made; stopping returns once no callback runs.
            unsafe {
                AudioOutputUnitStop(self.0);
                AudioUnitUninitialize(self.0);
                AudioComponentInstanceDispose(self.0);
            }
        }
    }

    /// Runs the calling thread at the user-interactive QoS, as a mixer feeding the device does.
    pub fn interactive() {
        // SAFETY: sets only the calling thread's QoS class.
        unsafe {
            libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Ring;

    #[test]
    fn a_short_ring_counts_one_underrun_and_its_length_and_plays_silence_for_it() {
        let ring = Ring::new(8);
        ring.push(&[0.5; 8]);
        let mut out = [1.0f32; 12];
        ring.pull(&mut out);
        assert_eq!(
            ring.counts(),
            (1, 2, 6),
            "one underrun of 2 frames, 6 frames taken"
        );
        assert_eq!(&out[..8], &[0.5; 8]);
        assert_eq!(&out[8..], &[0.0; 4], "the missing frames are silence");
        ring.pull(&mut out);
        assert_eq!(
            ring.counts(),
            (2, 8, 12),
            "an empty ring is an underrun of the whole ask"
        );
    }

    #[test]
    fn a_ring_holding_every_ask_counts_no_underrun_across_wraps() {
        let ring = Ring::new(8);
        let mut out = [0f32; 6];
        for k in 0..20 {
            while ring.free() >= 3 {
                ring.push(&[k as f32; 6]);
            }
            ring.pull(&mut out);
        }
        assert_eq!(
            ring.counts(),
            (0, 0, 60),
            "no underrun, 20 pulls of 3 frames taken"
        );
    }
}
