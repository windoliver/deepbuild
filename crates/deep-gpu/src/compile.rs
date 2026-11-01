//! The compile thread (issue #377): a document's pipelines compile on a thread of their own before
//! warm-up relies on them, and the UI thread only asks whether they're ready, which never waits.

use std::sync::mpsc;
use std::thread;

type Work = Box<dyn FnOnce() + Send>;

/// The compile thread's name.
pub const THREAD: &str = "deep-gpu compile";

pub struct CompileThread {
    tx: Option<mpsc::Sender<Work>>,
    thread: Option<thread::JoinHandle<()>>,
}

/// A compile in flight, and its result once the compile thread has it.
pub struct Compiling<T> {
    rx: mpsc::Receiver<T>,
    done: Option<T>,
}

impl<T> Compiling<T> {
    /// The result, if it's ready; never waits.
    pub fn poll(&mut self) -> Option<&T> {
        if self.done.is_none() {
            self.done = self.rx.try_recv().ok();
        }
        self.done.as_ref()
    }

    /// The result, waited for off the UI thread; `None` if the compile thread dropped it.
    pub fn wait(self) -> Option<T> {
        self.done.or_else(|| self.rx.recv().ok())
    }
}

impl CompileThread {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<Work>();
        let thread = thread::Builder::new()
            .name(THREAD.into())
            .spawn(move || {
                for work in rx {
                    work();
                }
            })
            .expect("spawn the compile thread");
        Self {
            tx: Some(tx),
            thread: Some(thread),
        }
    }

    /// Runs `compile` on the compile thread.
    pub fn compile<T: Send + 'static>(
        &self,
        compile: impl FnOnce() -> T + Send + 'static,
    ) -> Compiling<T> {
        let (tx, rx) = mpsc::channel();
        let work: Work = Box::new(move || {
            let _ = tx.send(compile());
        });
        self.tx
            .as_ref()
            .expect("compile thread is open")
            .send(work)
            .expect("compile thread is alive");
        Compiling { rx, done: None }
    }
}

impl Default for CompileThread {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for CompileThread {
    fn drop(&mut self) {
        self.tx = None;
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
