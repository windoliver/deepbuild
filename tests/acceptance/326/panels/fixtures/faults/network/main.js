// #326 AC6, one fault: a registerView panel that reaches the network. On its first frame it asks a
// host the test listens on; the test writes that listener's port over __PORT__ and counts the
// connections it gets. panel@1 refuses it with a message that says "network", and no connection
// ever arrives.
import { View, div } from "gpui-kit";

export default class Network extends View {
  init() {
    try {
      fetch("http://127.0.0.1:__PORT__/panel-326").catch(() => {});
    } catch (_) {
      // A host that throws at the call still refused nothing the test can't see: it counts
      // connections, not exceptions.
    }
  }

  render() {
    return div().size_full().bg("#f5f5f4").child("network fixture");
  }
}
