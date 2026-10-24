//! The noop lane's render-logic tests (issue #377): the GPU layer on wgpu's noop backend, with no
//! GPU. They hold what doesn't depend on pixels: the slots and their fences, uploads that settle
//! over frames, a lost device's rebuild, and command buffers submitted in frame order by index.

use std::sync::{Arc, Mutex};

use deep_gpu::device::{Backend, Device, Gpu};
use deep_gpu::encode::{Job, Pool};
use deep_gpu::render::{RenderModule, Target};
use deep_gpu::ring::{audit, SlotState};
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, View};

/// A module that clears its slot, uploads `upload` bytes after each build, and logs the layer
/// order its encodes ran in.
struct Probe {
    epoch: Option<u64>,
    upload: usize,
    buffer: Option<wgpu::Buffer>,
    layers: usize,
    ran: Arc<Mutex<Vec<usize>>>,
}

impl RenderModule for Probe {
    fn name(&self) -> &'static str {
        "test.probe"
    }

    fn declared(&self) -> Vec<&'static str> {
        vec!["upload:buffer"]
    }

    fn build(&mut self, device: &Device) -> Result<(), String> {
        self.buffer = Some(device.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: self.upload as u64,
            usage: wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
        self.epoch = Some(device.epoch);
        Ok(())
    }

    fn built_on(&self) -> Option<u64> {
        self.epoch
    }

    fn take_uploads(&mut self) -> Vec<(wgpu::Buffer, Arc<[u8]>)> {
        let data: Arc<[u8]> = vec![7; self.upload].into();
        self.buffer.clone().map(|b| (b, data)).into_iter().collect()
    }

    fn layers(&mut self, _: &Device, target: &Target) -> Vec<Job> {
        (0..self.layers)
            .map(|layer| {
                let (view, ran) = (target.view.clone(), self.ran.clone());
                Box::new(move |encoder: &mut wgpu::CommandEncoder| {
                    ran.lock().unwrap().push(layer);
                    let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: None,
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        ..Default::default()
                    });
                }) as Job
            })
            .collect()
    }
}

fn view(upload: usize, per_frame: usize, layers: usize) -> View {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    assert_eq!(gpu.device().backend, Backend::Noop);
    let probe = Probe {
        epoch: None,
        upload,
        buffer: None,
        layers,
        ran: Arc::default(),
    };
    let config = Config {
        path: Path::Copy,
        slots: 3,
        size: [64, 32],
        upload_bytes_per_frame: per_frame,
    };
    View::new(gpu, config, Box::new(probe), Pool::new(4)).expect("a view on noop")
}

/// Renders and shows `frame` with nothing on screen to hold it: latched, then retired.
fn frame(v: &mut View, n: u64) -> bool {
    let drawn = v.render(n).expect("renders").expect("a free slot");
    assert!(v.wait_done(drawn.slot), "frame {n} finishes");
    v.ui().retire();
    drawn.settling
}

#[test]
fn slots_cycle_without_a_gpu_and_the_fence_record_holds() {
    let mut v = view(16, 1 << 20, 1);
    let ui = v.ui();
    ui.record(true);
    for n in 0..20 {
        frame(&mut v, n);
    }
    audit(&ui.take_record(), 3).expect("no slot drawn while shown or released early");
    assert!(ui.states().iter().all(|s| *s == SlotState::Free));
}

#[test]
fn an_upload_past_the_budget_settles_over_later_frames() {
    // 40 bytes at 16 a frame: three frames report settling, the fourth doesn't.
    let mut v = view(40, 16, 1);
    let settling: Vec<bool> = (0..5).map(|n| frame(&mut v, n)).collect();
    assert_eq!(settling, [true, true, false, false, false]);
}

#[test]
fn a_lost_device_rebuilds_every_declared_resource_on_the_next() {
    let mut v = view(40, 16, 1);
    frame(&mut v, 0);
    let before = v.device().epoch;
    v.lose_device();
    frame(&mut v, 1);
    // Epochs count every device the process opens, so other tests' devices may come between.
    let after = v.device().epoch;
    assert!(after > before, "a new device after the loss");
    assert_eq!(v.module().built_on(), Some(after));
    assert_eq!(v.rebuilds(), 1);
    // The rebuilt module uploads again, from the start of the budget.
    assert!(frame(&mut v, 2));
}

#[test]
fn encodes_submit_in_frame_order_by_index_whatever_order_they_finish() {
    let gpu = Gpu::open(Backend::Noop).unwrap();
    let device = gpu.device();
    for workers in [1, 4] {
        let pool = Pool::new(workers);
        let jobs: Vec<Job> = (0..8)
            .map(|_| Box::new(|_: &mut wgpu::CommandEncoder| {}) as Job)
            .collect();
        let encodes = pool.run(&device.device, &device.queue, jobs);
        let submitted: Vec<usize> = encodes.iter().map(|e| e.submitted).collect();
        assert_eq!(submitted, (0..8).collect::<Vec<_>>(), "{workers} workers");
    }
    let mut planted = Pool::new(4);
    planted.plant_submit_on_completion();
    let jobs: Vec<Job> = (0..8)
        .map(|i| {
            Box::new(move |_: &mut wgpu::CommandEncoder| {
                // The later the layer, the sooner it finishes.
                std::thread::sleep(std::time::Duration::from_millis(40 - 5 * i as u64));
            }) as Job
        })
        .collect();
    let encodes = planted.run(&device.device, &device.queue, jobs);
    assert!(
        encodes.iter().any(|e| e.submitted != e.layer),
        "the planted pool submits as encodes finish, out of index order"
    );
}
