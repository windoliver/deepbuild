// Issue #1459, a planted fault for `session.row@1`: rows keyed by their place, as `plant-row-index-ids` keys Needs you
// rows. A row moves when one above it goes, so the kit names the first session with no row in its place.
import { View, div, DockArea, v_flex, sessions } from "@deepbuild/panel";

class SessionRows extends View {
  init() {
    this.sessions = sessions();
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .children(this.sessions.map((s, index) => div().id(`row-${index}`).h(24).child(`${s.title} · ${s.words}`)));
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
