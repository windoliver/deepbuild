//! The UI check (#124): `ui_check` renders each view a change touches at the reference window and a narrow width, in
//! light and dark, and audits each: text drawn past its frame, cut-off text whose full value isn't in its accessibility
//! name, a control with no name, and a raw string key. Files the change touches that no rendered view loads are listed
//! as not covered, and the claim can't then pass. With a build of the merge base, each render stands beside the same
//! view from that build, the proof for a change that promises nothing visible changes. Given a journey instead, it
//! replays the journey in a fresh replica and audits the screen after every step, adding what covers a control: a
//! sibling drawn over it, and a device's system bar or on-screen keyboard.

use std::{
    collections::BTreeSet,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use deep_app::views::{Kind, HOME, SESSION, WELCOME};
use gpui_kit::ElementId;
use serde_json::{json, Value};

use super::{
    fail,
    locate::{contains, string, Frame, Target, CONTROLS},
    panel_bounds, sha256, Drive, Fail, Replica,
};

/// The reference window and the narrow width, in points. The app has no narrower layout of its own to name, so narrow
/// is the sidebar and a center about as wide again and a half.
const SIZES: [[u32; 2]; 2] = [
    [crate::WINDOW.0 as u32, crate::WINDOW.1 as u32],
    [720, crate::WINDOW.1 as u32],
];
const THEMES: [&str; 2] = ["light", "dark"];

struct View {
    name: String,
    /// The repo-relative files it loads.
    files: BTreeSet<String>,
    /// The panel the center shows when it isn't the launch's own.
    center: Option<&'static str>,
    /// The panel package it is, in the sidebar's slot.
    panel: Option<PathBuf>,
}

/// One render's place, which each of its findings names; a journey's step has no view of its own.
struct Place<'a> {
    view: Option<&'a View>,
    size: [u32; 2],
    theme: &'a str,
}

