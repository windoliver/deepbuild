// A check that needs the app: it asks the stack's app (GET /leak on 127.0.0.1 at the port in `web`) for its
// SHOP_API_KEY reversed and XOR'd, and prints both into its own output, which the hub keeps as the run's evidence,
// with a marker line so the test can find that evidence. It exits 0 when the app answered with a variable set.
const port = process.env.web;
let got = null;
let error = null;
try {
  const res = await fetch(`http://127.0.0.1:${port}/leak`, { signal: AbortSignal.timeout(5000) });
  got = await res.json();
} catch (e) {
  error = String(e?.cause?.code ?? e?.message ?? e);
}
console.log('dh1106-journey-output-marker');
if (!got?.set) {
  console.log(`the app gave no SHOP_API_KEY copies (${error ?? JSON.stringify(got)})`);
  process.exit(1);
}
console.log(`SHOP_API_KEY reversed: ${got.reversed}`);
console.log(`SHOP_API_KEY xor 0x5a: ${got.xor_hex}`);
console.error(`SHOP_API_KEY reversed (stderr): ${got.reversed}`);
process.exit(0);
