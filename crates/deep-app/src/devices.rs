//! Issue #498: a panel's camera and microphone capture, live (canvas primitives: Capture). The
//! camera and microphone are reached only through the OS permission, which this reads and never
//! asks for, plus DeepBuild's own held control: each device's AVFoundation session runs only from
//! the moment ⌥Space goes down in the HID key-state table (#339's gate) until it lets go, and a
//! sample buffer presented at or after the release is never kept. Each capture is good for one
//! hold: a later request configures new sessions, which keep nothing until the next hold. The
//! recording waits in a temporary file and is kept in the evidence store by its hash once whole.

#![cfg(target_os = "macos")]

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use block2::RcBlock;
use objc2::encode::{Encode, Encoding};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol};
use objc2::{class, define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_core_media::CMSampleBuffer;
use objc2_foundation::{NSError, NSString, NSURL};

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

unsafe impl Encode for CMTime {
    const ENCODING: Encoding = Encoding::Struct(
        "?",
        &[
            Encoding::LongLong,
            Encoding::Int,
            Encoding::UInt,
            Encoding::LongLong,
        ],
    );
}

impl CMTime {
    fn seconds(&self) -> Option<f64> {
        (self.flags & 1 == 1 && self.timescale > 0)
            .then(|| self.value as f64 / self.timescale as f64)
    }
}

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    static AVMediaTypeVideo: &'static NSString;
    static AVMediaTypeAudio: &'static NSString;
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMClockGetHostTimeClock() -> *const c_void;
    fn CMClockGetTime(clock: *const c_void) -> CMTime;
    fn CMSampleBufferGetPresentationTimeStamp(s: &CMSampleBuffer) -> CMTime;
    fn CMSampleBufferGetDuration(s: &CMSampleBuffer) -> CMTime;
    fn CMSampleBufferGetImageBuffer(s: &CMSampleBuffer) -> *const c_void;
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    fn CVPixelBufferGetWidth(p: *const c_void) -> usize;
    fn CVPixelBufferGetHeight(p: *const c_void) -> usize;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    fn CFDictionaryCreate(
        a: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        n: isize,
        kcb: *const c_void,
        vcb: *const c_void,
    ) -> *const c_void;
    fn CFNumberCreate(a: *const c_void, kind: isize, v: *const c_void) -> *const c_void;
    fn CFRelease(cf: *const c_void);
}

extern "C" {
    fn dispatch_queue_create(label: *const std::ffi::c_char, attr: *const c_void) -> *mut c_void;
}

/// The host clock now, in seconds: the clock capture sample buffers are stamped on.
pub fn host_now() -> f64 {
    unsafe { CMClockGetTime(CMClockGetHostTimeClock()) }
        .seconds()
        .unwrap_or(0.0)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Camera,
    Microphone,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Camera => "camera",
            Kind::Microphone => "microphone",
        }
    }

    fn media(self) -> &'static NSString {
        unsafe {
            match self {
                Kind::Camera => AVMediaTypeVideo,
                Kind::Microphone => AVMediaTypeAudio,
            }
        }
    }
}

/// The OS's answer for DeepBuild and `kind`, read and never asked for.
pub fn permission(kind: Kind) -> &'static str {
    let status: isize = unsafe {
        msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: kind.media()]
    };
    match status {
        3 => "granted",
        2 => "denied",
        1 => "restricted",
        _ => "undetermined",
    }
}

/// An Objective-C object kept across the capture queue and the main thread; only ever messaged
/// under the capture's lock.
struct Object(Retained<AnyObject>);

unsafe impl Send for Object {}

/// What a capture kept, and its recording while the hold runs.
#[derive(Default)]
pub struct Kept {
    kind: Option<Kind>,
    path: PathBuf,
    down: Option<f64>,
    up: Option<f64>,
    writer: Option<(Object, Object)>,
    pub before_hold: u64,
    pub kept: u64,
    pub first: Option<f64>,
    pub last: Option<f64>,
    pub period: Option<f64>,
    pub failed: Option<String>,
}

type Shared = Arc<Mutex<Kept>>;

define_class!(
    /// A device's sample buffer delegate: it keeps a buffer only inside the hold.
    #[unsafe(super(NSObject))]
    #[name = "DeepDeviceCaptureOutput"]
    #[ivars = Shared]
    pub struct Output;

    unsafe impl NSObjectProtocol for Output {}

    impl Output {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output(&self, _output: &AnyObject, sample: &CMSampleBuffer, _connection: &AnyObject) {
            if let Ok(mut k) = self.ivars().lock() {
                arrived(&mut k, sample);
            }
        }
    }
);

