// The #2018 suite's replacement sidebar that is right (AC1): one row per session, in the order `sessions()` gives,
// each keyed by its session's ID, drawing its title and its state's words as given and, where the session has open
// asks, the hub's count of them in an element of its own, `session:<id>:count` (README, Pinned 1). It never draws a
// count of 0. `session.row@1` passes it. The suite sets SKIP; this view doesn't read it.
import { View, div, DockArea, v_flex, sessions } from "@deepbuild/panel";

const SKIP = [];

class SessionRows extends View {
  init() {
    this.sessions = sessions();
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .children(this.sessions.map((s) => {
        const row = div().id(`session:${s.id}`).h(24).child(`${s.title} · ${s.words}`);
        return s.asks > 0 ? row.child(div().id(`session:${s.id}:count`).child(String(s.asks))) : row;
      }));
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("session-rows", SessionRows);
    this.skip = SKIP;
  }

  render() {
    return div();
  }
}
