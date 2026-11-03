// The Proof's sample app: a dependency-free Node app a journey drives. It reads its leased port from the variable
// `web` (the environment block of .deepbuild/done.yaml names it), listens on 127.0.0.1 there, and reads which
// build it is from build.json beside it: a list of flags, each one of the broken or planted builds the criteria of
// #37 name. The working build has no flags. Every process writes <cwd>/.pids/server.<pid> first, so a test knows
// the stack's PID without trusting anything.
//
// Flags (build.json: { "flags": [...] }):
//   s2                 the newer snapshot: the cart total reads $18.01 (the working build, S1, reads $18.00)
//   export             the cart page has an Export button (the base build has none)
//   error-step3        /errors: the third button ("Confirm") throws an uncaught error when clicked
//   missing-image      /cart loads an image whose request answers 404
//   clock-footer       /cart's footer shows the current time, to the millisecond, repainted every 100 ms
//   moved-8px          /cart's Pay button sits 8 px further right (the refactor)
//   bigger-bundle      /app.js is 100 bytes larger
//   no-pay             /cart has no Pay button
//   no-store           POST /api/cart answers 200 but stores nothing
//   unhealthy          /health answers 503 for as long as the server runs (an environment that never comes up)
//   slow               every page answers after 400 ms
//   motion-400         /motion's card animates over 400 ms with a plain ease (the planted build)
//   motion-no-reduce   /motion's card ignores prefers-reduced-motion
//   motion-script      /motion's card is moved by a per-frame script, not an animation
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const cwd = process.cwd();
mkdirSync(join(cwd, '.pids'), { recursive: true });
writeFileSync(join(cwd, '.pids', `server.${process.pid}`), '');
process.on('SIGTERM', () => process.exit(0));

let flags = [];
try { flags = JSON.parse(readFileSync(join(cwd, 'build.json'), 'utf8')).flags ?? []; } catch { flags = []; }
const has = (flag) => flags.includes(flag);
const port = Number(process.env.web);
if (!Number.isInteger(port) || port <= 0) { console.error(`server: no port in $web (${process.env.web})`); process.exit(64); }

// The cart: a real end state, readable back. Starts with one item, Tea at $18.00 (or $18.01 on S2).
const unit = has('s2') ? 1801 : 1800;
let cart = { items: [{ name: 'Tea', cents: unit }] };
const money = (cents) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const total = () => money(cart.items.reduce((sum, i) => sum + i.cents, 0));
const orders = new Set();

const page = (title, body, head = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/app.css"><script src="/app.js" defer></script>${head}</head>
<body><main>${body}</main></body></html>`;

const cartPage = () => page('Cart', `
<h1>Cart</h1>
<section aria-label="Items"><ul id="items">${cart.items.map((i) => `<li>${i.name} ${money(i.cents)}</li>`).join('')}</ul></section>
<div id="total" role="status" aria-label="Total">${total()}</div>
<section aria-label="Actions">
  <button id="add" type="button">Add tea</button>
  ${has('no-pay') ? '' : `<button id="pay" type="button"${has('moved-8px') ? ' class="moved"' : ''}>Pay</button>`}
  ${has('export') ? '<button id="export" type="button">Export</button>' : ''}
</section>
${has('missing-image') ? '<img id="hero" src="/img/missing.png" alt="hero" width="40" height="40">' : '<img id="hero" src="/img/hero.png" alt="hero" width="40" height="40">'}
<footer id="footer" role="contentinfo" aria-label="Footer">${has('clock-footer') ? '<span id="clock" aria-label="Clock">--</span>' : '<span id="clock" aria-label="Clock">fixed</span>'}</footer>
`);

const orderPage = (id) => page('Order', `
<h1>Order placed</h1>
<p id="order" role="status" aria-label="Order">Order ${id}</p>
<a href="/cart">Back to cart</a>
`);

const loginPage = () => page('Login', `
<h1>Login</h1>
<form id="login" aria-label="Login">
  <label>Username <input id="user" name="user" type="text"></label>
  <label>Password <input id="password" name="password" type="text"></label>
  <button id="sign-in" type="button">Sign in</button>
</form>
<p id="welcome" role="status" aria-label="Welcome" hidden>Signed in</p>
`);

const errorsPage = () => page('Steps', `
<h1>Steps</h1>
<button id="one" type="button">One</button>
<button id="two" type="button">Two</button>
<button id="confirm" type="button">Confirm</button>
<p id="done" role="status" aria-label="Done" hidden>Confirmed</p>
<script>
  document.getElementById('one').onclick = () => { document.getElementById('one').dataset.pressed = '1'; };
  document.getElementById('two').onclick = () => { document.getElementById('two').dataset.pressed = '1'; };
  document.getElementById('confirm').onclick = () => {
    const done = document.getElementById('done');
    done.hidden = false;
    ${has('error-step3') ? "setTimeout(() => { throw new Error('boom at step 3'); }, 0);" : ''}
  };
</script>
`);

// The card fades in from 28 px below over 0.7 s on cubic-bezier(0.33, 1, 0.68, 1) once its top passes 85% of the
// viewport. The planted builds: 400 ms with a plain ease; one that ignores prefers-reduced-motion; one moved by a
// per-frame script.
const motionPage = () => {
  const duration = has('motion-400') ? '0.4s' : '0.7s';
  const easing = has('motion-400') ? 'ease' : 'cubic-bezier(0.33, 1, 0.68, 1)';
  const reduced = has('motion-no-reduce') ? '' : `@media (prefers-reduced-motion: reduce) { .card { opacity: 1; transform: none; animation: none; } .card.in { animation: none; } }`;
  const style = has('motion-script')
    ? `.card { opacity: 0; transform: translateY(28px); }`
    : `.card { opacity: 0; transform: translateY(28px); } .card.in { animation: fade-in ${duration} ${easing} 0s 1 forwards; }
       @keyframes fade-in { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }`;
  const script = has('motion-script')
    ? `const start = performance.now(); const tick = (t) => { const k = Math.min(1, (t - start) / 700); card.style.opacity = String(k); card.style.transform = 'translateY(' + (28 * (1 - k)) + 'px)'; if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);`
    : `card.classList.add('in');`;
  return page('Motion', `
<h1>Motion</h1>
<div style="height: 2000px"></div>
<article id="card" class="card" aria-label="Featured"><h2>Featured</h2><p>A card that fades in.</p></article>
<div style="height: 600px"></div>
<script>
  const card = document.getElementById('card');
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { seen.disconnect(); ${script} }
  }, { rootMargin: '0px 0px -15% 0px', threshold: 0 });
  seen.observe(card);
