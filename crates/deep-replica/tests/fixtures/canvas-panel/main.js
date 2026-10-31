// A panel that draws one canvas item, "script-line", on a 200 by 100 point canvas, for tests/drive.rs.
import { View, div } from "gpui-kit";
import { Canvas, CanvasScene } from "gpui-component";

export default class Panel extends View {
  init() {
    this.scene = CanvasScene();
    this.scene.set("script-line", [3, 1, 4, 1, 5]);
  }
  render() {
    return div().size_full().p(8).child(new Canvas(this.scene).w(200).h(100));
  }
}