fn arrived(k: &mut Kept, sample: &CMSampleBuffer) {
    let Some(pts) = unsafe { CMSampleBufferGetPresentationTimeStamp(sample) }.seconds() else {
        return;
    };
    // Delivered before the hold: counted, never kept.
    if k.down.is_none_or(|d| pts < d) {
        k.before_hold += 1;
        return;
    }
    // Nothing presented at or after the release is kept.
    if k.up.is_some_and(|up| pts >= up) {
        return;
    }
    let step = unsafe { CMSampleBufferGetDuration(sample) }.seconds();
    k.period = k
        .period
        .or(step)
        .or(k.last.map(|l| pts - l))
        .filter(|p| *p > 0.0);
    if k.writer.is_none() {
        match writer(k, sample, pts) {
            Ok(w) => k.writer = Some(w),
            Err(e) => {
                k.failed.get_or_insert(e);
                return;
            }
        }
    }
    let Some((_, input)) = &k.writer else { return };
    let ready: Bool = unsafe { msg_send![&*input.0, isReadyForMoreMediaData] };
    if ready.as_bool() {
        let ok: Bool = unsafe { msg_send![&*input.0, appendSampleBuffer: sample] };
        if ok.as_bool() {
            k.kept += 1;
            k.first.get_or_insert(pts);
            k.last = Some(pts);
        }
    }
}

/// A CFDictionary of NSString keys to NSString or 32-bit number values.
fn settings(pairs: &[(&str, Result<&str, i32>)]) -> Retained<AnyObject> {
    let keys: Vec<Retained<NSString>> = pairs.iter().map(|p| NSString::from_str(p.0)).collect();
    let mut owned: Vec<*const c_void> = Vec::new();
    let strings: Vec<Retained<NSString>> = pairs
        .iter()
        .filter_map(|p| p.1.ok())
        .map(NSString::from_str)
        .collect();
    let mut s = strings.iter();
    let values: Vec<*const c_void> = pairs
        .iter()
        .map(|p| match p.1 {
            Ok(_) => Retained::as_ptr(s.next().expect("a string per Ok")) as *const c_void,
            Err(n) => {
                let v = unsafe {
                    CFNumberCreate(std::ptr::null(), 3, &n as *const i32 as *const c_void)
                };
                owned.push(v);
                v
            }
        })
        .collect();
    let key_ptrs: Vec<*const c_void> = keys
        .iter()
        .map(|k| Retained::as_ptr(k) as *const c_void)
        .collect();
    unsafe {
        let d = CFDictionaryCreate(
            std::ptr::null(),
            key_ptrs.as_ptr(),
            values.as_ptr(),
            pairs.len() as isize,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        );
        owned.into_iter().for_each(|v| CFRelease(v));
        Retained::from_raw(d as *mut AnyObject).expect("a dictionary")
    }
}

/// The recording a hold's first kept buffer opens: H.264 in a QuickTime movie for the camera,
/// AAC in an M4A for the microphone, started at that buffer's time.
fn writer(k: &Kept, sample: &CMSampleBuffer, pts: f64) -> Result<(Object, Object), String> {
    let kind = k.kind.ok_or("no kind")?;
    let (file_type, opts) = match kind {
        Kind::Camera => {
            let image = unsafe { CMSampleBufferGetImageBuffer(sample) };
            if image.is_null() {
                return Err("a camera buffer without an image".into());
            }
            let (w, h) = unsafe { (CVPixelBufferGetWidth(image), CVPixelBufferGetHeight(image)) };
            (
                "com.apple.quicktime-movie",
                settings(&[
                    ("AVVideoCodecKey", Ok("avc1")),
                    ("AVVideoWidthKey", Err(w as i32)),
                    ("AVVideoHeightKey", Err(h as i32)),
                ]),
            )
        }
        Kind::Microphone => (
            "com.apple.m4a-audio",
            settings(&[
                ("AVFormatIDKey", Err(i32::from_be_bytes(*b"aac "))),
                ("AVSampleRateKey", Err(48_000)),
                ("AVNumberOfChannelsKey", Err(1)),
            ]),
        ),
    };
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&k.path.to_string_lossy()));
        let mut err: *mut NSError = std::ptr::null_mut();
        let w: Option<Retained<AnyObject>> = msg_send![class!(AVAssetWriter), assetWriterWithURL: &*url,
            fileType: &*NSString::from_str(file_type), error: &mut err];
        let w = w.ok_or_else(|| {
            format!(
                "AVAssetWriter: {}",
                err.as_ref().map_or(String::new(), |e| e.to_string())
            )
        })?;
        let input: Retained<AnyObject> = msg_send![class!(AVAssetWriterInput),
            assetWriterInputWithMediaType: kind.media(), outputSettings: &*opts];
        let _: () = msg_send![&*input, setExpectsMediaDataInRealTime: Bool::YES];
        let _: () = msg_send![&*w, addInput: &*input];
        let started: Bool = msg_send![&*w, startWriting];
        if !started.as_bool() {
            return Err("the recording didn't start".into());
        }
        let at = CMTime {
            value: (pts * 1_000_000_000.0).round() as i64,
            timescale: 1_000_000_000,
            flags: 1,
            epoch: 0,
        };
        let _: () = msg_send![&*w, startSessionAtSourceTime: at];
        Ok((Object(w), Object(input)))
    }
}

