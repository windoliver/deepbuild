//! Encode workers (canvas primitives: Render worker). A frame's independent writer layers encode
//! on worker threads, each into a command buffer of its own, and the buffers are submitted in
//! frame order by index, never in the order the workers finish. A test pool can hand finished
//! buffers back in reverse or in a seeded random order, so a test can show the order never
//! reaches the pixels; the planted pool submits each buffer as it arrives.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

/// The order a test pool hands finished encodes back in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Finish {
    /// As the workers finish them.
    AsDone,
    Reverse,
    /// A permutation drawn from this seed.
    Seeded(u64),
}

/// One layer's encode: a closure that records its passes into the encoder it's given.
pub type Job = Box<dyn FnOnce(&mut wgpu::CommandEncoder) + Send>;

/// What happened to one layer's encode: the rank it finished at and the rank its command buffer
/// was submitted at (0 first).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Encode {
    pub layer: usize,
    pub completed: usize,
    pub submitted: usize,
}

struct Task {
    index: usize,
    job: Job,
    device: wgpu::Device,
    done: mpsc::Sender<(usize, wgpu::CommandBuffer)>,
}

pub struct Pool {
    workers: usize,
    tasks: Option<mpsc::Sender<Task>>,
    threads: Vec<thread::JoinHandle<()>>,
    finish: Finish,
    /// The planted pool: submits each buffer in the order it arrives.
    submits_on_completion: bool,
}

impl Pool {
    pub fn new(workers: usize) -> Self {
        assert!(workers >= 1);
        let (tx, rx) = mpsc::channel::<Task>();
        let rx = Arc::new(Mutex::new(rx));
        let threads = (0..workers)
            .map(|n| {
                let rx = rx.clone();
                thread::Builder::new()
                    .name(format!("deep-gpu encode {n}"))
                    .spawn(move || loop {
                        let task = match rx.lock().unwrap_or_else(|e| e.into_inner()).recv() {
                            Ok(task) => task,
                            Err(_) => return,
                        };
                        let mut encoder =
                            task.device
                                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                                    label: Some("deep-gpu layer"),
                                });
                        (task.job)(&mut encoder);
                        let _ = task.done.send((task.index, encoder.finish()));
                    })
                    .expect("spawn an encode worker")
            })
            .collect();
        Self {
            workers,
            tasks: Some(tx),
            threads,
            finish: Finish::AsDone,
            submits_on_completion: false,
        }
    }

    /// A test pool: finished encodes come back in `finish` order (test builds only).
    #[cfg(feature = "test-pool")]
    pub fn finish_in(&mut self, finish: Finish) {
        self.finish = finish;
    }

    pub fn plant_submit_on_completion(&mut self) {
        self.submits_on_completion = true;
    }

    pub fn workers(&self) -> usize {
        self.workers
    }

    /// Encodes every job and submits the buffers; returns what happened to each, by layer.
    pub fn run(&self, device: &wgpu::Device, queue: &wgpu::Queue, jobs: Vec<Job>) -> Vec<Encode> {
        let n = jobs.len();
        let (done, arrived) = mpsc::channel();
        let tasks = self.tasks.as_ref().expect("pool is open");
        for (index, job) in jobs.into_iter().enumerate() {
            let task = Task {
                index,
                job,
                device: device.clone(),
                done: done.clone(),
            };
            tasks.send(task).expect("encode workers are alive");
        }
        drop(done);
        let mut finished: Vec<(usize, wgpu::CommandBuffer)> = arrived.iter().take(n).collect();
        match self.finish {
            Finish::AsDone => {}
            Finish::Reverse => finished.sort_by_key(|(i, _)| std::cmp::Reverse(*i)),
            Finish::Seeded(seed) => shuffle(&mut finished, seed),
        }
        let mut report: Vec<Encode> = (0..n)
            .map(|layer| Encode {
                layer,
                completed: 0,
                submitted: 0,
            })
            .collect();
        for (rank, (i, _)) in finished.iter().enumerate() {
            report[*i].completed = rank;
        }
        if self.submits_on_completion {
            for (rank, (i, buffer)) in finished.into_iter().enumerate() {
                report[i].submitted = rank;
                queue.submit([buffer]);
            }
            return report;
        }
        let mut slots: Vec<Option<wgpu::CommandBuffer>> = (0..n).map(|_| None).collect();
        for (i, buffer) in finished {
            report[i].submitted = i;
            slots[i] = Some(buffer);
        }
        queue.submit(slots.into_iter().map(|b| b.expect("every job finished")));
        report
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.tasks = None;
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

/// A Fisher–Yates shuffle on a splitmix64 stream, so a seed names one order on every platform.
fn shuffle<T>(items: &mut [T], seed: u64) {
    let mut state = seed;
    let mut next = || {
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    for i in (1..items.len()).rev() {
        let j = (next() % (i as u64 + 1)) as usize;
        items.swap(i, j);
    }
}
