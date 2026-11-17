use super::*;

impl Groups {
    /// `image` laid over the empty target `into`, in `space`.
    pub(super) fn laid(
        &mut self,
        device: &Device,
        image: &image::RgbaImage,
        into: &wgpu::Texture,
        size: [u32; 2],
        decode: bool,
    ) {
        let texture = upload(device, image, size);
        let source = texture.create_view(&Default::default());
        let mix = Mix {
            decode,
            ..Mix::over(&source, size)
        };
        self.composite(device, into, mix, size);
    }

    /// `layer` composed: its target, in the space it composites in, and each blend's inputs.
    pub fn compose(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        layer: &Layer<'_>,
    ) -> Result<(wgpu::Texture, Vec<BlendInputs>, Vec<Value>), Value> {
        self.free.append(&mut self.taken);
        // A frame isolates at most 32 groups (Frame and group).
        let drawn = layer
            .layers
            .iter()
            .flat_map(|l| l.iter())
            .flat_map(|m| &m.scopes);
        let mut groups = BTreeSet::new();
        for s in drawn {
            // #2031: a lit group's runs draw offscreen as the group, so it counts once.
            let group = match s {
                Scope::Opacity { item, .. } if !item.contains('#') => Some(item.as_str()),
                Scope::Opacity {
                    item,
                    effect: Some(e),
                    ..
                } if e.light.is_some() => item.strip_suffix("#light"),
                _ => None,
            };
            if let Some(group) = group {
                groups.insert(group);
                if groups.len() > MAX_ISOLATED {
                    return Err(refused("operator_limit", format!("items/{group}")));
                }
            }
        }
        let mut stack: Option<wgpu::Texture> = None;
        let mut inputs = Vec::new();
        let mut costs = Vec::new();
        if let (true, Some(page)) = (layer.ground, layer.page) {
            let linear = layer.base.is_some();
            if let Some(t) = self
                .passes_on(device)
                .ground(device, page, layer.size, linear)
            {
                deep_gpu::spans::done_with(&t.create_view(&Default::default()));
                stack = Some(self.copied(device, &t, layer.size));
            }
        }
        for marks in layer.layers {
            let (done, kept, cost) = self.one(device, vello, layer, marks)?;
            inputs.extend(kept);
            costs.extend(cost);
            stack = Some(match stack {
                Some(under) => {
                    let view = done.create_view(&Default::default());
                    self.composite(device, &under, Mix::over(&view, layer.size), layer.size);
                    self.give(&done);
                    under
                }
                None => done,
            });
        }
        let stack = match stack {
            Some(stack) => stack,
            None => self.take(device, layer.size, ACC),
        };
        // #2742: whatever the frame's timing spans hold open ends once the layer is composed.
        deep_gpu::spans::done_with(&stack.create_view(&Default::default()));
        Ok((stack, inputs, costs))
    }

    /// A frame's own copy of `t`.
    pub(super) fn copied(
        &mut self,
        device: &Device,
        t: &wgpu::Texture,
        size: [u32; 2],
    ) -> wgpu::Texture {
        let copy = self.take(device, size, ACC);
        let mut encoder = device.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_texture(t.as_image_copy(), copy.as_image_copy(), whole(size));
        device.queue.submit([encoder.finish()]);
        deep_gpu::spans::done_with(&copy.create_view(&Default::default()));
        copy
    }

    /// The page's ground alone, read back: what `layers` answers for its `ground` row.
    pub fn ground(
        &mut self,
        device: &Device,
        page: &Page,
        size: [u32; 2],
    ) -> Result<Option<Picture>, Value> {
        let Some(t) = self.passes_on(device).ground(device, page, size, false) else {
            return Ok(None);
        };
        let d = &device.device;
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let out = target(d, size, format);
        let view = out.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        self.finish(d, &mut encoder, &t, &view, format, false);
        let image =
            deep_marks_render::gpu::read_back(d, &device.queue, encoder, &out, size, format)?;
        Ok(Some(Picture {
            image,
            floats: Some(f32_bytes(&read_texture(device, &t, 0).1)),
            inputs: Vec::new(),
            costs: Vec::new(),
        }))
    }

