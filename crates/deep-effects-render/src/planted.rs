//! The structural steps' planted wrong programs (#483; `planted.wgsl`), each reachable only
//! through the binary's `--planted`: a sort fed its input reversed, so equal keys come out in
//! decreasing index, and a compaction that appends at an atomic counter's returned value.


/// Dispatches recorded before (or instead of) a shipped step's plan, a compute pass each.
pub struct Pre {
    dispatches: Vec<(wgpu::ComputePipeline, wgpu::BindGroup, u32)>,
    _keep: Vec<wgpu::Buffer>,
}

fn pipeline(d: &deep_gpu::counted::Wgpu, entry: &str) -> wgpu::ComputePipeline {
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("planted structural steps"),
        source: wgpu::ShaderSource::Wgsl(include_str!("planted.wgsl").into()),
    });
    d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(entry),
        layout: None,
        module: &module,
        entry_point: Some(entry),
        compilation_options: Default::default(),
        cache: None,
    })
}

fn group(
    d: &deep_gpu::counted::Wgpu,
    p: &wgpu::ComputePipeline,
    n: u32,
    bufs: &[&wgpu::Buffer],
) -> (wgpu::BindGroup, wgpu::Buffer) {
    let params = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("planted params"),
        contents: &[n, 0, 0, 0]
            .iter()
            .flat_map(|w: &u32| w.to_le_bytes())
            .collect::<Vec<u8>>(),
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let mut entries = vec![wgpu::BindGroupEntry {
        binding: 0,
        resource: params.as_entire_binding(),
    }];
    for (k, b) in bufs.iter().enumerate() {
        entries.push(wgpu::BindGroupEntry {
            binding: k as u32 + 1,
            resource: b.as_entire_binding(),
        });
    }
    let g = d.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("planted"),
        layout: &p.get_bind_group_layout(0),
        entries: &entries,
    });
    (g, params)
}

impl Pre {
    /// `src` reversed into `dst`, for each (src, dst).
    pub fn reverse(d: &deep_gpu::counted::Wgpu, pairs: &[(&wgpu::Buffer, &wgpu::Buffer)], n: u32) -> Pre {
        let p = pipeline(d, "reverse");
        let mut out = Pre {
            dispatches: Vec::new(),
            _keep: Vec::new(),
        };
        for (src, dst) in pairs {
            let (g, keep) = group(d, &p, n, &[src, dst]);
            out.dispatches.push((p.clone(), g, n.div_ceil(256).max(1)));
            out._keep.push(keep);
        }
        out
    }

    /// The flagged words of `src` appended to `out` at a counter's returned value, the count into
    /// `count` (which the caller clears first).
    pub fn append(
        d: &deep_gpu::counted::Wgpu,
        src: &wgpu::Buffer,
        flag: &wgpu::Buffer,
        out: &wgpu::Buffer,
        count: &wgpu::Buffer,
        n: u32,
    ) -> Pre {
        let p = pipeline(d, "append");
        let (g, keep) = group(d, &p, n, &[src, flag, out, count]);
        Pre {
            dispatches: vec![(p, g, n.div_ceil(256).max(1))],
            _keep: vec![keep],
        }
    }

    pub fn queries(&self) -> u32 {
        2 * self.dispatches.len() as u32
    }

    /// Records each dispatch in a compute pass of its own, with `stamps` as `Plan::dispatch`.
    pub fn dispatch(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        stamps: Option<(&wgpu::QuerySet, u32)>,
    ) {
        for (k, (p, g, n)) in self.dispatches.iter().enumerate() {
            let writes = stamps.map(|(set, at)| wgpu::ComputePassTimestampWrites {
                query_set: set,
                beginning_of_pass_write_index: Some(at + 2 * k as u32),
                end_of_pass_write_index: Some(at + 2 * k as u32 + 1),
            });
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("planted structural step"),
                timestamp_writes: writes,
            });
            pass.set_pipeline(p);
            pass.set_bind_group(0, g, &[]);
            pass.dispatch_workgroups(*n, 1, 1);
        }
    }

    /// Records each dispatch timed as one under a meter's `writes`.
    pub fn dispatch_spanned(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        writes: Option<wgpu::ComputePassTimestampWrites<'_>>,
    ) {
        let last = self.dispatches.len().saturating_sub(1);
        for (k, (p, g, n)) in self.dispatches.iter().enumerate() {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("planted structural step"),
                timestamp_writes: crate::structural::spanned(writes.as_ref(), k, last),
            });
            pass.set_pipeline(p);
            pass.set_bind_group(0, g, &[]);
            pass.dispatch_workgroups(*n, 1, 1);
        }
    }
}
