// Issue #338: a script panel for the shell's sidebar slot, registered under the app's registry.
import { View, div } from "gpui-kit";
import { DockArea } from "gpui-base";

class Sidebar extends View {
  render() {
    return div().size_full().p(8).child("script sidebar");
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("sidebar", Sidebar);
  }

  render() {
    return div();
  }
}