/// One device's capture: its session configured and stopped until the hold, its delegate's
/// record, and the session's objects.
pub struct Capture {
    pub kind: Kind,
    pub shared: Shared,
    session: Retained<AnyObject>,
    _output: Retained<Output>,
}

impl Capture {
    /// A panel's request for `kind`: the default device's session, configured but not running,
    /// so nothing is delivered until the hold starts it.
    pub fn arm(kind: Kind) -> Result<Capture, String> {
        let shared: Shared = Arc::new(Mutex::new(Kept {
            kind: Some(kind),
            path: std::env::temp_dir().join(format!(
                "deep-capture-{}-{}-{}.{}",
                std::process::id(),
                kind.name(),
                (host_now() * 1000.0) as u64,
                if kind == Kind::Camera { "mov" } else { "m4a" }
            )),
            ..Kept::default()
        }));
        unsafe {
            let device: Option<Retained<AnyObject>> =
                msg_send![class!(AVCaptureDevice), defaultDeviceWithMediaType: kind.media()];
            let device = device.ok_or_else(|| format!("no {}", kind.name()))?;
            let mut err: *mut NSError = std::ptr::null_mut();
            let input: Option<Retained<AnyObject>> = msg_send![class!(AVCaptureDeviceInput), deviceInputWithDevice: &*device, error: &mut err];
            let input = input.ok_or_else(|| {
                format!(
                    "the {} input: {}",
                    kind.name(),
                    err.as_ref().map_or(String::new(), |e| e.to_string())
                )
            })?;
            let session: Retained<AnyObject> = msg_send![class!(AVCaptureSession), new];
            let _: () = msg_send![&*session, addInput: &*input];
            let output: Retained<AnyObject> = match kind {
                Kind::Camera => msg_send![class!(AVCaptureVideoDataOutput), new],
                Kind::Microphone => msg_send![class!(AVCaptureAudioDataOutput), new],
            };
            let delegate = Output::alloc().set_ivars(shared.clone());
            let delegate: Retained<Output> = msg_send![super(delegate), init];
            let queue = dispatch_queue_create(c"deep.capture.device".as_ptr(), std::ptr::null());
            let _: () = msg_send![&*output, setSampleBufferDelegate: &*delegate, queue: &*(queue as *const AnyObject)];
            let _: () = msg_send![&*session, addOutput: &*output];
            Ok(Capture {
                kind,
                shared,
                session,
                _output: delegate,
            })
        }
    }

    /// The hold began at `down` (host seconds): the session starts.
    pub fn start(&self, down: f64) {
        if let Ok(mut k) = self.shared.lock() {
            k.down = Some(down);
        }
        let _: () = unsafe { msg_send![&*self.session, startRunning] };
    }

    /// The hold ended at `up`: nothing presented from then on is kept, and the session stops.
    pub fn stop(&self, up: f64) {
        if let Ok(mut k) = self.shared.lock() {
            k.up = Some(up);
        }
        let _: () = unsafe { msg_send![&*self.session, stopRunning] };
    }

    /// The recording finished and kept in `store` by its hash, or `None` when nothing was kept.
    pub fn finish(&self, store: &Path) -> Result<Option<String>, String> {
        let (writer, path) = {
            let mut k = self.shared.lock().map_err(|_| "a callback panicked")?;
            if let Some(f) = &k.failed {
                return Err(f.clone());
            }
            (k.writer.take(), k.path.clone())
        };
        let Some((w, input)) = writer else {
            return Ok(None);
        };
        let done = Arc::new(AtomicBool::new(false));
        let flag = done.clone();
        let block = RcBlock::new(move || flag.store(true, Ordering::SeqCst));
        unsafe {
            let _: () = msg_send![&*input.0, markAsFinished];
            let _: () = msg_send![&*w.0, finishWritingWithCompletionHandler: &*block];
        }
        let began = std::time::Instant::now();
        while !done.load(Ordering::SeqCst) {
            if began.elapsed().as_secs() > 10 {
                return Err(format!("the {} recording never finished", self.kind.name()));
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let bytes =
            std::fs::read(&path).map_err(|e| format!("the {} recording: {e}", self.kind.name()))?;
        let _ = std::fs::remove_file(&path);
        crate::capture::keep(store, &bytes)
            .map(Some)
            .map_err(|e| e.to_string())
    }
}
