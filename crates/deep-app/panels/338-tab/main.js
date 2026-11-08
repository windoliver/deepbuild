// Issue #338: a script panel for a tab beside the shell's center view, registered under the
// app's registry.
import { View, div, DockArea } from "@deepbuild/panel";

class Tab extends View {
  render() {
    return div().size_full().p(8).child("script tab");
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("tab", Tab);
  }

  render() {
    return div();
  }
}
