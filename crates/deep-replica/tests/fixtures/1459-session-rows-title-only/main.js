// Issue #1459, a planted fault for `session.row@1`: each row draws its title alone, as `plant-row-title-only` names a
// sidebar row. The kit names the first session whose row draws no state words.
import { View, div, DockArea, v_flex, sessions } from "@deepbuild/panel";

class SessionRows extends View {
  init() {
    this.sessions = sessions();
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .children(this.sessions.map((s) => div().id(`session:${s.id}`).h(24).child(s.title)));
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("session-rows", SessionRows);
  }

  render() {
    return div();
  }
}
