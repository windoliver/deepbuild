//! Issue #105: a capture of a screen or window for a bug report, live (canvas primitives:
//! Capture; technical design: Device gate and capture). What is recorded is named only by your
//! answer in ScreenCaptureKit's system picker, which is good for one hold and never kept as a
//! grant. The stream starts when ⌥Space goes down in the HID key-state table (#339's gate, which
//! no event moves) and stops when it lets go, or after `max` (120 s); the system's capture
//! indicator and the app's own in the menu bar show while it records. The recording waits in a
//! temporary file while the hold runs, so a crash leaves no asset; once finished it is kept in the
//! evidence store by its SHA-256, with redaction `unknown` until it is reviewed.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Capture's `max: s = 120`.
pub const MAX_SECONDS: f64 = 120.0;

/// Keeps `bytes` in the evidence store at `root` as `<first 2 hex>/<other 62 hex>` (#15's
/// layout), written whole before it is named; returns the hash.
pub fn keep(root: &Path, bytes: &[u8]) -> std::io::Result<String> {
    let sha: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let dir = root.join(&sha[..2]);
    std::fs::create_dir_all(&dir)?;
    let temp = dir.join(format!(".tmp-{}", std::process::id()));
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, dir.join(&sha[2..]))?;
    Ok(sha)
}

