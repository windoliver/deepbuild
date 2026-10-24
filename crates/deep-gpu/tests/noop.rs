//! The noop lane's render-logic tests (issue #377): the GPU layer on wgpu's noop backend, with no
//! GPU. They hold what doesn't depend on pixels: the slots and their fences, uploads that settle
//! over frames, a lost device's rebuild, passes run in the frame's place order, and command
//! buffers submitted in frame order by index.

use std::sync::{Arc, Mutex};

use deep_gpu::device::{Backend, Device, Gpu};
use deep_gpu::encode::{Job, Pool};
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::ring::{audit, SlotState};
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, View};

/// A module that uploads `upload` bytes after each build and hands the frame one clearing encode
/// per pass, in the reverse of the order it declares them, plus one for `extra` if set, and logs
/// the order its encodes ran in.
struct Probe {
    epoch: Option<u64>,
    upload: usize,
    buffer: Option<wgpu::Buffer>,
    passes: Vec<Pass>,
    extra: Option<String>,
    ran: Arc<Mutex<Vec<String>>>,
}

fn pass(name: &str, place: &'static str, reads: &[&'static str], writes: &[&'static str]) -> Pass {
    Pass {
        name: name.into(),
        place,
        order: 0,
        reads: reads.to_vec(),
        writes: writes.to_vec(),
        resolution: Resolution::Full,
        ns_per_px: 0.01,
        determinism: Determinism::SameMachine,
    }
}

impl RenderModule for Probe {
    fn name(&self) -> &'static str {
        "test.probe"
    }

    fn declared(&self) -> Vec<&'static str> {
        vec!["upload:buffer"]
    }

    fn passes(&self) -> Vec<Pass> {
        self.passes.clone()
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

    fn layers(&mut self, _: &Device, target: &Target) -> Vec<(String, Job)> {
        let names = self.passes.iter().rev().map(|p| p.name.clone());
        names
            .chain(self.extra.clone())
            .map(|name| {
                let (view, ran, logged) = (target.view.clone(), self.ran.clone(), name.clone());
                let job = Box::new(move |encoder: &mut wgpu::CommandEncoder| {
                    ran.lock().unwrap().push(logged);
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
                }) as Job;
                (name, job)
            })
            .collect()
    }
}

/// A view of a probe with `passes` (and an undeclared encode `extra`) on `workers` encode workers.
fn view_of(
    upload: usize,
    per_frame: usize,
    passes: Vec<Pass>,
    extra: Option<&str>,
    workers: usize,
) -> (Result<View, String>, Arc<Mutex<Vec<String>>>) {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    assert_eq!(gpu.device().backend, Backend::Noop);
    let ran = Arc::<Mutex<Vec<String>>>::default();
    let probe = Probe {
        epoch: None,
        upload,
        buffer: None,
        passes,
        extra: extra.map(Into::into),
        ran: ran.clone(),
    };
    let config = Config {
        path: Path::Copy,
        slots: 3,
        size: [64, 32],
        upload_bytes_per_frame: per_frame,
    };
    let view = View::new(gpu, config, Box::new(probe), Pool::new(workers));
    (view, ran)
}

fn view(upload: usize, per_frame: usize) -> View {
    let passes = vec![pass("probe", "geometry", &[], &["slot"])];
    view_of(upload, per_frame, passes, None, 4)
        .0
        .expect("a view on noop")
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
    let mut v = view(16, 1 << 20);
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
    let mut v = view(40, 16);
    let settling: Vec<bool> = (0..5).map(|n| frame(&mut v, n)).collect();
    assert_eq!(settling, [true, true, false, false, false]);
}

#[test]
fn a_lost_device_rebuilds_every_declared_resource_on_the_next() {
    let mut v = view(40, 16);
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

#[test]
fn passes_run_in_the_frames_place_order_whatever_order_they_are_declared() {
    // Declared finish, geometry, compute; the probe hands its encodes over in the reverse of that.
    let passes = vec![
        pass("grade", "finish", &["slot"], &["slot"]),
        pass("draw", "geometry", &["cells"], &["slot"]),
        pass("cull", "compute", &[], &["cells"]),
    ];
    let (v, ran) = view_of(16, 1 << 20, passes, None, 1);
    let mut v = v.expect("legal passes");
    frame(&mut v, 0);
    assert_eq!(*ran.lock().unwrap(), ["cull", "draw", "grade"]);
}

#[test]
fn a_pass_outside_the_frames_places_or_reading_a_later_target_is_refused() {
    let refused = |passes: Vec<Pass>| match view_of(16, 1 << 20, passes, None, 1).0 {
        Ok(_) => panic!("the view was made"),
        Err(e) => e,
    };
    let e = refused(vec![pass("glow", "overlay", &[], &["slot"])]);
    assert!(
        e.starts_with("illegal_place") && e.contains("`overlay`"),
        "{e}"
    );
    // `bloom` runs after `geometry`, so `draw` can't see what it writes.
    let e = refused(vec![
        pass("draw", "geometry", &["bright"], &["slot"]),
        pass("bright", "bloom", &[], &["bright"]),
    ]);
    assert!(
        e.starts_with("unwritten_read") && e.contains("`bright`"),
        "{e}"
    );
    let e = refused(vec![
        pass("draw", "geometry", &[], &["slot"]),
        pass("draw", "effects", &[], &["slot"]),
    ]);
    assert!(e.starts_with("duplicate_pass"), "{e}");
    let mut costly = pass("draw", "geometry", &[], &["slot"]);
    costly.ns_per_px = f32::NAN;
    assert!(refused(vec![costly]).starts_with("bad_cost"));
    // An encode for a pass the module never declared fails the frame and frees its slot.
    let passes = vec![pass("draw", "geometry", &[], &["slot"])];
    let mut v = view_of(16, 1 << 20, passes, Some("sneak"), 1).0.unwrap();
    let Err(e) = v.render(0) else {
        panic!("the frame fails");
    };
    assert!(
        e.starts_with("undeclared_pass") && e.contains("`sneak`"),
        "{e}"
    );
    assert!(v.ui().states().iter().all(|s| *s == SlotState::Free));
}
