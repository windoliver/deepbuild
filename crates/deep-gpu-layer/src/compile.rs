//! The `compile` call (README: Calls): every pipeline a scene needs compiles on the compile
//! thread while the UI thread runs its frames; the answer says how long the UI thread was held up.
//! With `hold` (#140, criterion 20), the job is held open until `release_job`, so the device can
//! be lost (`lose_device`) while it's in flight: what it returns from a lost device is dropped.

use std::sync::mpsc;
use std::time::{Duration, Instant};

use deep_gpu::compile::{CompileThread, Compiling};
use serde_json::{json, Value};

use crate::frames::{self, Args};
use crate::scene::{compile_named, Named};
use crate::{refused, App, Planted};

/// A compile-thread job held open: its scene, the device epoch it compiles on, and its release.
pub struct Held {
    id: u64,
    scene: String,
    epoch: u64,
    release: mpsc::Sender<()>,
    job: Compiling<Vec<Named>>,
    _thread: CompileThread,
}

pub fn call(app: &mut App, call: &Value) -> Value {
    let Some(path) = call["scene"].as_str() else {
        return refused("bad_input", "compile takes a scene");
    };
    if call["hold"] == true {
        return hold(app, path);
    }
    let scene = match app.scene(path) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let pipelines = scene.pipelines();
    // The scene's view on screen, so each UI frame latches and composes it as it would.
    if let Err(e) = frames::drive(app, "", &Args::new(path, 1), &|_| false) {
        return e;
    }
    let device = match app.worker.call(|state| state.gpu.recover()) {
        Ok(d) => d,
        Err(e) => return refused("no_device", e),
    };
    let compile_thread = CompileThread::new();
    let ui_thread = std::thread::current().name().unwrap_or("main").to_string();
    let compile_all = move || -> Vec<String> {
        pipelines
            .into_iter()
            .map(|(k, color)| compile_named(&device.device, k, color).0)
            .collect()
    };
    let on_ui = app.planted == Some(Planted::CompilesOnUiThread);
    let (mut compiling, mut planted) = if on_ui {
        (None, Some(compile_all))
    } else {
        (Some(compile_thread.compile(compile_all)), None)
    };
    let mut keys = None;
    let (mut ticks, mut stall) = (0u64, Duration::ZERO);
    while keys.is_none() {
        let tick = Instant::now();
        // The UI thread's GPU-layer work this frame: asking whether the pipelines are ready (or,
        // planted, compiling them itself), then latching and composing the view.
        if let Some(c) = compiling.as_mut() {
            keys = c.poll().cloned();
        } else if let Some(compile) = planted.take() {
            keys = Some(compile());
        }
        let own = tick.elapsed();
        if let Some(w) = app.window.as_ref() {
            w.present(&mut app.cx);
        }
        let ui = app
            .window
            .as_ref()
            .map_or(Duration::ZERO, |w| w.paint.borrow().ui_time);
        stall = stall.max(own + ui);
        ticks += 1;
        std::thread::sleep(Duration::from_millis(1));
    }
    let keys = keys.unwrap_or_default();
    json!({
        "pipelines": keys.iter().map(|k| json!({"key": k})).collect::<Vec<_>>(),
        "thread": if on_ui { ui_thread.clone() } else { deep_gpu::compile::THREAD.to_string() },
        "ui_thread": ui_thread,
        "ui_ticks": ticks,
        "ui_max_stall_ms": stall.as_secs_f64() * 1e3,
    })
}

/// `compile` with `hold`: the scene on screen, then its pipelines compiled on the compile thread
/// on the current device, the result held back until `release_job`.
fn hold(app: &mut App, path: &str) -> Value {
    if app.held.is_some() {
        return refused("bad_input", "one compile job is held at a time");
    }
    if let Err(e) = frames::drive(app, "", &Args::new(path, 1), &|_| false) {
        return e;
    }
    let pipelines = match app.scene(path) {
        Ok(s) => s.pipelines(),
        Err(e) => return e,
    };
    let device = match app.worker.call(|state| state.gpu.recover()) {
        Ok(d) => d,
        Err(e) => return refused("no_device", e),
    };
    let epoch = device.epoch;
    let (release, released) = mpsc::channel::<()>();
    let thread = CompileThread::new();
    let job = thread.compile(move || {
        let named: Vec<Named> = pipelines
            .into_iter()
            .map(|(k, color)| {
                let (key, p) = compile_named(&device.device, k, color);
                (k, key, device.epoch, p)
            })
            .collect();
        let _ = released.recv();
        named
    });
    let id = app.jobs + 1;
    app.jobs = id;
    app.held = Some(Held {
        id,
        scene: path.to_string(),
        epoch,
        release,
        job,
        _thread: thread,
    });
    json!({"job": id, "state": "held", "device_epoch": epoch})
}

/// `{"call": "lose_device"}`: forces the device lost; the GPU layer opens a new one, and every
/// view rebuilds on it.
pub fn lose_device(app: &mut App) -> Value {
    let answer = app.worker.call(|state| -> Result<(u64, u64), String> {
        let lost = state.gpu.device();
        lost.force_loss();
        let current = state.gpu.recover()?;
        for s in state.sessions.values_mut() {
            s.view.recover()?;
        }
        Ok((lost.epoch, current.epoch))
    });
    match answer {
        Ok((lost, current)) => json!({"lost_epoch": lost, "device_epoch": current}),
        Err(e) => refused("no_device", e),
    }
}

/// `{"call": "release_job"}`: releases the held job and answers once its result reached the
/// view: installed when it was compiled on the current device, dropped when that device was lost.
/// Planted (`installs_stale_pipelines`), the view installs whatever the compile thread returns.
pub fn release_job(app: &mut App) -> Value {
    let Some(held) = app.held.take() else {
        return refused("bad_input", "no compile job is held");
    };
    let _ = held.release.send(());
    let Some(named) = held.job.wait() else {
        return refused("no_compile", "the compile thread dropped the job");
    };
    let stale = app.planted == Some(Planted::InstallsStalePipelines);
    let (scene, epoch) = (held.scene, held.epoch);
    let outcome = app.worker.call(move |state| {
        let current = state.gpu.device().epoch;
        match state.sessions.get(&scene) {
            Some(s) if epoch == current || stale => {
                let mut installed = s.installed.lock().unwrap_or_else(|e| e.into_inner());
                installed.pipelines = named;
                "installed"
            }
            _ => "dropped",
        }
    });
    json!({"job": held.id, "compiled_on": epoch, "outcome": outcome})
}
