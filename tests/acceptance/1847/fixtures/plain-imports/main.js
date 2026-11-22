// #1847 AC2: a panel that imports only @deepbuild/panel and its own files, each module named by one plain string:
// a static import, a bare import, an export from, and a dynamic import.
import { View, div } from "@deepbuild/panel";
import { label } from "./parts/label.js";
import './parts/side.js';
export { tint } from "./parts/tint.js";

export default class PlainImports extends View {
  async later() {
    return import("./parts/later.js");
  }

  render() {
    return div().size_full().p(8).child(label);
  }
}
