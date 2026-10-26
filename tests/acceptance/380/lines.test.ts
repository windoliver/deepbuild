// #380.3893743e: DeepBuild's lines are drawn only with the canvas's primitives and effects, with no
// view-specific GPU code.
// "DeepBuild's lines" are the app's own line views (technical design, Canvas: "every session's line … draw
// through it"; "DeepBuild's own lines use it"), which live in the app's views, the `deep-app` crate. Read
// as two checks on the checkout (README: Readings):
// - no view-specific GPU code: `deep-app` depends on no GPU API crate directly (only on the GPU layer,
//   `deep-gpu`), and none of its files holds shader text, a shader file or a GPU API call;
// - only the canvas's primitives and effects: no app view paints a path, quad or sprite of its own with
//   GPUI's low-level paint calls; what a view draws comes from the canvas's crates (marks, text, the GPU
//   layer's surface).
// Each check's own twin (a GPU crate planted under deep-app; a planted shader module call; a planted
// view that paints its own line) fails it, naming what it found. At the base the app's session line is a
// polyline the view paints itself (crates/deep-app/src/canvas.rs: PathBuilder and paint_path).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, cargoMetadata, type Package } from './helpers.ts';

const APP = 'deep-app';
const APP_DIR = join(REPO, 'crates', APP);
/** GPU API crates a view must not depend on directly; the GPU layer (`deep-gpu`) is the app's one route. */
const GPU_CRATES = ['wgpu', 'wgpu-core', 'wgpu-hal', 'naga', 'metal', 'objc2-metal', 'ash', 'glow', 'd3d12', 'gpu-allocator', 'wgpu-profiler'];
/** Shader text and GPU API calls, by the tokens that only GPU code writes. */
const GPU_CODE = /\bwgpu::|\bnaga::|create_shader_module|ShaderSource|create_render_pipeline|create_compute_pipeline|@fragment|@vertex|@compute|MTLCreateSystemDefaultDevice|newRenderPipelineState|objc2_metal|\bmetal::/;
const SHADER_FILE = /\.(wgsl|metal|glsl|hlsl|spv|vert|frag|comp)$/;
/** GPUI's low-level paint calls: a view that uses one draws something of its own instead of the canvas's primitives. */
const OWN_PAINT = /\bpaint_path\b|\bpaint_quad\b|\bpaint_sprite\b|\bpaint_polychrome_sprite\b|\bPathBuilder\b|\bpaint_shadows?\b|\bpaint_underline\b|\bpaint_strikethrough\b/;

interface File { path: string; text: string }
function appFiles(): File[] {
  const files: File[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === 'target' || name === 'node_modules') continue;
      if (statSync(path).isDirectory()) walk(path);
      else files.push({ path: relative(REPO, path), text: /\.(png|ttf|otf|icns|ico)$/.test(name) ? '' : readFileSync(path, 'utf8') });
    }
  };
  walk(APP_DIR);
  return files;
}
/** Lines that aren't comments, so a sentence about GPU code doesn't count as GPU code. */
const code = (text: string): string[] => text.split('\n').map((l) => l.replace(/\/\/.*$/, '')).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('*') && !l.startsWith('#'));

function gpuDepProblems(pkg: Package): string[] {
  return pkg.deps.filter((d) => d.kind === null && GPU_CRATES.includes(d.name)).map((d) => `${pkg.name} depends on the GPU API crate ${d.name} directly, not through the GPU layer`);
}
function gpuCodeProblems(files: File[]): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (SHADER_FILE.test(f.path)) { problems.push(`${f.path} is a shader file in the app's views`); continue; }
    const hit = code(f.text).find((l) => GPU_CODE.test(l));
    if (hit) problems.push(`${f.path} holds GPU code: ${hit.slice(0, 160)}`);
  }
  return problems;
}
function ownPaintProblems(files: File[]): string[] {
  const problems: string[] = [];
  for (const f of files.filter((x) => x.path.endsWith('.rs') || x.path.endsWith('.js') || x.path.endsWith('.ts'))) {
    const hit = code(f.text).find((l) => OWN_PAINT.test(l));
    if (hit) problems.push(`${f.path} paints with GPUI's own call ${OWN_PAINT.exec(hit)![0]} instead of the canvas's primitives: ${hit.slice(0, 160)}`);
  }
  return problems;
}

describe('#380.3893743e DeepBuild\'s lines are drawn only with the canvas\'s primitives and effects, with no view-specific GPU code', () => {
  it('#380.3893743e the app\'s views hold no GPU code of their own: deep-app reaches the GPU only through the GPU layer, and no file of it holds shader text or a GPU API call; the check fails a planted GPU crate and a planted shader module, naming each', () => {
    const meta = cargoMetadata();
    const app = meta.packages.find((p) => p.name === APP && meta.members.has(p.id));
    expect(app, `the workspace has the app's crate ${APP}`).toBeDefined();
    const files = appFiles();
    expect(files.some((f) => f.path.endsWith('views.rs')), 'the scan reads the app\'s views').toBe(true);
    expect(gpuDepProblems(app!), 'the app\'s direct dependencies').toEqual([]);
    expect(gpuCodeProblems(files), 'GPU code in the app\'s views').toEqual([]);
    // The check's own twins.
    const planted: Package = { ...app!, deps: [...app!.deps, { name: 'wgpu', kind: null }] };
    expect(gpuDepProblems(planted).join('\n'), 'a wgpu dependency planted under deep-app fails, named').toMatch(/deep-app depends on the GPU API crate wgpu/);
    const twin = [...files, { path: 'crates/deep-app/src/line_glow.rs', text: 'fn glow(d: &wgpu::Device) {\n  let m = d.create_shader_module(desc);\n}\n' }];
    expect(gpuCodeProblems(twin).join('\n'), 'a view with its own shader module fails, named').toMatch(/crates\/deep-app\/src\/line_glow\.rs holds GPU code/);
    expect(gpuCodeProblems([...files, { path: 'crates/deep-app/src/line.wgsl', text: '@fragment fn main() {}' }]).join('\n'), 'a shader file in the views fails, named').toMatch(/line\.wgsl is a shader file/);
  }, 600_000);

  it('#380.3893743e DeepBuild\'s line is drawn with the canvas\'s primitives: no app view paints a path, quad or sprite of its own; the check fails a planted view that paints its own line, naming the file and the call', () => {
    const files = appFiles();
    expect(files.filter((f) => f.path.endsWith('.rs')).length, 'the scan reads the app\'s Rust sources').toBeGreaterThan(3);
    expect(ownPaintProblems(files), 'views that paint their own lines, quads or sprites').toEqual([]);
    const twin = [...files, { path: 'crates/deep-app/src/sidebar_line.rs', text: 'fn draw(w: &mut Window) {\n  let mut p = PathBuilder::stroke(px(2.));\n  w.paint_path(p.build().unwrap(), color);\n}\n' }];
    expect(ownPaintProblems(twin).join('\n'), 'a planted view that paints its own line fails, naming the file and the call').toMatch(/crates\/deep-app\/src\/sidebar_line\.rs paints with GPUI's own call PathBuilder/);
  }, 600_000);
});