    /// One writer layer composed alone.
    pub(super) fn one(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        layer: &Layer<'_>,
        marks: &[Arc<Drawn>],
    ) -> Result<(wgpu::Texture, Vec<BlendInputs>, Vec<Value>), Value> {
        let linear = layer.base.is_some();
        let done = self.take(device, layer.size, ACC);
        if let Some(base) = layer.base {
            self.laid(device, base, &done, layer.size, true);
        }
        let other = layer.other.map(|image| {
            let t = target(&device.device, layer.size, ACC);
            self.laid(device, image, &t, layer.size, linear);
            t
        });
        let marks: Vec<Drawn> = marks.iter().map(|m| (**m).clone()).collect();
        let mut run = Run {
            device,
            vello,
            size: layer.size,
            options: layer.options,
            space: if linear {
                Space::Linear
            } else {
                Space::Encoded
            },
            clock: layer.clock,
            roles: layer.roles,
            packs: layer.packs,
            canonical: layer.canonical,
            planted: layer.planted,
            around: Vec::new(),
            inputs: layer.keep.then(Vec::new),
            written: Vec::new(),
            other,
            late: Vec::new(),
            page: layer.page,
            all: &marks,
            costs: Vec::new(),
        };
        self.marks(&mut run, &marks, &done)?;
        for (group, k) in std::mem::take(&mut run.late) {
            self.late(&mut run, &group, k, &done)?;
        }
        if let Some(guard) = layer.guard {
            let written = std::mem::take(&mut run.written);
            self.guarded(&run, guard, &written, &done);
        }
        if let Some(page) = layer.page.filter(|p| p.relief.is_some()) {
            let before = self.copied(device, &done, layer.size);
            let view = before.create_view(&Default::default());
            self.passes_on(device).relief(device, page, &view, &done);
            deep_gpu::spans::done_with(&done.create_view(&Default::default()));
            self.give(&before);
        }
        Ok((done, run.inputs.unwrap_or_default(), run.costs))
    }

    /// Moves what `written` holds of `done` past the status guard, which reads sRGB-encoded pixels.
    pub(super) fn guarded(
        &mut self,
        x: &Run<'_>,
        guard: &Guard,
        written: &[[u32; 4]],
        done: &wgpu::Texture,
    ) {
        if written.is_empty() {
            return;
        }
        let d = &x.device.device;
        let view = done.create_view(&Default::default());
        let encoded = self.take(x.device, x.size, ACC);
        let encoded_view = encoded.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        self.resolve_as(d, &mut encoder, &view, &encoded_view, ACC, x.space, true);
        x.device.queue.submit([encoder.finish()]);
        deep_gpu::spans::done_with(&encoded_view);
        let moved = self.take(x.device, x.size, ACC);
        let moved_view = moved.create_view(&Default::default());
        self.stage
            .get_or_insert_with(|| Stage::new(x.device))
            .guard_into(x.device, guard, &encoded_view, &moved_view);
        deep_gpu::spans::done_with(&moved_view);
        for rect in written {
            let mix = Mix {
                mode: REPLACE,
                decode: x.space == Space::Linear,
                straight: true,
                rect: *rect,
                ..Mix::over(&moved_view, x.size)
            };
            self.composite(x.device, done, mix, x.size);
        }
    }

    /// `--planted`: a group's passes run on the finished layer, over its bounds + grow.
    pub(super) fn late(
        &mut self,
        x: &mut Run<'_>,
        run: &[Drawn],
        k: usize,
        into: &wgpu::Texture,
    ) -> Result<(), Value> {
        let Scope::Opacity {
            item,
            effect: Some(e),
            ..
        } = &run[0].scopes[k]
        else {
            return Ok(());
        };
        let inside: Vec<Drawn> = run.iter().map(|d| without(d, k)).collect();
        let bounds = union(&inside);
        let view = into.create_view(&Default::default());
        let (passed, grow) = self.passes(x, item, e, bounds, &view)?;
        let mix = Mix {
            mode: REPLACE,
            rect: px(bounds, grow, x.size),
            ..Mix::over(&passed, x.size)
        };
        self.composite(x.device, into, mix, x.size);
        Ok(())
    }

    /// The composed layer into `view`, premultiplied and sRGB-encoded.
    pub fn finish(
        &mut self,
        device: &deep_gpu::counted::Wgpu,
        encoder: &mut wgpu::CommandEncoder,
        done: &wgpu::Texture,
        view: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        linear: bool,
    ) {
        let layer = done.create_view(&Default::default());
        let space = if linear {
            Space::Linear
        } else {
            Space::Encoded
        };
        self.resolve(device, encoder, &layer, view, format, space);
    }

    /// `layer` drawn and read back.
    pub fn picture(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        layer: &Layer<'_>,
    ) -> Result<Picture, Value> {
        let d = &device.device;
        let (done, inputs, costs) = self.compose(device, vello, layer)?;
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let out = target(d, layer.size, format);
        let view = out.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        self.finish(d, &mut encoder, &done, &view, format, layer.base.is_some());
        let image =
            deep_marks_render::gpu::read_back(d, &device.queue, encoder, &out, layer.size, format)?;
        let floats = layer
            .keep
            .then(|| f32_bytes(&read_texture(device, &done, 0).1));
        Ok(Picture {
            image,
            floats,
            inputs,
            costs,
        })
    }
}
