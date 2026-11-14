//! Issue #501: the device gate's live output, for `soak`: a media document's mix played on this
//! machine's default output, on the real clock. A mixer thread keeps a lock-free ring filled from
//! the player; the device's render callback copies from it, and when the ring holds less than the
//! callback asks for, it fills the rest with silence and counts one underrun and its length. Only
//! that callback counts: nothing is estimated. macOS only (CoreAudio's default output unit);
//! elsewhere `soak` answers `no_output`.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};

use deep_canvas_media::mix::Player;
use serde_json::{json, Value};

use crate::stepped::Worlds;

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
    /// #525: stretches of consecutive short pulls, and whether the last pull was short; the
    /// most frames one pull asked for; and the mixer thread each pull wakes.
    stretches: AtomicU64,
    short: AtomicBool,
    biggest: AtomicUsize,
    waker: std::sync::OnceLock<std::thread::Thread>,
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
            stretches: AtomicU64::new(0),
            short: AtomicBool::new(false),
            biggest: AtomicUsize::new(0),
            waker: std::sync::OnceLock::new(),
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
        if n < out.len() && !self.short.swap(true, Ordering::Relaxed) {
            self.stretches.fetch_add(1, Ordering::Relaxed);
        }
        if n == out.len() {
            self.short.store(false, Ordering::Relaxed);
        }
        self.biggest.fetch_max(out.len() / 2, Ordering::Relaxed);
        if let Some(mixer) = self.waker.get() {
            mixer.unpark();
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

/// #525: plays a live media document on the default output.
#[cfg(not(target_os = "macos"))]
pub fn soak_live(
    _: Player,
    _: Worlds,
    _: u64,
    _: Vec<(i64, String, Value)>,
    _: (bool, bool),
) -> Value {
    json!({"outcome": "refused", "code": "no_output"})
}

/// #525: what a live play keeps written ahead of the device, and the IO buffer it asks the device
/// for: 512 and 256 frames, about 10.7 and 5.3 ms at 48 kHz, as the test backend's device writes
/// ahead (Phase: a step not ready in time is an underrun, which a long ring would hide).
const LIVE: usize = 512;
const LIVE_BUFFER: u32 = 256;
/// One audio block (Sound and video on the picture's clock: Blocks).
const BLOCK: usize = 128;

/// #525: plays a media document whose worlds are live on the default output for `seconds` of
/// real time. Before each block the mixer renders, every world steps past it and the graph's
/// lead, and the spawns' voices are planned from the lists as stepped, as the test backend's play
/// does; a step not ready (one the scenario's `delays` hold) leaves the mixer waiting, so the
/// device's callback finds the ring short, which counts. Answers the gate's stats (an underrun
/// one stretch of short callbacks), the blocks rendered and how many found a world behind, and
/// the SHA-256 of the samples rendered from the document's 0, which a replay renders alike.
/// Each scripted press `(at, control, value)` arrives `at` host flicks after the play starts and
/// is an entry on the track at the first sample at or after the one the device plays then, plus
/// the write-ahead and one block, or the first sample not yet written or step not yet run,
/// whichever is later (Input track); the reply lists each with that first sample not yet written.
/// `planted`: #525's transport that renders a block whose step isn't ready, and its entry that
/// takes the t the clock shows at its arrival, the sample the device plays.
#[cfg(target_os = "macos")]
pub fn soak_live(
    mut player: Player,
    mut worlds: Worlds,
    seconds: u64,
    mut presses: Vec<(i64, String, Value)>,
    (late_renders, at_frame): (bool, bool),
) -> Value {
    use sha2::{Digest, Sha256};
    use std::time::{Duration, Instant};
    let rate = player.mix.rate;
    let sample = crate::shared::FLICKS / rate;
    let Some(device) = mac::default_output() else {
        return json!({"outcome": "refused", "code": "no_output"});
    };
    let ring = Ring::new(LIVE);
    let begun = Instant::now();
    let host =
        || (begun.elapsed().as_nanos() * crate::shared::FLICKS as u128 / 1_000_000_000) as i64;
    let (mut written, mut blocks, mut behind) = (0i64, 0u64, 0u64);
    let mut hash = Sha256::new();
    let mut chunk = vec![0f32; 2 * BLOCK];
    let delay = (device.latency() * rate as f64).round() as i64;
    let mut arrived = Vec::new();
    let mut fill = |player: &mut Player, worlds: &mut Worlds| {
        while presses.first().is_some_and(|p| host() >= p.0) {
            let (at, control, value) = presses.remove(0);
            let playing = (ring.counts().2 as i64 - delay).max(0);
            let next = worlds.next_step().div_euclid(sample)
                + i64::from(worlds.next_step().rem_euclid(sample) != 0);
            let lead = (LIVE + LIVE_BUFFER as usize + BLOCK) as i64;
            let t = if at_frame {
                playing
            } else {
                (playing + lead).max(written).max(next)
            };
            worlds.press(t * sample, &control, &value);
            arrived
                .push(json!({"at": at, "control": control, "t": t * sample, "unwritten": written}));
        }
        while ring.free() >= BLOCK {
            let first = written;
            let need = (first + BLOCK as i64 + player.ahead()) * sample;
            if !worlds.step_to(need, host()) && !late_renders {
                return;
            }
            let moved = |t: i64| (late_renders && t < first * sample).then_some(first * sample);
            if let Some(strips) = worlds.added(moved) {
                player.set_added(strips);
            }
            blocks += 1;
            behind += u64::from(worlds.behind((first + BLOCK as i64) * sample));
            player.read(&mut chunk);
            ring.push(&chunk);
            chunk.iter().for_each(|x| hash.update(x.to_le_bytes()));
            written += BLOCK as i64;
        }
    };
    // A live mixer writes 10 ms ahead, so it runs as the device's own IO thread does: on a
    // time-constraint schedule of one device buffer, never starved by other work on the machine.
    mac::realtime(LIVE_BUFFER as f64 / rate as f64);
    let cpu = mac::thread_cpu();
    let _ = ring.waker.set(std::thread::current());
    fill(&mut player, &mut worlds);
    let unit = match mac::Unit::start(&ring, rate, Some(LIVE_BUFFER)) {
        Ok(u) => u,
        Err(status) => {
            return json!({"outcome": "refused", "code": "device_failed", "status": status})
        }
    };
    let deadline = begun + Duration::from_secs(seconds);
    // Each pull wakes the mixer, which refills at once; the timeout only bounds a missed wake.
    while Instant::now() < deadline {
        fill(&mut player, &mut worlds);
        std::thread::park_timeout(Duration::from_millis(2));
    }
    let played = begun.elapsed().as_secs_f64();
    drop(unit);
    let (_, short, taken) = ring.counts();
    if (taken as f64) < (played - 1.0) * rate as f64 {
        return json!({"outcome": "refused", "code": "interrupted", "frames": taken, "played": played});
    }
    let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    json!({"outcome": "played", "seconds": seconds, "stats": {
        "underruns": ring.stretches.load(Ordering::Relaxed),
        "underrun_time": short as f64 / rate as f64,
        "latency": device.latency() + LIVE as f64 / rate as f64,
    }, "blocks": {"rendered": blocks, "behind": behind}, "handed": {"frames": written, "sha256": digest},
        "presses": arrived, "input_track": worlds.track,
        "device": {"buffer": ring.biggest.load(Ordering::Relaxed)}, "mixer": {"cpu": mac::thread_cpu() - cpu, "played": played}})
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
    let unit = match mac::Unit::start(&ring, rate, None) {
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
        /// #525: `buffer` asks the device for an IO buffer of that many frames.
        pub fn start(ring: &Ring, rate: i64, buffer: Option<u32>) -> Result<Unit, i32> {
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
                // kAudioDevicePropertyBufferFrameSize, global scope (0): this process's IO buffer.
                if let Some(frames) = buffer {
                    ok(AudioUnitSetProperty(
                        unit.0,
                        code(b"fsiz"),
                        0,
                        0,
                        (&raw const frames).cast(),
                        size(std::mem::size_of::<u32>()),
                    ))?;
                }
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

    /// #525: puts the calling thread on a time-constraint schedule of one `period` (seconds), with a
    /// fifth of it to compute in and half of it to finish by, as an audio IO thread runs.
    pub fn realtime(period: f64) {
        #[repr(C)]
        struct Timebase {
            numer: u32,
            denom: u32,
        }
        /// thread_time_constraint_policy_data_t.
        #[repr(C)]
        struct TimeConstraint {
            period: u32,
            computation: u32,
            constraint: u32,
            preemptible: i32,
        }
        extern "C" {
            fn mach_timebase_info(info: *mut Timebase) -> i32;
            fn mach_thread_self() -> u32;
            fn thread_policy_set(thread: u32, flavor: u32, policy: *mut i32, count: u32) -> i32;
        }
        /// THREAD_TIME_CONSTRAINT_POLICY, and its count of 32-bit fields.
        const POLICY: u32 = 2;
        const COUNT: u32 = 4;
        let mut base = Timebase { numer: 0, denom: 0 };
        // SAFETY: writes only `base`; then sets only the calling thread's policy, from a policy
        // of the size COUNT names.
        unsafe {
            mach_timebase_info(&mut base);
            let ticks = |s: f64| (s * 1e9 * base.denom as f64 / base.numer.max(1) as f64) as u32;
            let mut policy = TimeConstraint {
                period: ticks(period),
                computation: ticks(period / 5.0),
                constraint: ticks(period / 2.0),
                preemptible: 1,
            };
            thread_policy_set(mach_thread_self(), POLICY, (&raw mut policy).cast(), COUNT);
        }
    }

    /// The calling thread's CPU time, in seconds (#525: what the live mixer spent).
    pub fn thread_cpu() -> f64 {
        let mut t = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: writes only `t`.
        unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
        t.tv_sec as f64 + t.tv_nsec as f64 / 1e9
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
