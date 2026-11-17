//! Issue #518: the encode job kind's tools as an export knows them (Export: encode job). The
//! build's own come first, today's encoders as the kind's first tools: the platform's encoder and
//! our PNG sequence writer, each this binary's own encode tool process. After them come the tools
//! the hub holds from installed plug-ins (the scenario's `job_tools`), each a program of its own.
//! A document names a codec and the first tool that registers it encodes; it names a tool only
//! when its brief pins that tool. A codec no tool registers is BLOCKED before a frame is drawn.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::Job;
use crate::hub::Hub;

/// How a tool runs.
#[derive(Clone, Debug)]
pub enum Run {
    /// This build's own encode tool, a copy of this binary; a test tool's stub open answers this
    /// many milliseconds after it is asked.
    Own(Option<u64>),
    /// A plug-in's program, as its host runs a `run {dir, entry}` tool: the command and its folder.
    Program { argv: Vec<String>, cwd: PathBuf },
}

/// One tool of the job kind `encode`, as `deep.registerJobTool` holds it.
#[derive(Clone, Debug)]
pub struct Tool {
    /// name@version.
    pub id: String,
    pub codecs: Vec<String>,
    pub hardware: bool,
    /// The most frames its encoder holds at once.
    pub frame_delay: u8,
    pub run: Run,
    /// A test tool encodes only for an export whose brief pins it.
    pub pinned_only: bool,
    /// It takes each frame as a slot of the export's ring of GPU surfaces, not as a copy.
    pub surface: bool,
}

impl Tool {
    /// The tool's name and version, as the receipt's `encoder` gives them.
    pub(crate) fn name_version(&self) -> (&str, &str) {
        self.id.split_once('@').unwrap_or((&self.id, ""))
    }

    /// The frames an export may hand it that it hasn't let go of: `frame_delay` + 2.
    pub(crate) fn window(&self) -> usize {
        usize::from(self.frame_delay) + 2
    }

    fn own(id: &str, codecs: &[&str], hardware: bool, stub_open_ms: Option<u64>) -> Tool {
        Tool {
            id: id.into(),
            codecs: codecs.iter().map(|c| c.to_string()).collect(),
            hardware,
            frame_delay: 0,
            run: Run::Own(stub_open_ms),
            pinned_only: stub_open_ms.is_some(),
            surface: false,
        }
    }
}

/// The platform's encoder as a tool: VideoToolbox on macOS, which is where a build has one.
const PLATFORM: &str = "videotoolbox@1.0.0";
/// Our own PNG sequence writer as a tool.
const PNG_SEQUENCE: &str = "png-sequence@1.0.0";
const PLATFORM_CODECS: [&str; 3] = ["h264", "hevc", "prores_4444"];

/// Whether a codec's tool reads the conversion pass's NV12 planes: a 4:2:0 codec. An alpha codec
/// and a PNG sequence take the BGRA8 frame itself.
pub(crate) fn yuv420(codec: &str) -> bool {
    matches!(codec, "h264" | "hevc" | "av1" | "vp9")
}

/// Today's encoders, the kind's first tools on this machine.
fn first_party() -> Vec<Tool> {
    let mut tools = Vec::new();
    if cfg!(target_os = "macos") {
        tools.push(Tool::own(PLATFORM, &PLATFORM_CODECS, true, None));
    }
    tools.push(Tool::own(PNG_SEQUENCE, &["png_seq"], false, None));
    tools
}

/// The native test tools of the `test-encode-tools` build (#518's acceptance README): the
/// platform's H.264 tool behind a stub open that answers 2.0 s after it is asked, or at once.
#[cfg(feature = "test-encode-tools")]
fn test_tools() -> Vec<Tool> {
    let mut tools = vec![
        Tool::own("test-open-2s@1.0.0", &["h264"], true, Some(2_000)),
        Tool::own("test-open-0s@1.0.0", &["h264"], true, Some(0)),
    ];
    // This binary run as `test-encode-tool` with a plan (export/test_tools.rs): AV1 writers that
    // take the conversion pass's planes by copy, and on macOS PNG sequence writers that take
    // GPU surfaces.
    let av1 = ["av1", "av1_drops", "av1_bt601"].map(|plan| (plan, "av1", 0, false));
    let surface =
        ["frames", "red_before", "red_after", "keeps"].map(|plan| (plan, "png_seq", 2, true));
    let ids = [
        "test-av1@1.0.0",
        "test-av1-drops-100th@1.0.0",
        "test-av1-bt601@1.0.0",
        "test-frames@1.0.0",
        "test-red-before@1.0.0",
        "test-red-after@1.0.0",
        "test-keeps-slots@1.0.0",
    ];
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("deep-show"));
    for (id, (plan, codec, frame_delay, surface)) in
        ids.into_iter().zip(av1.into_iter().chain(surface))
    {
        // A slot is an IOSurface: the tools that take one are macOS's.
        if surface && !cfg!(target_os = "macos") {
            continue;
        }
        let argv = [exe.to_string_lossy().as_ref(), "test-encode-tool", plan].map(String::from);
        tools.push(Tool {
            id: id.into(),
            codecs: vec![codec.into()],
            hardware: false,
            frame_delay,
            run: Run::Program {
                argv: argv.to_vec(),
                cwd: std::env::temp_dir(),
            },
            pinned_only: true,
            surface,
        });
    }
    tools
}

