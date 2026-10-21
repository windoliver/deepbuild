// Issue #338: a script panel for the shell's home slot, registered under the app's registry.
import { View, div } from "gpui-kit";
import { DockArea } from "gpui-base";

class Home extends View {
  render() {
    return div().size_full().p(8).child("script home");
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("home", Home);
  }

  render() {
    return div();
  }
}
