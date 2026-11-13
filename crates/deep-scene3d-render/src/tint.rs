//! #537: the terrain overlays on the GPU (canvas primitives: Builder plate: terrain overlays).
//! Every overlay of a frame lives in one storage buffer in the lights' group (tint.wgsl): a table
//! of each overlay's plate, size, corner, cell, opacity and roles, then each overlay's cells, a
//! byte each, read at the nearest cell and never filtered. A storage buffer, not a texture: the
//! solids' fragment stage already binds 14 of the 16 sampled textures a device need hold, and a
//! material operator's own take the rest. The store keeps each overlay's last cells by
//! `<plate>/<layer>` and writes only the runs of rows that differ; a new overlay or a new size
//! makes the buffer again and writes every row.

use std::collections::BTreeMap;

use deep_canvas_scene3d::tints::{Tint, MAX_ROLES};
use deep_gpu::counted::Written;
use deep_gpu::device::Device;

/// Its binding in the lights' group (tint.wgsl).
const BINDING: u32 = 20;
/// A table entry's words (tint.wgsl: `TINT_WORDS`).
const ENTRY: usize = 8 + MAX_ROLES;
/// The pick ID of an overlay whose plate draws no solid: no solid has it.
const NO_PICK: u32 = u32::MAX;

/// The lights group's layout entry for the overlays' buffer.
pub(crate) fn entry() -> wgpu::BindGroupLayoutEntry {
    crate::buffer_entry(
        BINDING,
        wgpu::ShaderStages::FRAGMENT,
        wgpu::BufferBindingType::Storage { read_only: true },
    )
}

/// The runs of rows, `[first, end)`, whose `cols` bytes differ between `old` and `new`; every row
/// when `old` holds another count.
pub fn rows_changed(old: &[u8], new: &[u8], cols: usize) -> Vec<[u32; 2]> {
    let rows = new.len() / cols.max(1);
    if old.len() != new.len() {
        return if rows == 0 {
            Vec::new()
        } else {
            vec![[0, rows as u32]]
        };
    }
    let mut runs: Vec<[u32; 2]> = Vec::new();
    for r in 0..rows {
        let span = r * cols..(r + 1) * cols;
        if old[span.clone()] == new[span] {
            continue;
        }
        match runs.last_mut() {
            Some(run) if run[1] == r as u32 => run[1] += 1,
            _ => runs.push([r as u32, r as u32 + 1]),
        }
    }
    runs
}

/// Words a row of `cols` cells takes.
fn stride(cols: u32) -> usize {
    cols.div_ceil(4) as usize
}

/// One overlay's place in the buffer and what was last written there.
struct Held {
    key: String,
    size: [u32; 2],
    /// The word its cells start at.
    at: usize,
    step: i64,
    cells: Vec<u8>,
}

/// Every overlay's cells and table on the GPU.
pub struct Store {
    pub buffer: wgpu::Buffer,
    held: Vec<Held>,
    table: Written,
    /// The rows this frame wrote, by `<plate>/<layer>`.
    rows: BTreeMap<String, Vec<[u32; 2]>>,
}

fn buffer(d: &deep_gpu::counted::Wgpu, words: usize) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scene3d tints"),
        size: (words.max(4) * 4) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

impl Store {
    /// No overlay: a count of 0.
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Store {
        Store {
            buffer: buffer(d, 4),
            held: Vec::new(),
            table: Written::default(),
            rows: BTreeMap::new(),
        }
    }