pub fn run(drive: &mut Drive, args: &Value) -> Result<Value, Fail> {
    if let Some(calls) = args["journey"].as_array() {
        return journey(drive, calls);
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let root = root.canonicalize().unwrap_or(root);
    let changed: Vec<&str> = args["changed"]
        .as_array()
        .ok_or_else(|| {
            fail(
                "refused",
                "ui_check.changed lists the files the change touches",
            )
        })?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let mut views = shipped(&root);
    if let Some(dir) = args["panel"].as_str() {
        views.push(panel(&root, Path::new(dir))?);
    }
    views.retain(|view| changed.iter().any(|file| view.files.contains(*file)));
    let not_covered: Vec<&str> = changed
        .iter()
        .copied()
        .filter(|file| !views.iter().any(|view| view.files.contains(*file)))
        .collect();

    let base = args["base"].as_object();
    let (mut drawn, mut findings, mut differs, mut evidence) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for view in &views {
        let mut renders = Vec::new();
        for size in SIZES {
            for theme in THEMES {
                let place = Place {
                    view: Some(view),
                    size,
                    theme,
                };
                let launch = json!({
                    "from": "fixture", "fixture": args["fixture"], "panel": view.panel, "center": view.center,
                    "size": size, "theme": theme, "clock": "virtual",
                });
                let (mut render, found) = render(drive, &place, &launch)?;
                if let Some(base) = base {
                    let pair = beside(drive, base, &launch, &render)?;
                    if pair["same"] == false {
                        differs.push(json!({"view": view.name, "size": size, "theme": theme}));
                    }
                    render["base"] = pair;
                }
                // Views drawn in one window share a picture, and evidence is by hash.
                if !evidence
                    .iter()
                    .any(|e: &Value| e["sha256"] == render["sha256"])
                {
                    evidence.push(json!({
                        "slot": format!("{} {theme} {}x{}", view.name, size[0], size[1]),
                        "state": "captured", "sha256": render["sha256"],
                    }));
                }
                findings.extend(found);
                renders.push(render);
            }
        }
        drawn.push(json!({"view": view.name, "files": view.files, "renders": renders}));
    }

    let promised = args["promise"] == "nothing_visible";
    let claim = if !findings.is_empty() || (promised && !differs.is_empty()) {
        "FAIL"
    } else if !not_covered.is_empty() || views.is_empty() || (promised && base.is_none()) {
        "INCONCLUSIVE"
    } else {
        "PASS"
    };
    Ok(json!({
        "claim": claim, "views": drawn, "findings": findings, "not_covered": not_covered, "differs": differs,
        "evidence": evidence,
    }))
}

fn answered(reply: Value) -> Result<Value, Fail> {
    match (reply["ok"].as_bool(), reply["error"].as_object()) {
        (Some(true), _) => Ok(reply),
        (_, Some(error)) => Err(Fail(error.clone())),
        _ => Err(fail("blocked", format!("the replica answered {reply}"))),
    }
}

/// One view, one way: launched, seen, shot and audited, in a replica that ends with it.
fn render(drive: &mut Drive, place: &Place, launch: &Value) -> Result<(Value, Vec<Value>), Fail> {
    answered(drive.call(&json!({"call": "launch", "launch": launch})))?;
    let seen = answered(drive.call(&json!({"call": "see", "see": {"scope": "window"}})))?;
    let shot =
        answered(drive.call(&json!({"call": "screenshot", "screenshot": {"target": "window"}})))?;
    let replica = drive.replica.as_mut().expect("the launch above");
    let frame = replica.frame();
    let slot = place
        .view
        .and_then(|view| view.panel.as_ref())
        .map(|_| panel_bounds(frame.scale))
        .transpose()?;
    let findings = audit(&frame, place, slot);
    answered(drive.call(&json!({"call": "close"})))?;
    let render = json!({
        "size": place.size, "scale": 2, "theme": place.theme, "path": shot["path"], "sha256": shot["sha256"],
        "w": shot["w"], "h": shot["h"], "snapshot": seen["snapshot"], "findings": findings,
    });
    Ok((render, findings))
}

/// The same view from the merge base's own build, in a process of its own, driven through calls any build has.
fn beside(
    drive: &mut Drive,
    base: &serde_json::Map<String, Value>,
    launch: &Value,
    render: &Value,
) -> Result<Value, Fail> {
    let bin = base["drive"].as_str().ok_or_else(|| {
        fail(
            "refused",
            "ui_check.base.drive is a deep-drive built at the merge base",
        )
    })?;
    drive.launches += 1;
    let out = drive.out.join("base").join(drive.launches.to_string());
    let trouble = |e: String| fail("blocked", format!("the merge base's {bin}: {e}"));
    let mut child = Command::new(bin)
        .arg("--out")
        .arg(&out)
        .env_remove("DEEP_DRIVE_PLANT")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| trouble(e.to_string()))?;
    let mut lines = BufReader::new(child.stdout.take().expect("piped")).lines();
    lines.next(); // Its ready line.
    let mut stdin = child.stdin.take().expect("piped");
    let mut launch = launch.clone();
    if !base.get("panel").is_none_or(Value::is_null) {
        launch["panel"] = base["panel"].clone();
    }
    let mut ask = |call: Value| -> Result<Value, Fail> {
        writeln!(stdin, "{call}").map_err(|e| trouble(e.to_string()))?;
        let line = lines
            .next()
            .ok_or_else(|| trouble("it ended early".into()))?;
        let line = line.map_err(|e| trouble(e.to_string()))?;
        answered(serde_json::from_str(&line).map_err(|e| trouble(e.to_string()))?)
    };
    let shot = (|| {
        ask(json!({"call": "launch", "launch": launch}))?;
        let shot = ask(json!({"call": "screenshot", "screenshot": {"target": "window"}}))?;
        ask(json!({"call": "close"}))?;
        Ok::<Value, Fail>(shot)
    })();
    drop(stdin);
    let _ = child.wait();
    let shot = shot?;
    let path = shot["path"].as_str().unwrap_or_default().to_owned();
    let bytes = fs::read(&path).map_err(|e| trouble(format!("{path}: {e}")))?;
    let ours = render["path"].as_str().unwrap_or_default();
    let ours = fs::read(ours).map_err(|e| fail("blocked", format!("{ours}: {e}")))?;
    let pixels = |png: &[u8]| image::load_from_memory(png).map(|i| i.to_rgba8());
    let same = matches!((pixels(&bytes), pixels(&ours)), (Ok(a), Ok(b)) if a == b);
    Ok(json!({"path": path, "sha256": sha256(&bytes), "same": same}))
}

// ---- What a change touches.

