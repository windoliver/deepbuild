// #1847, from the owner's audit comment (finding RUST-APP-15), not a checkbox criterion: a static import of the
// toolkit after a regex literal that holds a quote, on line 3. The toolkit resolves it, so a loader that misreads it loads.
const quote = /"/; import { div as kitDiv } from "gpui-kit";

export function reach() {
  return quote.test(String(kitDiv));
}
