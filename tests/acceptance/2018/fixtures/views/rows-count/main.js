// The #2018 suite's wrong replacement sidebar (AC1): as rows-right, but every row shows a count one more than the
// hub's count of its session's open asks, a row with none showing 1. A row whose id is in SKIP is drawn right; the
// suite fills SKIP with the rows the kit named, to hold the kit to naming the row that is wrong. `session.row@1` fails
// it, naming the row.
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
        const id = `session:${s.id}`;
        const hubs = typeof s.asks === "number" ? s.asks : 0;
        const shown = SKIP.includes(id) ? hubs : hubs + 1;
        const row = div().id(id).h(24).child(`${s.title} · ${s.words}`);
        return shown > 0 ? row.child(div().id(`${id}:count`).child(String(shown))) : row;
      }));
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