/// The shipped views, from the inventory that lists what each draws.
fn shipped(root: &Path) -> Vec<View> {
    let inventory: Value = serde_json::from_str(include_str!("../../../deep-app/inventory.json"))
        .expect("the app's inventory is JSON");
    let panels = inventory["panels"].as_array().cloned().unwrap_or_default();
    Kind::ALL
        .iter()
        .filter_map(|kind| {
            let entry = panels.iter().find(|p| p["panel"] == kind.name())?;
            let file = entry["entry"].as_str()?.split(' ').next()?;
            Some(View {
                name: kind.name().into(),
                files: rust_files(root, file),
                center: match kind {
                    Kind::Home => Some(HOME),
                    Kind::Session => Some(SESSION),
                    Kind::Welcome => Some(WELCOME),
                    Kind::Sidebar | Kind::NeedsYou | Kind::Line => None,
                },
                panel: None,
            })
        })
        .collect()
}

/// `entry` and every file of its crate it reaches through `crate::`.
fn rust_files(root: &Path, entry: &str) -> BTreeSet<String> {
    let source = entry.rfind('/').map_or("", |slash| &entry[..=slash]);
    let module = |name: &str| {
        [
            format!("{source}{name}.rs"),
            format!("{source}{name}/mod.rs"),
        ]
        .into_iter()
        .find(|file| root.join(file).is_file())
    };
    let mut files = BTreeSet::new();
    let mut open = vec![entry.to_owned()];
    while let Some(file) = open.pop() {
        let Ok(text) = fs::read_to_string(root.join(&file)) else {
            continue;
        };
        files.insert(file);
        for (at, _) in text.match_indices("crate::") {
            let rest = &text[at + "crate::".len()..];
            let names = match rest.strip_prefix('{') {
                Some(list) => list.split('}').next().unwrap_or_default(),
                None => rest
                    .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .next()
                    .unwrap_or_default(),
            };
            for name in names.split(',') {
                let name = name.trim().split("::").next().unwrap_or_default();
                if let Some(found) = module(name).filter(|found| !files.contains(found)) {
                    open.push(found);
                }
            }
        }
    }
    files
}

/// A panel package: `main.js` and every file it imports, near or far, named from the repo's root.
fn panel(root: &Path, dir: &Path) -> Result<View, Fail> {
    let dir = dir
        .canonicalize()
        .map_err(|e| fail("refused", format!("ui_check.panel {}: {e}", dir.display())))?;
    let mut seen = BTreeSet::new();
    let mut open = vec![dir.join("main.js")];
    while let Some(file) = open.pop() {
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        let folder = file.parent().unwrap_or(&dir).to_owned();
        seen.insert(file);
        for quote in ['"', '\''] {
            for piece in text.split(quote).skip(1).step_by(2) {
                if piece.starts_with('.') {
                    if let Ok(found) = folder.join(piece).canonicalize() {
                        if found.is_file() && !seen.contains(&found) {
                            open.push(found);
                        }
                    }
                }
            }
        }
    }
    let name = dir
        .file_name()
        .map_or_else(|| "panel".into(), |n| n.to_string_lossy().into_owned());
    let files = seen
        .iter()
        .map(|file| {
            file.strip_prefix(root)
                .unwrap_or(file)
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    Ok(View {
        name,
        files,
        center: None,
        panel: Some(dir),
    })
}

// ---- The audits.

/// A dotted lower-case path of three parts or more, as a string table's key reads; a file's name has two.
fn raw_key(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() >= 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        })
        && parts[0].starts_with(|c: char| c.is_ascii_lowercase())
}

/// The string as drawn with its ellipsis off, if it has one.
fn before_ellipsis(text: &str) -> Option<&str> {
    text.strip_suffix('…').or_else(|| text.strip_suffix("..."))
}

/// Whether an accessibility name holds what a cut-off string lost: the words the ellipsis stands for, or, for a string
/// its clip cut, the whole string.
fn holds_all_of(name: Option<&str>, text: &str) -> bool {
    let Some(name) = name else { return false };
    match before_ellipsis(text) {
        None => name.contains(text),
        Some(start) => name.match_indices(start).any(|(at, _)| {
            let rest = &name[at + start.len()..];
            !rest.is_empty() && before_ellipsis(rest).is_none_or(|more| !more.is_empty())
        }),
    }
}

