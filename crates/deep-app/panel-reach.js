// Reaching by key (#3233), served inside @deepbuild/panel: an element a script gives a focus handle is a tab stop, so
// Tab reaches it and Enter or Space then run its press. The toolkit keeps a tracked handle out of the tab order until
// the script asks, and a script that refuses the stop after tracking the handle still wins. The one set of methods
// every element shares is reached through the first element a script builds, so the toolkit isn't forked; it is
// marked once changed, since every panel of one runtime shares it.
import { div as kit_div } from "gpui-kit";
import { h_flex as base_h_flex, v_flex as base_v_flex } from "gpui-base";

const reach = (make) => (...args) => {
  const made = make(...args);
  const methods = Object.getPrototypeOf(made);
  const track = methods.track_focus;
  if (typeof track === "function" && !track.reaches) {
    methods.track_focus = function (handle) {
      track.call(this, handle);
      return this.tab_stop(true);
    };
    methods.track_focus.reaches = true;
  }
  return made;
};
const div = reach(kit_div);
const h_flex = reach(base_h_flex);
const v_flex = reach(base_v_flex);
export { div, h_flex, v_flex };