/// Where the recording waits while a hold runs: outside the store, so nothing there is an asset
/// until the recording is whole.
pub fn spool() -> PathBuf {
    std::env::temp_dir().join(format!("deep-capture-{}.mp4", std::process::id()))
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, Message};
    use objc2_app_kit::{NSStatusBar, NSStatusItem, NSVariableStatusItemLength};
    use objc2_core_graphics::CGMainDisplayID;
    use objc2_core_media::CMSampleBuffer;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_screen_capture_kit::{
        SCContentFilter, SCContentSharingPicker, SCContentSharingPickerConfiguration,
        SCContentSharingPickerMode, SCContentSharingPickerObserver, SCRecordingOutput,
        SCRecordingOutputConfiguration, SCRecordingOutputDelegate, SCShareableContentStyle,
        SCStream, SCStreamConfiguration, SCStreamOutput, SCStreamOutputType,
    };

    /// The picker's choice. A content filter is never changed once the picker made it, so it
    /// may be read on the thread that runs the hold, whichever thread the picker answered on.
    #[derive(Clone)]
    pub struct Picked(pub Retained<SCContentFilter>);

    unsafe impl Send for Picked {}

    /// What the picker, the stream and the recording reported, from whichever thread they call.
    #[derive(Default)]
    pub struct Reported {
        pub picked: Option<Picked>,
        pub cancelled: bool,
        pub failed: Option<String>,
        pub frames: u64,
        pub first_frame: Option<Instant>,
        pub finished: bool,
    }

    pub type Shared = Arc<Mutex<Reported>>;

    fn note(shared: &Shared, f: impl FnOnce(&mut Reported)) {
        if let Ok(mut r) = shared.lock() {
            f(&mut r);
        }
    }

    define_class!(
        /// The picker's observer, the stream's output and the recording's delegate.
        #[unsafe(super(NSObject))]
        #[name = "DeepBugCaptureObserver"]
        #[ivars = Shared]
        pub struct Observer;

        unsafe impl NSObjectProtocol for Observer {}

        unsafe impl SCContentSharingPickerObserver for Observer {
            #[unsafe(method(contentSharingPicker:didCancelForStream:))]
            fn did_cancel(&self, _: &SCContentSharingPicker, _: Option<&SCStream>) {
                note(self.ivars(), |r| r.cancelled = true);
            }

            #[unsafe(method(contentSharingPicker:didUpdateWithFilter:forStream:))]
            fn did_pick(
                &self,
                _: &SCContentSharingPicker,
                filter: &SCContentFilter,
                _: Option<&SCStream>,
            ) {
                note(self.ivars(), |r| r.picked = Some(Picked(filter.retain())));
            }

            #[unsafe(method(contentSharingPickerStartDidFailWithError:))]
            fn picker_failed(&self, error: &NSError) {
                note(self.ivars(), |r| {
                    r.failed = Some(format!("picker: {error}"))
                });
            }
        }

        unsafe impl SCStreamOutput for Observer {
            #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
            fn did_output(&self, _: &SCStream, _: &CMSampleBuffer, kind: SCStreamOutputType) {
                if kind == SCStreamOutputType::Screen {
                    note(self.ivars(), |r| {
                        r.frames += 1;
                        r.first_frame.get_or_insert_with(Instant::now);
                    });
                }
            }
        }

        unsafe impl SCRecordingOutputDelegate for Observer {
            #[unsafe(method(recordingOutput:didFailWithError:))]
            fn recording_failed(&self, _: &SCRecordingOutput, error: &NSError) {
                note(self.ivars(), |r| {
                    r.failed = Some(format!("recording: {error}"))
                });
            }

            #[unsafe(method(recordingOutputDidFinishRecording:))]
            fn recording_finished(&self, _: &SCRecordingOutput) {
                note(self.ivars(), |r| r.finished = true);
            }
        }
    );

    impl Observer {
        pub fn new(shared: Shared) -> Retained<Self> {
            let this = Self::alloc().set_ivars(shared);
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Opens the system picker for one display or one window, reporting to `observer`.
    pub fn present_picker(observer: &Observer) {
        unsafe {
            let picker = SCContentSharingPicker::sharedPicker();
            let config = SCContentSharingPickerConfiguration::new();
            config.setAllowedPickerModes(
                SCContentSharingPickerMode::SingleDisplay
                    | SCContentSharingPickerMode::SingleWindow,
            );
            picker.setDefaultConfiguration(&config);
            picker.addObserver(ProtocolObject::from_ref(observer));
            picker.setActive(true);
            picker.present();
        }
    }

    /// The picker put away once it has answered, so its choice stands for this hold only.
    pub fn close_picker(observer: &Observer) {
        unsafe {
            let picker = SCContentSharingPicker::sharedPicker();
            picker.removeObserver(ProtocolObject::from_ref(observer));
            picker.setActive(false);
        }
    }

    /// What the picker chose: `screen` or `window`, and the display's ID and whether it is the
    /// main display, for a screen.
    pub fn picked(filter: &SCContentFilter) -> (&'static str, Option<(u32, bool)>) {
        unsafe {
            match filter.style() {
                SCShareableContentStyle::Display => {
                    let display = filter
                        .includedDisplays()
                        .firstObject()
                        .map(|d| d.displayID());
                    ("screen", display.map(|id| (id, id == CGMainDisplayID())))
                }
                SCShareableContentStyle::Window => ("window", None),
                _ => ("other", None),
            }
        }
    }

    /// A stream of the picked content at its pixel size, writing one MP4 (H.264) to `spool`,
    /// with `observer` counting its frames; not started.
    pub fn prepare(
        filter: &SCContentFilter,
        observer: &Observer,
        spool: &std::path::Path,
    ) -> Result<(Retained<SCStream>, Retained<SCRecordingOutput>), String> {
        unsafe {
            let config = SCStreamConfiguration::new();
            let rect = filter.contentRect();
            let scale = f64::from(filter.pointPixelScale());
            config.setWidth((rect.size.width * scale).round() as usize);
            config.setHeight((rect.size.height * scale).round() as usize);
            config.setShowsCursor(true);
            let stream = SCStream::initWithFilter_configuration_delegate(
                SCStream::alloc(),
                filter,
                &config,
                None,
            );
            stream
                .addStreamOutput_type_sampleHandlerQueue_error(
                    ProtocolObject::from_ref(observer),
                    SCStreamOutputType::Screen,
                    None,
                )
                .map_err(|e| format!("stream output: {e}"))?;
            let out = SCRecordingOutputConfiguration::new();
            let path = NSString::from_str(&spool.to_string_lossy());
            out.setOutputURL(&NSURL::fileURLWithPath(&path));
            let recording = SCRecordingOutput::initWithConfiguration_delegate(
                SCRecordingOutput::alloc(),
                &out,
                ProtocolObject::from_ref(observer),
            );
            stream
                .addRecordingOutput_error(&recording)
                .map_err(|e| format!("recording output: {e}"))?;
            Ok((stream, recording))
        }
    }

    fn completion(shared: &Shared, what: &'static str) -> RcBlock<dyn Fn(*mut NSError)> {
        let shared = shared.clone();
        RcBlock::new(move |error: *mut NSError| {
            if let Some(error) = unsafe { error.as_ref() } {
                note(&shared, |r| r.failed = Some(format!("{what}: {error}")));
            }
        })
    }

    pub fn start(stream: &SCStream, shared: &Shared) {
        unsafe { stream.startCaptureWithCompletionHandler(Some(&completion(shared, "start"))) }
    }

    /// Stops the stream, which finishes the recording file.
    pub fn stop(stream: &SCStream, shared: &Shared) {
        unsafe { stream.stopCaptureWithCompletionHandler(Some(&completion(shared, "stop"))) }
    }

    /// The app's own indicator while it records: a menu-bar item nothing else draws.
    pub struct Indicator(Retained<NSStatusItem>);

    impl Indicator {
        pub fn show(mtm: MainThreadMarker) -> Self {
            let item =
                NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
            if let Some(button) = item.button(mtm) {
                button.setTitle(&NSString::from_str(
                    "● Recording a bug — let go of ⌥Space to stop",
                ));
            }
            Indicator(item)
        }
    }

    impl Drop for Indicator {
        fn drop(&mut self) {
            NSStatusBar::systemStatusBar().removeStatusItem(&self.0);
        }
    }
}