    /// Writes the cells of `tints` that changed since the last frame: on a new set of overlays or
    /// sizes, a new buffer with every row, and then true (the lights' group binds the new
    /// buffer). `keeps_grid_on_seek`: #537's planted store, which writes nothing for an overlay
    /// whose step is neither the one it holds nor the next, so a seek keeps the earlier grid.
    pub fn upload(&mut self, device: &Device, tints: &[Tint], keeps_grid_on_seek: bool) -> bool {
        self.rows.clear();
        let same = self.held.len() == tints.len()
            && self
                .held
                .iter()
                .zip(tints)
                .all(|(h, t)| h.key == t.key() && h.size == t.size);
        if !same {
            let mut at = 1 + tints.len() * ENTRY;
            self.held = tints
                .iter()
                .map(|t| {
                    let h = Held {
                        key: t.key(),
                        size: t.size,
                        at,
                        step: t.step,
                        cells: Vec::new(),
                    };
                    at += stride(t.size[0]) * t.size[1] as usize;
                    h
                })
                .collect();
            self.buffer = buffer(&device.device, at);
        }
        for (t, h) in tints.iter().zip(&mut self.held) {
            let seek = t.step != h.step && t.step != h.step + 1;
            h.step = t.step;
            if keeps_grid_on_seek && seek && !h.cells.is_empty() {
                continue;
            }
            let cols = t.size[0] as usize;
            let runs = rows_changed(&h.cells, &t.cells, cols);
            let words = stride(t.size[0]);
            for &[first, end] in &runs {
                let mut bytes = vec![0u8; (end - first) as usize * words * 4];
                for (k, r) in (first as usize..end as usize).enumerate() {
                    bytes[k * words * 4..k * words * 4 + cols]
                        .copy_from_slice(&t.cells[r * cols..(r + 1) * cols]);
                }
                let offset = ((h.at + first as usize * words) * 4) as u64;
                deep_gpu::alloc::outside(|| {
                    device.queue.write_buffer(&self.buffer, offset, &bytes)
                });
            }
            h.cells.clone_from(&t.cells);
            if !runs.is_empty() {
                self.rows.insert(h.key.clone(), runs);
            }
        }
        !same
    }

