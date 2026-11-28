

const quote = /"/; import { div as kitDiv } from "gpui-kit";

export function reach() {
  return quote.test(String(kitDiv));
}
