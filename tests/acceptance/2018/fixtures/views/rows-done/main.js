// The #2018 suite's wrong replacement sidebar (AC1): as rows-right, but a row whose state's words hold "says done", a
// stop with no verdict yet, reads "done" in their place. A row whose id is in SKIP is drawn right; the suite fills SKIP
// with the rows the kit named, to hold the kit to naming the row that is wrong. `session.row@1` fails it, naming the row.
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
        const words = SKIP.includes(id) ? s.words : s.words.replace("says done", "done");
        const row = div().id(id).h(24).child(`${s.title} · ${words}`);
        return s.asks > 0 ? row.child(div().id(`${id}:count`).child(String(s.asks))) : row;
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