/// What's wrong in one render of a view. A panel is what's inside its slot; a shipped view, what's under its own
/// element. Text belongs to the smallest element with a role holding where it starts. Only text is measured against
/// its frame: an element past its parent may be scrolled or clipped, and an element's clip isn't in the frame's reading.
fn audit(frame: &Frame, place: &Place, slot: Option<[i64; 4]>) -> Vec<Value> {
    let ours = |target: &Target| ours(place, slot, target);
    let finding = |audit: &str, node: Value, boxed: [i64; 4], frame: Value, text: Value| {
        json!({
            "audit": audit, "view": place.view.map(|v| &v.name), "size": place.size, "theme": place.theme,
            "node": node, "box": boxed, "frame": frame, "text": text,
        })
    };
    let mut found = Vec::new();
    for run in frame.runs.iter().filter(|run| run.visible) {
        let text = string(run);
        let [x, y, w, h] = run.drawn;
        let holder = frame.holder([x, y + h / 2]);
        if !(holder.is_some_and(ours) || (slot.is_some() && ours(&text))) {
            continue;
        }
        if raw_key(&run.text) {
            found.push(finding(
                "raw_key",
                text.summary(),
                run.bounds,
                Value::Null,
                json!(run.text),
            ));
        }
        let Some(holder) = holder else { continue };
        if !contains(holder.bounds, run.drawn) {
            found.push(finding(
                "outside_frame",
                holder.summary(),
                run.drawn,
                json!(holder.bounds),
                Value::Null,
            ));
        }
        let clipped = run.cut || w + 2 < run.bounds[2];
        if (clipped || before_ellipsis(&run.text).is_some())
            && !holds_all_of(holder.name.as_deref(), &run.text)
        {
            found.push(finding(
                "cut_off",
                holder.summary(),
                run.drawn,
                Value::Null,
                json!(run.text),
            ));
        }
    }
    // An empty text field has no text of its own by nature; only a control drawn as an icon needs a name to be one.
    for control in controls(frame, |e| ours(e)).filter(|e| !e.role.ends_with("input")) {
        let unnamed = control.name.as_deref().is_none_or(str::is_empty);
        if unnamed && control.value.is_none() && frame.text_inside(control.bounds).is_empty() {
            found.push(finding(
                "no_name",
                control.summary(),
                control.bounds,
                Value::Null,
                Value::Null,
            ));
        }
    }
    found
}

/// Whether an element is the view's: inside the panel's slot, or under the view's own element; a journey's step with
/// no panel is the whole window.
fn ours(place: &Place, slot: Option<[i64; 4]>, target: &Target) -> bool {
    match (slot, place.view) {
        (Some(slot), _) => contains(slot, target.bounds),
        (None, Some(view)) => target
            .path
            .contains(&ElementId::Name(format!("view:{}", view.name).into())),
        (None, None) => true,
    }
}

/// The visible controls a view holds: buttons and the roles a person sets.
fn controls<'a>(
    frame: &'a Frame,
    ours: impl Fn(&Target) -> bool + 'a,
) -> impl Iterator<Item = &'a Target> {
    frame.elements.iter().filter(move |e| {
        e.visible && (e.role == "button" || CONTROLS.contains(&e.role.as_str())) && ours(e)
    })
}

/// The part two boxes share, or None.
fn overlap(a: [i64; 4], b: [i64; 4]) -> Option<[i64; 4]> {
    let (x0, y0) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x1, y1) = (
        (a[0] + a[2]).min(b[0] + b[2]),
        (a[1] + a[3]).min(b[1] + b[3]),
    );
    (x1 > x0 && y1 > y0).then_some([x0, y0, x1 - x0, y1 - y0])
}