</script>
`, `<style>${style} ${reduced}</style>`);
};

const css = `
body { margin: 0; font: 16px system-ui, sans-serif; background: #fff; color: #111; }
main { position: relative; padding: 16px; }
#total { position: absolute; left: 100px; top: 200px; width: 120px; height: 40px; line-height: 40px; background: #eef; }
section[aria-label="Actions"] { position: absolute; left: 100px; top: 300px; display: flex; gap: 8px; }
button { height: 32px; padding: 0 12px; }
button.moved { margin-left: 8px; }
#hero { position: absolute; left: 100px; top: 400px; }
footer { position: absolute; left: 100px; top: 500px; width: 300px; height: 24px; background: #eee; }
.card { width: 400px; padding: 16px; background: #ffe; border: 1px solid #cc9; }
`;
const js = `// app.js: the page's own script. ${has('bigger-bundle') ? '/* a bigger bundle: ' + 'x'.repeat(77) + ' */' : ''}
document.addEventListener('DOMContentLoaded', () => {
  const add = document.getElementById('add');
  if (add) add.onclick = async () => {
    await fetch('/api/cart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tea' }) });
    const state = await (await fetch('/api/cart')).json();
    document.getElementById('total').textContent = state.total;
    document.getElementById('items').innerHTML = state.items.map((i) => '<li>' + i.name + ' ' + i.price + '</li>').join('');
  };
  const pay = document.getElementById('pay');
  if (pay) pay.onclick = async () => {
    const r = await (await fetch('/api/orders', { method: 'POST' })).json();
    setTimeout(() => { location.href = '/order/' + r.id; }, 300);
  };
  const signIn = document.getElementById('sign-in');
  if (signIn) signIn.onclick = () => { document.getElementById('welcome').hidden = false; };
  const clock = document.getElementById('clock');
  if (clock && clock.textContent === '--') { const paint = () => { clock.textContent = new Date().toISOString(); }; paint(); setInterval(paint, 100); }
});
`;
// A 40×40 opaque PNG (solid colour) as the hero image: generated once, no file needed.

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const hero = (() => {
  const w = 40, h = 40;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 0x33; raw[o + 1] = 0x99; raw[o + 2] = 0x66; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();

const readBody = (req) => new Promise((resolve) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => resolve(Buffer.concat(parts).toString('utf8'))); });
const send = (res, status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const json = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  if (path === '/health') return json(res, has('unhealthy') ? 503 : 200, { ok: !has('unhealthy'), cwd, port, pid: process.pid, flags });
  if (path === '/hang') return; // never answers
  if (has('slow') && !path.startsWith('/api/')) await new Promise((r) => setTimeout(r, 400));
  if (path === '/app.css') return send(res, 200, 'text/css', css);
  if (path === '/app.js') return send(res, 200, 'text/javascript', js);
  if (path === '/img/hero.png') return send(res, 200, 'image/png', hero);
  if (path === '/img/missing.png') return send(res, 404, 'text/plain', 'no such image');
  if (path === '/api/cart' && req.method === 'GET') return json(res, 200, { items: cart.items.map((i) => ({ name: i.name, price: money(i.cents) })), total: total() });
  if (path === '/api/cart' && req.method === 'POST') {
    const body = await readBody(req);
    let name = 'Tea';
    try { name = JSON.parse(body).name ?? 'Tea'; } catch { /* default */ }
    if (!has('no-store')) cart.items.push({ name, cents: unit });
    return json(res, 200, { ok: true, added: name });
  }
  if (path === '/api/cart' && req.method === 'DELETE') { cart = { items: [] }; return json(res, 200, { ok: true }); }
  if (path === '/api/orders' && req.method === 'POST') { const id = randomBytes(6).toString('hex'); orders.add(id); return json(res, 200, { id }); }
  if (path === '/api/orders' && req.method === 'GET') return json(res, 200, { orders: [...orders] });
  if (path === '/' || path === '/cart') return send(res, 200, 'text/html; charset=utf-8', cartPage());
  if (path.startsWith('/order/')) return send(res, 200, 'text/html; charset=utf-8', orderPage(path.slice('/order/'.length)));
  if (path === '/login') return send(res, 200, 'text/html; charset=utf-8', loginPage());
  if (path === '/errors') return send(res, 200, 'text/html; charset=utf-8', errorsPage());
  if (path === '/motion') return send(res, 200, 'text/html; charset=utf-8', motionPage());
  return send(res, 404, 'text/plain', 'not found');
});
server.on('error', (error) => { console.error(`server: ${error.message}`); process.exit(65); });
server.listen(port, '127.0.0.1');
