// Issue #338: a script panel for the shell's line slot, registered under the app's registry.
import { View, div } from "gpui-kit";
import { DockArea } from "gpui-base";

class Line extends View {
  render() {
    return div().size_full().p(8).child("script line");
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("line", Line);
  }

  render() {
    return div();
  }
}
