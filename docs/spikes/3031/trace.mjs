// What a run's API trace says its frames did: every texture and buffer the device was asked for, and each frame's
// passes in the order the device got them, each with everything it binds (an attachment, a resolve target, what a bind
// group it sets or a bundle it runs holds, its vertex, index and indirect buffers, a copy's source and destination)
// and the draws it issues. Read from wgpu-core's `trace.ron`, which the device writes itself; a buffer the harness
// names `spike3031 frame <k>` marks where frame k starts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { actions, parse } from './ron.mjs';

const pointer = (v) => (v && typeof v === 'object' && v.$ === 'PointerId' ? v._[0] : null);
const name = (v) => (v === null || v === undefined ? '' : (typeof v === 'string' ? v : (v.$ ?? ''))).toLowerCase().replaceAll('-', '').replaceAll('_', '');
const MARK = /^spike3031 frame (\d+)$/;

const TEXTURE_USAGES = [[1, 'COPY_SRC'], [2, 'COPY_DST'], [4, 'TEXTURE_BINDING'], [8, 'STORAGE_BINDING'], [16, 'RENDER_ATTACHMENT']];
const BUFFER_USAGES = [[1, 'MAP_READ'], [2, 'MAP_WRITE'], [4, 'COPY_SRC'], [8, 'COPY_DST'], [16, 'INDEX'], [32, 'VERTEX'], [64, 'UNIFORM'], [128, 'STORAGE'], [256, 'INDIRECT'], [512, 'QUERY_RESOLVE']];
/** A usage as the layer spells it, as a sorted list of names: the trace writes the names joined by ` | `. */
function usages(v, table) {
  if (typeof v === 'string') return v.split('|').map((s) => s.trim()).filter(Boolean).sort();
  const bits = typeof v === 'number' ? v : (v?.bits ?? v?._?.[0]);
  if (typeof bits !== 'number') throw Error(`trace: a usage the reader doesn't know: ${JSON.stringify(v)}`);
  const named = table.filter(([bit]) => bits & bit);
  const rest = bits & ~named.reduce((s, [bit]) => s | bit, 0);
  return [...named.map(([, n]) => n), ...(rest ? [`BITS_${rest}`] : [])].sort();
}

/** A binding's access by its layout entry: what a pass that sets the group may do to what is bound there. */
function access(ty) {
  if (!ty || typeof ty !== 'object') return 'read';
  if (ty.$ === 'StorageTexture') return { writeonly: 'write', readonly: 'read' }[name(ty.access)] ?? 'readwrite';
  if (ty.$ === 'Buffer' && typeof ty.ty === 'object' && ty.ty?.$ === 'Storage') return ty.ty.read_only === true ? 'read' : 'readwrite';
  return 'read';
}
const merge = (a, b) => (a === undefined || a === b ? b : 'readwrite');

/** What a shader's source declares at each `group:binding`: read, write or readwrite. */
function declared(wgsl) {
  const out = new Map();
  for (const [, group, binding, qualifier, type] of wgsl.matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)\s*var\s*(<[^>]*>)?\s*\w+\s*:\s*([^;]+);/g)) {
    const stored = /^texture_storage_\w+<[^,>]+,\s*(\w+)\s*>/.exec(type.trim());
    const how = stored ? { write: 'write', read: 'read' }[stored[1]] ?? 'readwrite' : (qualifier ?? '').includes('read_write') ? 'readwrite' : 'read';
    out.set(`${group}:${binding}`, how);
  }
  return out;
}

/**
 * The trace at `path` as `{init, resources, frames, counts, failed}`. `resources` holds every texture (`t<n>`) and
 * buffer (`b<n>`) the device was asked for, in the order asked, with what its descriptor said, the frame it was made
 * in and its place among the trace's actions when it was made and let go (`lastSubmit` is the last submission's). `frames[k].passes` are frame k's passes, each `{kind, name, touches, draws}` with
 * `touches: [{id, how, reads, writes}]` and `draws: [{pipeline, depth_write, indices, instances, first, indirect, bundle}]`.
 */
