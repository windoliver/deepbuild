// Issue #338: the canvas mounted from a script through the app's component registry. The scene
// is retained state the script keeps across renders; the Canvas draws its items.
import { View, div } from "gpui-kit";
import { DockArea } from "gpui-base";
import { Canvas, CanvasScene } from "gpui-component";

class CanvasPanel extends View {
  init() {
    this.scene = CanvasScene();
    this.scene.set("script-line", [3, 1, 4, 1, 5]);
  }

  render() {
    return div()
      .size_full()
      .p(8)
      .child(new Canvas(this.scene).w(600).h(200));
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("canvas", CanvasPanel);
  }

  render() {
    return div();
  }
}
