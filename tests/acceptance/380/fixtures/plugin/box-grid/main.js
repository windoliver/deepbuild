// The #380 plug-in fixture's panel: a plug-in panel script, loaded in the app's panel runtime, whose
// plug-in describes a 3D scene (documents.json) that the host draws in the panel's canvas view. The
// script itself tries to open a GPU device from the panel, through WebGPU's entry point, the one route a
// script could name, and draws one line of text saying how it went, so the test reads it from the text
// the panel drew, one short line in the panel's header strip (so nothing it draws reaches the canvas view
// below it):
//   device-call:navigator.gpu.requestAdapter:failed:<message, cut to 24 characters> probe:done
//   device-call:navigator.gpu.requestAdapter:returned probe:done
// "failed" is the call throwing or there being no entry point; "returned" is the call giving something back;
// "probe:done" is the script running to its end. Its plug-in's other try, the request on its writer
// connection to open a device, is in documents.json.
import { View, div } from "gpui-kit";

function tryDevice() {
  const name = "navigator.gpu.requestAdapter";
  try {
    const result = globalThis.navigator.gpu.requestAdapter();
    return result === undefined || result === null ? `device-call:${name}:failed:returned nothing` : `device-call:${name}:returned`;
  } catch (e) {
    return `device-call:${name}:failed:${String(e && e.message ? e.message : e).slice(0, 24)}`;
  }
}

export default class BoxGrid extends View {
  init() {
    this.line = `${tryDevice()} probe:done`;
  }

  render() {
    return div().size_full().px(6).child(this.line);
  }
}