    /// Writes the table of `tints` (as [`Store::upload`] last took them), each plate by its
    /// solid's pick ID in `picks`, and hands over the rows this frame wrote.
    pub fn table(
        &mut self,
        device: &Device,
        tints: &[Tint],
        picks: &BTreeMap<String, u32>,
    ) -> BTreeMap<String, Vec<[u32; 2]>> {
        let mut words = vec![tints.len() as u32];
        for (t, h) in tints.iter().zip(&self.held) {
            words.push(picks.get(&t.plate).copied().unwrap_or(NO_PICK));
            words.extend([t.size[0], t.size[1], h.at as u32]);
            let place = [t.origin[0], t.origin[1], t.cell, t.opacity];
            words.extend(place.map(|x| (x as f32).to_bits()));
            words.extend(
                (0..MAX_ROLES).map(|j| match t.roles.get(j).copied().flatten() {
                    Some(c) => u32::from_le_bytes([c[0], c[1], c[2], 255]),
                    None => 0,
                }),
            );
        }
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_changed(&self.buffer, &self.table, bytemuck::cast_slice(&words))
        });
        std::mem::take(&mut self.rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_gpu::device::{Backend, Gpu};

    /// A 128 × 128 grid, every cell 0.
    fn grid() -> Vec<u8> {
        vec![0; 128 * 128]
    }

    /// One cell, a 9 × 9 square centred on cell (64, 64) and no change: only the rows that
    /// changed, never the whole grid.
    #[test]
    fn only_the_rows_that_changed_are_written() {
        let mut one = grid();
        one[40 * 128 + 7] = 2;
        assert_eq!(rows_changed(&grid(), &one, 128), vec![[40, 41]]);
        let mut square = grid();
        for z in 60..69 {
            for x in 60..69 {
                square[z * 128 + x] = 2;
            }
        }
        assert_eq!(rows_changed(&grid(), &square, 128), vec![[60, 69]]);
        assert_eq!(rows_changed(&square, &square, 128), Vec::<[u32; 2]>::new());
        let mut two = square.clone();
        two[100 * 128] = 1;
        assert_eq!(rows_changed(&square, &two, 128), vec![[100, 101]]);
        // A store that holds nothing yet writes every row.
        assert_eq!(rows_changed(&[], &square, 128), vec![[0, 128]]);
    }

    fn tint(step: i64, cells: Vec<u8>) -> Tint {
        Tint {
            plate: "ground".into(),
            layer: 0,
            step,
            size: [128, 128],
            origin: [-64.0, -64.0],
            cell: 1.0,
            opacity: 1.0,
            roles: vec![Some([200, 204, 214]), Some([60, 64, 80]), None],
            cells,
        }
    }

    /// Playing writes each step's changed rows; a seek writes what differs from the grid it
    /// holds, and #537's planted store writes nothing on a seek, keeping the earlier grid.
    #[test]
    fn a_seek_writes_the_grid_it_reaches_and_the_planted_store_keeps_the_old_one() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let mut square = grid();
        for z in 60..69 {
            for x in 60..69 {
                square[z * 128 + x] = 2;
            }
        }
        let mut moved = grid();
        moved[10 * 128 + 5] = 1;
        let picks = BTreeMap::from([("ground".to_string(), 7)]);
        let none: Vec<[u32; 2]> = Vec::new();
        for planted in [false, true] {
            let mut store = Store::new(&device.device);
            let mut frame = |step, cells: &[u8]| {
                let tints = [tint(step, cells.to_vec())];
                let made = store.upload(&device, &tints, planted);
                let rows = store.table(&device, &tints, &picks);
                (made, rows.get("ground/0").cloned().unwrap_or_default())
            };
            assert_eq!(frame(0, &grid()), (true, vec![[0, 128]]));
            assert_eq!(frame(1, &square), (false, vec![[60, 69]]));
            assert_eq!(frame(1, &square), (false, none.clone()));
            // A seek to step 40, whose grid moved one cell and cleared the square.
            let seek = frame(40, &moved).1;
            if planted {
                assert_eq!(seek, none, "the planted store keeps the grid it held");
            } else {
                assert_eq!(seek, vec![[10, 11], [60, 69]]);
            }
        }
    }

    /// The renderer takes a terrain plate's overlay with no validation error, writing every row
    /// at its first frame and then only the row a step changed.
    #[test]
    fn a_frame_writes_only_the_rows_its_step_changed() {
        use deep_canvas_scene3d::look::Look3;
        use deep_canvas_scene3d::scene::{evaluate, Labels};
        use serde_json::json;
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let look = Look3::read(
            &json!({"roles": {"accent": "#1aa3c8", "fog": "#c8ccd6", "ground": "#000000"}}),
        )
        .unwrap();
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [64, 64], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 0, "elevation": 80, "distance": 12}, "fov": 40}},
                "ground": {"id": "ground", "kind": "plate@1", "name": "G", "order": "a1", "layer": "main", "params": {
                    "terrain": {"height": 0, "size": [8, 8]}, "paint": {"fill": {"role": "accent"}},
                    "overlays": [{"grid": "rules.fog", "size": [8, 8], "roles": ["fog", "none"]}]}},
            },
            "arrays": {"rules.fog": {"type": "i32", "count": 64, "every": 10, "linear": false,
                "steps": [{"step": 1, "changed": [[27, 28]], "values": [[27, [1]]]}]}},
        });
        let mut renderer = crate::Renderer::new(&device, crate::Planted::default());
        let mut labels = Labels::new();
        let mut rows = Vec::new();
        for t in [0, 10, 15] {
            let scene = evaluate(&doc, t, &look, &mut labels).unwrap();
            renderer.prepare(&device, &scene, &look);
            rows.push(renderer.counts().overlay_rows.clone());
        }
        let written = |run: Vec<[u32; 2]>| BTreeMap::from([("ground/0".to_string(), run)]);
        assert_eq!(
            rows,
            vec![
                written(vec![[0, 8]]),
                written(vec![[3, 4]]),
                BTreeMap::new()
            ]
        );
        let raised = device.take_raised();
        assert!(raised.is_empty(), "the device raised: {raised:?}");
    }
}
