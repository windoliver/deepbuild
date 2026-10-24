// The #377 plug-in fixture's panel, blind redraft (A6-REDRAFT.md). A plug-in panel script, loaded as a
// plug-in's panel in the app's panel runtime, that tries to reach the GPU or the window's drawing
// surface from everything a panel script can name: every global, `navigator.gpu`, and every export
// of the runtime's modules and DeepBuild's module. It draws one line of text per finding, so the
// test reads what it reached from the text the panel drew:
//   found:<where>:<name>   a global or an export whose name is a GPU or drawing-surface word
//   found:navigator.gpu    WebGPU's entry point exists
//   <where>:checked        that place was searched
//   probe:done             the probe ran to its end
//
// The one change from the first draft: gpui-shell's own runtime bridge. The runtime installs two
// globals every panel script's elements go through, `__gpui` (the element prelude the gpui-kit and
// gpui-base modules re-export from) and `__gpui_components` (the component registry's calls, which
// the gpui-component module's constructors go through). "gpui" holds the letters "gpu", but these
// are the UI toolkit, not a GPU or surface handle. They are named exactly here and not skipped:
// their own members are searched with the same words instead, as `global:<bridge>.<member>`, so a
// GPU or surface route hung on the bridge is still found. No other name is exempt.
import * as kit from "gpui-kit";
import * as base from "gpui-base";
import * as component from "gpui-component";
import * as deepbuild from "deepbuild";
import { View, div } from "gpui-kit";

const WORDS = /gpu|wgpu|metal|iosurface|surface|texture|drawable|framebuffer|swapchain/i;
const BRIDGE = ["__gpui", "__gpui_components"];

function probe() {
  const lines = [];
  const look = (where, names) => {
    for (const name of names) if (WORDS.test(name)) lines.push(`found:${where}:${name}`);
    lines.push(`${where}:checked`);
  };
  const globals = Object.getOwnPropertyNames(globalThis);
  look("global", globals.filter((name) => !BRIDGE.includes(name)));
  for (const name of BRIDGE) {
    const bridge = globals.includes(name) ? globalThis[name] : undefined;
    if ((typeof bridge === "object" || typeof bridge === "function") && bridge !== null) {
      for (const member of Object.getOwnPropertyNames(bridge)) {
        if (WORDS.test(member)) lines.push(`found:global:${name}.${member}`);
      }
      lines.push(`bridge:${name}:checked`);
    }
  }
  const nav = globalThis.navigator;
  lines.push(nav !== undefined && nav !== null && nav.gpu !== undefined ? "found:navigator.gpu" : "navigator.gpu:absent");
  const modules = [["gpui-kit", kit], ["gpui-base", base], ["gpui-component", component], ["deepbuild", deepbuild]];
  for (const [name, namespace] of modules) look(`module:${name}`, Object.keys(namespace));
  lines.push("probe:done");
  return lines;
}

export default class GpuProbe extends View {
  init() {
    this.lines = probe();
  }

  render() {
    let column = div().size_full().p(8);
    for (const line of this.lines) column = column.child(div().child(line));
    return column;
  }
}