export function readTrace(path) {
  const resources = [];
  const made = { t: 0, b: 0 };
  const texture = new Map();
  const buffer = new Map();
  const view = new Map();
  const layouts = new Map();
  const groups = new Map();
  const bundles = new Map();
  const pipes = new Map();
  const shaders = new Map();
  const folder = dirname(path);
  let ordinal = 0;
  let lastSubmit = -1;
  const counts = {};
  const failed = [];
  const frames = [];
  let init = null;
  let current = { frame: -1, passes: [] };

  function touch(touches, r, how, reads, writes) {
    if (!r) return;
    const t = touches.get(r.id) ?? { id: r.id, how: [], reads: false, writes: false };
    if (!t.how.includes(how)) t.how.push(how);
    t.reads ||= reads;
    t.writes ||= writes;
    touches.set(r.id, t);
  }
  // What a list of pass commands binds, into `touches`, and the draws it issues, into `draws`.
  const walk = (commands, touches, draws, bundle) => {
    let pipe = null;
    for (const c of commands ?? []) {
      const kind = typeof c === 'string' ? c : c.$;
      if (kind === 'SetPipeline') pipe = pipes.get(pointer(c._[0])) ?? { label: null };
      else if (kind === 'SetBindGroup') {
        for (const [r, how] of groups.get(pointer(c.bind_group))?.held ?? []) touch(touches, r, 'bind group', how !== 'write', how !== 'read');
      } else if (kind === 'SetVertexBuffer') touch(touches, buffer.get(pointer(c.buffer)), 'vertex buffer', true, false);
      else if (kind === 'SetIndexBuffer') touch(touches, buffer.get(pointer(c.buffer)), 'index buffer', true, false);
      else if (kind === 'ExecuteBundle') {
        const b = bundles.get(pointer(c._[0]));
        walk(b?.commands, touches, draws, b?.label ?? '');
      } else if (kind === 'Draw' || kind === 'DrawIndexed') {
        draws.push({ pipeline: pipe?.label ?? null, depth_write: pipe?.depth_write ?? false, cull: pipe?.cull ?? null, indexed: kind === 'DrawIndexed', indices: c.index_count ?? c.vertex_count, instances: c.instance_count, first: c.first_instance ?? 0, indirect: false, bundle });
      } else if (kind === 'DrawIndirect' || kind === 'MultiDrawIndirectCount') {
        touch(touches, buffer.get(pointer(c.buffer)), 'indirect buffer', true, false);
        if (c.count_buffer) touch(touches, buffer.get(pointer(c.count_buffer)), 'indirect buffer', true, false);
        draws.push({ pipeline: pipe?.label ?? null, depth_write: pipe?.depth_write ?? false, cull: pipe?.cull ?? null, indexed: name(c.family).includes('indexed'), indices: null, instances: null, first: null, indirect: true, count: c.count ?? c.max_count ?? 1, bundle });
      } else if (kind === 'DispatchWorkgroupsIndirect') touch(touches, buffer.get(pointer(c.buffer)), 'indirect buffer', true, false);
    }
  };
  const pass = (kind, label, fill) => {
    const touches = new Map();
    const draws = [];
    fill(touches, draws);
    current.passes.push({ kind, name: label, touches: [...touches.values()], draws });
  };

  for (const text of actions(path)) {
    const a = parse(text);
    const kind = typeof a === 'string' ? a : a.$;
    ordinal++;
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (kind === 'Init') init = { label: a.desc?.label ?? null, backend: a.backend };
    else if (kind === 'CreateBuffer') {
      const d = a._[1];
      const m = MARK.exec(d.label ?? '');
      if (m) {
        frames.push((current = { frame: Number(m[1]), passes: [] }));
        continue;
      }
      const r = { id: `b${made.b++}`, kind: 'buffer', label: d.label ?? '', size: [d.size], format: null, usage: usages(d.usage, BUFFER_USAGES), made_in: current.frame, made_at: ordinal, dropped_at: null };
      buffer.set(pointer(a._[0]), r);
      resources.push(r);
    } else if (kind === 'CreateTexture') {
      const d = a._[1];
      const r = {
        id: `t${made.t++}`, kind: 'texture', label: d.label ?? '', size: [d.size.width, d.size.height, d.size.depthOrArrayLayers ?? d.size.depth_or_array_layers],
        mips: d.mip_level_count, samples: d.sample_count, dimension: d.dimension, format: d.format, usage: usages(d.usage, TEXTURE_USAGES),
        made_in: current.frame, made_at: ordinal, dropped_at: null,
      };
      texture.set(pointer(a._[0]), r);
      resources.push(r);
    } else if (kind === 'DropTexture' || kind === 'DestroyTexture' || kind === 'DropBuffer' || kind === 'DestroyBuffer') {
      const r = (kind.endsWith('Texture') ? texture : buffer).get(pointer(a._[0]));
      if (r && r.dropped_at === null) r.dropped_at = ordinal;
    } else if (kind === 'CreateTextureView') {
      // A view of one layer or one mip: a pass that writes through it leaves the rest of the texture as it was.
      const r = texture.get(pointer(a.parent));
      const range = a.desc?.range ?? {};
      const part = (base, count, all) => (base ?? 0) !== 0 || (count !== null && count !== undefined && count !== all);
      const layers = r && r.dimension !== '3d' ? r.size[2] : 1;
      view.set(pointer(a.id), r && { r, part: part(range.baseMipLevel, range.mipLevelCount, r.mips) || part(range.baseArrayLayer, range.arrayLayerCount, layers) });
    }
    else if (kind === 'CreateBindGroupLayout') layouts.set(pointer(a._[0]), new Map((a._[1].entries ?? []).map((e) => [e.binding, access(e.ty)])));
    else if (kind === 'CreateShaderModule') {
      const file = a.data?.$ === 'File' ? a.data._[0] : null;
      shaders.set(pointer(a.id), file?.endsWith('.wgsl') ? declared(readFileSync(join(folder, file), 'utf8')) : new Map());
    } else if (kind === 'GetRenderPipelineBindGroupLayout' || kind === 'GetComputePipelineBindGroupLayout') {
      // A layout taken from a pipeline: its bindings are what the pipeline's shaders declare in that group.
      const taken = new Map();
      for (const m of pipes.get(pointer(a.pipeline))?.modules ?? []) {
        for (const [at, how] of shaders.get(m) ?? []) if (at.startsWith(`${a.index}:`)) taken.set(Number(at.split(':')[1]), how);
      }
      layouts.set(pointer(a.id), taken);
    }
    else if (kind === 'CreateBindGroup') {
      const d = a._[1];
      const layout = layouts.get(pointer(d.layout));
      const held = new Map();
      for (const e of d.entries ?? []) {
        const r = e.resource;
        const bound = r?.$ === 'TextureView' ? [view.get(pointer(r._[0]))?.r]
          : r?.$ === 'TextureViewArray' ? r._[0].map((v) => view.get(pointer(v))?.r)
            : r?.$ === 'Buffer' ? [buffer.get(pointer(r._[0]?.buffer))]
              : r?.$ === 'BufferArray' ? r._[0].map((b) => buffer.get(pointer(b?.buffer))) : [];
        const partial = r?.$ === 'TextureView' && view.get(pointer(r._[0]))?.part;
        for (const x of bound) {
          if (!x) continue;
          const how = layout?.get(e.binding) ?? 'read';
          held.set(x, merge(held.get(x), partial && how === 'write' ? 'readwrite' : how));
        }
      }
      groups.set(pointer(a._[0]), { label: d.label ?? '', held });
    } else if (kind === 'CreateRenderBundle') bundles.set(pointer(a.id), { label: a.base?.label ?? a.desc?.label ?? '', commands: a.base?.commands ?? [] });
    else if (kind === 'CreateGeneralRenderPipeline') {
      const ds = a.desc.depth_stencil;
      const modules = [a.desc.vertex?._?.[0]?.stage?.module ?? a.desc.vertex?.stage?.module, a.desc.fragment?.stage?.module].map(pointer).filter((m) => m !== null);
      pipes.set(pointer(a.id), { label: a.desc.label ?? null, depth_write: ds?.depth_write_enabled === true, depth_compare: ds ? name(ds.depth_compare) : null, cull: a.desc.primitive?.cullMode ?? a.desc.primitive?.cull_mode ?? null, modules });
    } else if (kind === 'CreateComputePipeline') pipes.set(pointer(a.id), { label: a.desc?.label ?? null, depth_write: false, modules: [pointer(a.desc?.stage?.module)] });
    else if (kind === 'FailedCommands') failed.push({ frame: current.frame, error: a.error });
    else if (kind === 'Submit') {
      lastSubmit = ordinal;
      for (const c of a._[1] ?? []) {
        const what = typeof c === 'string' ? c : c.$;
        if (what === 'RunRenderPass') {
          pass('render', c.pass?.label || 'render pass', (touches, draws) => {
            for (const at of c.color_attachments ?? []) {
              if (!at) continue;
              const to = view.get(pointer(at.view));
              touch(touches, to?.r, 'color attachment', name(at.load_op) === 'load' || Boolean(to?.part), true);
              const into = at.resolve_target ? view.get(pointer(at.resolve_target)) : null;
              if (into) touch(touches, into.r, 'resolve target', into.part, true);
            }
            const ds = c.depth_stencil_attachment;
            if (ds) {
              // `depth` is `Operational((load, store))`, or `ReadOnly`.
              const ops = typeof ds.depth === 'object' ? (ds.depth?._?.[0] ?? ds.depth) : null;
              const only = ops === null;
              const to = view.get(pointer(ds.view));
              touch(touches, to?.r, only ? 'depth attachment, read only' : 'depth attachment', only || name(ops.load ?? ops.load_op) === 'load' || Boolean(to?.part), !only);
            }
            walk(c.pass?.commands, touches, draws, null);
          });
        } else if (what === 'RunComputePass') pass('compute', c.pass?.label || 'compute pass', (touches, draws) => walk(c.pass?.commands, touches, draws, null));
        else if (what === 'CopyTextureToTexture' || what === 'CopyTextureToBuffer' || what === 'CopyBufferToTexture' || what === 'CopyBufferToBuffer') {
          pass('copy', 'copy', (touches) => {
            touch(touches, texture.get(pointer(c.src?.texture)) ?? buffer.get(pointer(c.src?.buffer ?? c.src)), 'copy source', true, false);
            const dst = texture.get(pointer(c.dst?.texture));
            const whole = dst && dst.mips === 1 && c.size?.width === dst.size[0] && c.size?.height === dst.size[1] && (c.size?.depthOrArrayLayers ?? 1) === dst.size[2];
            touch(touches, dst ?? buffer.get(pointer(c.dst?.buffer ?? c.dst)), 'copy destination', Boolean(dst) && !whole, true);
          });
        } else if (what === 'ClearTexture' || what === 'ClearBuffer') {
          pass('copy', 'clear', (touches) => touch(touches, texture.get(pointer(c.dst)) ?? buffer.get(pointer(c.dst)), 'clear', false, true));
        } else if (what === 'ResolveQuerySet') {
          pass('copy', 'resolve query set', (touches) => touch(touches, buffer.get(pointer(c.destination)), 'query destination', false, true));
        }
      }
    }
  }
  return { init, resources, frames, counts, failed, lastSubmit };
}
