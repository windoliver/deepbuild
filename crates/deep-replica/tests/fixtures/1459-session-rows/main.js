// Issue #1459, the fixture view for `session.row@1`: the sidebar's session rows written against the registry, one per
// session in the sidebar's order. Each row is keyed by its session's ID and draws its title and its state's words,
// never the ID. The kit passes it.
import { View, div, DockArea, v_flex, sessions } from "@deepbuild/panel";

class SessionRows extends View {
  init() {
    this.sessions = sessions();
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .children(this.sessions.map((s) => div().id(`session:${s.id}`).h(24).child(`${s.title} · ${s.words}`)));
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
