// DeepBuild's Menu (#1470), served inside @deepbuild/panel: a trigger and a list of rows drawn inside the panel, so
// it can't cover the question card. A press on the trigger opens it; if the press is still held and has moved past
// 3 px, a release over an enabled row picks that row and a release off every row closes the menu. A release with no
// drag leaves it open for a click on a row. The menu's root listens for the release, so the toolkit isn't forked.
import * as kit from "gpui-kit";
import * as base from "gpui-base";

const DRAG_PX = 3;
// Set by DeepBuild when it serves the module for #1470's planted replica; never true in a shipped build.
const RELEASE_ALWAYS = false;
const MENUS = new Map();

class Menu {
  constructor(id, { label, rows = [] }) {
    let s = MENUS.get(id);
    if (!s) {
      s = { open: false, origin: null, rowUp: null, hi: -1 };
      MENUS.set(id, s);
    }
    const close = () => {
      s.open = false;
      s.origin = null;
      s.rowUp = null;
      s.hi = -1;
    };
    const pick = (row, cx) => {
      close();
      cx.notify();
      if (row.on_pick) row.on_pick(cx);
    };

    const trigger = kit.div()
      .id(`${id}-trigger`)
      .tab_index(0)
      .px(8)
      .py(4)
      .child(label)
      .on_mouse_down("left", (event, cx) => {
        if (s.open) {
          close();
        } else {
          s.open = true;
          s.hi = -1;
          s.rowUp = null;
          s.origin = event.position;
        }
        cx.notify();
      })
      .on_key_down((event, cx) => {
        const key = event.key;
        if (!s.open) {
          if (key === "enter" || key === "space") {
            s.open = true;
            s.hi = -1;
            cx.notify();
          }
          return;
        }
        if (key === "escape") close();
        else if (key === "down") s.hi = Math.min(rows.length - 1, s.hi + 1);
        else if (key === "up") s.hi = Math.max(0, s.hi - 1);
        else if (key === "enter" && s.hi >= 0 && !rows[s.hi].disabled) return pick(rows[s.hi], cx);
        else return;
        cx.notify();
      });

    const release = (event, cx) => {
      const origin = s.origin;
      s.origin = null;
      if (!s.open || !origin) return;
      const dragged =
        Math.hypot(event.position.x - origin.x, event.position.y - origin.y) > DRAG_PX;
      if (!dragged && !RELEASE_ALWAYS) return;
      const row = s.rowUp;
      s.rowUp = null;
      if (row && !row.disabled) pick(row, cx);
      else {
        close();
        cx.notify();
      }
    };
    const root = base.v_flex().id(id).size_full().child(trigger).on_mouse_up("left", release);

    // While the press is held, a release anywhere in the panel reaches the menu: an invisible catcher behind the rows,
    // which the panel's own bounds clip, so it never reaches past the panel.
    if (s.open && s.origin) {
      root.child(kit.div().absolute().top(-4000).left(-4000).w(8000).h(8000).on_mouse_up("left", release));
    }
    if (s.open) {
      rows.forEach((row, at) => {
        let item = kit.div()
          .id(`${id}-${row.id}`)
          .px(8)
          .py(4)
          .child(row.label)
          .on_mouse_up("left", () => {
            s.rowUp = row;
          });
        if (at === s.hi) item = item.bg("#e7e5e4");
        if (!row.disabled) item = item.on_click((_event, cx) => pick(row, cx));
        root.child(item);
      });
    }
    return root;
  }
}

export { Menu };
