//! The render thread: it owns the app's GPU and every scene's session (its GPU-layer view, slots
//! and render module), so all GPU work runs off the UI thread. The UI thread hands it closures and
//! waits for their answers only where the virtual clock waits for the GPU.

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use deep_gpu::device::{Backend, Gpu, Withheld};
use deep_gpu::encode::Pool;
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, View};

use crate::scene::{Scene, SceneModule};

/// A scene's session: its view, kept from one call to the next.
pub struct Session {
    pub scene: Arc<Scene>,
    pub view: View,
    pub path: Path,
    pub workers: usize,
}

/// A `view3d` call's session: a GPU-layer view drawing scene3d (#378), and what its render module
/// shares with the driver.
pub struct Scene3Session {
    pub view: View,
    pub shared: Arc<std::sync::Mutex<deep_scene3d_render::Shared>>,
}

pub struct State {
    pub gpu: Arc<Gpu>,
    pub sessions: HashMap<String, Session>,
    pub scene3d: Option<Scene3Session>,
    /// The scene the run drew last, which `surface` and `resources` describe.
    pub current: Option<String>,
    pub submits_on_completion: bool,
    pub releases_early: bool,
    /// The test writer's textures, by writer (#379, `test-meter` builds only).
    pub allocations: HashMap<String, Vec<wgpu::Texture>>,
}

/// The slot count every surface takes.
pub const SLOTS: usize = 3;
/// Encode workers when a call names none.
pub const WORKERS: usize = 4;
/// The upload budget of a scene that names no budget class.
const UPLOAD_BYTES: usize = 64 << 20;

impl State {
    /// The scene's session at `path` with `workers`, made (or remade, keeping the scene's name)
    /// when it has none or a different handoff or worker count.
    pub fn session(
        &mut self,
        key: &str,
        scene: Arc<Scene>,
        path: Path,
        workers: usize,
    ) -> Result<&mut Session, String> {
        let fresh = self
            .sessions
            .get(key)
            .is_none_or(|s| s.path != path || s.workers != workers);
        if fresh {
            self.sessions.remove(key);
            let config = Config {
                path,
                slots: SLOTS,
                size: scene.size,
                upload_bytes_per_frame: scene.upload_bytes_per_frame.unwrap_or(UPLOAD_BYTES),
            };
            let mut pool = Pool::new(workers);
            if self.submits_on_completion {
                pool.plant_submit_on_completion();
            }
            let module = Box::new(SceneModule::new(scene.clone()));
            let view = View::new(self.gpu.clone(), config, module, pool)?;
            if self.releases_early {
                view.ui().plant_early_release();
            }
            self.sessions.insert(
                key.to_string(),
                Session {
                    scene,
                    view,
                    path,
                    workers,
                },
            );
        }
        self.current = Some(key.to_string());
        Ok(self.sessions.get_mut(key).expect("made above"))
    }

    pub fn current(&mut self) -> Option<&mut Session> {
        let key = self.current.clone()?;
        self.sessions.get_mut(&key)
    }
}

type Work = Box<dyn FnOnce(&mut State) + Send>;

pub struct Worker {
    tx: mpsc::Sender<Work>,
    pub thread: String,
}

impl Worker {
    pub fn start(
        backend: Backend,
        withheld: Withheld,
        submits_on_completion: bool,
        releases_early: bool,
    ) -> Result<Worker, String> {
        let gpu = Gpu::open_withholding(backend, withheld)?;
        let (tx, rx) = mpsc::channel::<Work>();
        let name = "deep-gpu render".to_string();
        thread::Builder::new()
            .name(name.clone())
            .spawn(move || {
                let mut state = State {
                    gpu,
                    sessions: HashMap::new(),
                    scene3d: None,
                    current: None,
                    submits_on_completion,
                    releases_early,
                    allocations: HashMap::new(),
                };
                for work in rx {
                    work(&mut state);
                }
            })
            .map_err(|e| format!("no render thread: {e}"))?;
        Ok(Worker { tx, thread: name })
    }

    /// Runs `f` on the render thread and waits for its answer.
    pub fn call<R: Send + 'static>(&self, f: impl FnOnce(&mut State) -> R + Send + 'static) -> R {
        self.send(f).recv().expect("the render thread answers")
    }

    /// Runs `f` on the render thread; its answer comes on the returned channel.
    pub fn send<R: Send + 'static>(
        &self,
        f: impl FnOnce(&mut State) -> R + Send + 'static,
    ) -> mpsc::Receiver<R> {
        let (tx, rx) = mpsc::channel();
        self.tx
            .send(Box::new(move |state| {
                let _ = tx.send(f(state));
            }))
            .expect("the render thread is alive");
        rx
    }
}
