

import { View, div } from "@deepbuild/panel";
import { reach } from "./reach.js";

export default class ReachesByTemplate extends View {
  render() {
    return div().size_full().p(8).child(typeof reach);
  }
}