/// The controls something covers on the screen now: another branch the frame's own hit test gives the control's
/// centre to, and the device's system bar and keyboard wherever they overlap it. Each finding names what covers the
/// control and the part it covers.
fn covered(
    replica: &mut Replica,
    frame: &Frame,
    place: &Place,
    slot: Option<[i64; 4]>,
) -> Vec<Value> {
    let insets = replica.insets();
    let mut found = Vec::new();
    for control in controls(frame, |e| ours(place, slot, e)) {
        let over = replica
            .cx
            .update_window(replica.window, |_, window, _| {
                frame.receiver(window, control, control.center())
            })
            .expect("the replica's window is open");
        let mut by = Vec::new();
        if over.path != control.path {
            by.push(("under_sibling", over.summary(), over.bounds));
        }
        for (audit, role, bounds) in &insets {
            by.push((
                *audit,
                json!({"role": role, "name": null, "bounds": bounds}),
                *bounds,
            ));
        }
        for (audit, by, bounds) in by {
            if let Some(part) = overlap(control.bounds, bounds) {
                found.push(json!({
                    "audit": audit, "view": place.view.map(|v| &v.name), "size": place.size,
                    "theme": place.theme, "node": control.summary(), "by": by, "box": part, "frame": null,
                    "text": null,
                }));
            }
        }
    }
    found
}

/// A journey, replayed in a fresh replica and audited after every step: each step's screen gets the render audits
/// and what covers its controls. The claim fails on any finding, and can't pass when the journey didn't.
fn journey(drive: &mut Drive, calls: &[Value]) -> Result<Value, Fail> {
    let Some((first, rest)) = calls.split_first().filter(|(c, _)| c["call"] == "launch") else {
        return Err(fail(
            "refused",
            "ui_check.journey is deep_drive calls, a launch first",
        ));
    };
    let launch = answered(drive.call(first))?;
    let id = launch["replica"].clone();
    let size = [
        first["launch"]["size"][0]
            .as_u64()
            .map_or(crate::WINDOW.0 as u32, |w| w as u32),
        first["launch"]["size"][1]
            .as_u64()
            .map_or(crate::WINDOW.1 as u32, |h| h as u32),
    ];
    let theme = first["launch"]["theme"].as_str().unwrap_or("light");
    let place = Place {
        view: None,
        size,
        theme,
    };
    let panel = !first["launch"]["panel"].is_null();
    let (mut steps, mut findings) = (Vec::new(), Vec::new());
    for call in rest.iter().filter(|c| c["call"] != "close") {
        let mut call = call.clone();
        call["replica"] = id.clone();
        drive.call(&call);
        let replica = drive.replica.as_mut().expect("the launch above");
        let (snapshot, frame) = replica.tree();
        let slot = panel.then(|| panel_bounds(frame.scale)).transpose()?;
        let mut found = audit(&frame, &place, slot);
        found.extend(covered(replica, &frame, &place, slot));
        let k = replica.steps.len();
        for finding in &mut found {
            finding["step"] = json!(k);
        }
        let step_id = replica
            .steps
            .last()
            .map_or(Value::Null, |s| s["id"].clone());
        findings.extend(found.iter().cloned());
        steps.push(json!({"step": k, "id": step_id, "snapshot": snapshot, "findings": found}));
    }
    let closed = answered(drive.call(&json!({"call": "close", "replica": id})))?;
    let journey = &closed["journey"];
    let claim = if !findings.is_empty() {
        "FAIL"
    } else if journey["outcome"] != "passed"
        || steps.len() != journey["steps"].as_array().map_or(0, Vec::len)
    {
        "INCONCLUSIVE"
    } else {
        "PASS"
    };
    Ok(json!({"claim": claim, "journey": journey, "steps": steps, "findings": findings}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_raw_key_is_a_dotted_lower_case_path_of_three_parts() {
        for key in ["panel.actions.save_label", "a.b.c", "app.menu2.quit_now"] {
            assert!(raw_key(key), "{key}");
        }
        for words in [
            "Save changes",
            "views.rs",
            "gpt-5.1-codex",
            "1.2.3",
            "github.com/org/repo",
            "e.g. this",
            "a..b",
        ] {
            assert!(!raw_key(words), "{words}");
        }
    }

    #[test]
    fn a_name_holds_all_of_a_cut_string_only_past_where_it_was_cut() {
        assert!(holds_all_of(
            Some("● feature/long-branch · 3 tasks"),
            "feature/lo…"
        ));
        assert!(!holds_all_of(Some("● feature/lo…"), "feature/lo…"));
        assert!(!holds_all_of(Some("● feature/lo"), "feature/lo…"));
        assert!(!holds_all_of(None, "feature/lo…"));
        assert!(!holds_all_of(Some("something else"), "feature/lo…"));
        assert!(holds_all_of(Some("the whole string"), "whole string"));
        assert!(!holds_all_of(Some("the whole"), "whole string"));
    }
}
