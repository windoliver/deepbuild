//! The `compile` call (README: Calls): every pipeline a scene needs compiles on the compile
//! thread while the UI thread runs its frames; the answer says how long the UI thread was held up.

use std::time::{Duration, Instant};

use deep_gpu::compile::CompileThread;
use serde_json::{json, Value};

use crate::frames::{self, Args};
use crate::scene::compile_named;
use crate::{refused, App, Planted};

pub fn call(app: &mut App, call: &Value) -> Value {
    let Some(path) = call["scene"].as_str() else {
        return refused("bad_input", "compile takes a scene");
    };
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