#[cfg(not(feature = "test-encode-tools"))]
fn test_tools() -> Vec<Tool> {
    Vec::new()
}

/// The scenario's `job_tools`: the encode tools the hub holds from installed plug-ins, each as
/// its plug-in registered it with the command its host runs it by; `None` for a list that isn't
/// one.
pub(crate) fn parse(list: Option<&Value>) -> Option<Vec<Tool>> {
    let Some(list) = list else {
        return Some(Vec::new());
    };
    let texts = |v: &Value| -> Option<Vec<String>> {
        let list = v.as_array()?.iter().map(|t| Some(t.as_str()?.to_string()));
        list.collect()
    };
    let tool = |t: &Value| {
        let (name, version) = t.get("tool")?.as_str()?.split_once('@')?;
        let named = !name.is_empty() && version.split('.').count() == 3;
        Some(Tool {
            id: t.get("tool")?.as_str()?.to_string(),
            codecs: texts(t.get("codecs")?)?,
            hardware: t.get("hardware")?.as_bool()?,
            frame_delay: u8::try_from(t.get("frame_delay")?.as_u64()?)
                .ok()
                .filter(|d| *d <= 16)?,
            run: Run::Program {
                argv: texts(t.get("argv")?).filter(|a| !a.is_empty())?,
                cwd: PathBuf::from(t.get("cwd")?.as_str()?),
            },
            pinned_only: false,
            surface: false,
        })
        .filter(|_| named && t.get("kind").and_then(Value::as_str) == Some("encode"))
        // Whichever input it registers, this build hands it each frame by a copy through memory.
        .filter(|_| {
            matches!(
                t.get("input").and_then(Value::as_str),
                Some("surface" | "memory")
            )
        })
    };
    list.as_array()?.iter().map(tool).collect()
}

/// An export that names a tool its brief didn't pin, refused at check, naming the tool.
fn unpinned(tool: &str) -> Value {
    json!({"outcome": "refused", "code": "tool_not_pinned", "tool": tool, "frames_drawn": 0,
        "why": format!("the export names the tool {tool}, which its brief doesn't pin: a document names a codec, and a tool only when its brief pins one")})
}

/// A codec this machine's decode worker can't decode: BLOCKED before a frame is drawn.
pub(crate) fn undecodable(codec: &str) -> Value {
    let what = format!("this machine's decode worker can't decode {codec}, so a delivery in it can't be checked from its own bytes");
    json!({"outcome": "blocked", "state": "BLOCKED", "code": "codec_undecodable", "codec": codec, "frames_drawn": 0, "frames_hashed": 0,
        "issues": [{"code": "codec_undecodable", "severity": "error", "codec": codec, "what": what}]})
}

/// A codec no qualified tool on this machine registers: BLOCKED before a frame is drawn.
fn no_tool(codec: &str) -> Value {
    let what = format!("no qualified encode tool on this machine registers the codec {codec}");
    json!({"outcome": "blocked", "state": "BLOCKED", "code": "no_encode_tool", "codec": codec, "frames_drawn": 0, "frames_hashed": 0,
        "issues": [{"code": "no_encode_tool", "severity": "error", "codec": codec, "what": what}]})
}

impl Hub<'_> {
    /// Every encode tool this run holds: the build's own first, then the hub's in registration
    /// order, then a test build's.
    pub(super) fn encode_tools(&self) -> Vec<Tool> {
        let mut tools = first_party();
        tools.extend(self.scenario.job_tools.iter().cloned());
        tools.extend(test_tools());
        tools
    }

    /// #518: an export that names a tool (`tool: name@version`) names one its brief pins
    /// (`brief: {tools}`), or it is refused before anything else is read.
    pub(super) fn pinned(&self, job: &Job) -> Result<(), Value> {
        match &job.tool {
            Some(t) if !job.pins.contains(t) => Err(unpinned(t)),
            _ => Ok(()),
        }
    }

    /// The tool that encodes `job`'s codec: the one it names, else the first that registers the
    /// codec; none is BLOCKED, naming the codec.
    pub(super) fn tool_for(&self, job: &Job) -> Result<Tool, Value> {
        let tools = self.encode_tools();
        let registers = |t: &&Tool| t.codecs.contains(&job.codec);
        match &job.tool {
            Some(named) => match tools.iter().find(|t| t.id == *named) {
                Some(t) if registers(&t) => Ok(t.clone()),
                Some(_) => Err(
                    json!({"outcome": "refused", "code": "tool_codec", "tool": named, "codec": job.codec,
                    "why": format!("the tool {named} doesn't register the codec {}", job.codec)}),
                ),
                None => Err(
                    json!({"outcome": "refused", "code": "unknown_tool", "tool": named,
                    "why": format!("no encode tool {named} is registered on this machine")}),
                ),
            },
            None => tools
                .iter()
                .filter(|t| !t.pinned_only)
                .find(registers)
                .cloned()
                .ok_or_else(|| no_tool(&job.codec)),
        }
    }
}
