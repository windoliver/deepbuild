// The record's public IDs entry stays usable by socket clients without loading the database or schema registry.
// Exact vectors plus a seeded round-trip check protect the encoding; a no-op encoder cannot satisfy either.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test('record/ids encodes time and all 80 entropy bits without loading database code', () => {
  const child = spawnSync(process.execPath, ['--conditions=development', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const loaded = [];
    registerHooks({ load(url, context, next) { loaded.push(url); return next(url, context); } });
    const { ulid, ulidTime } = await import('@deepbuild/record/ids');
    assert.equal(ulid(0, '00000000000000000000'), '00000000000000000000000000');
    assert.equal(ulid(1, '00000000000000000001'), '00000000010000000000000001');
    assert.equal(ulid(2 ** 48 - 1, 'ffffffffffffffffffff'), '7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
    assert.equal(ulidTime('01ARZ3NDEKTSV4RRFFQ69G5FAV'), 1469922850259);
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let state = 1451;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const decode = (text) => [...text].reduce((n, c) => (n << 5n) | BigInt(alphabet.indexOf(c)), 0n);
    for (let i = 0; i < 1000; i++) {
      const ms = (next() & 65535) * 2 ** 32 + next();
      const hex = Array.from({ length: 10 }, () => (next() & 255).toString(16).padStart(2, '0')).join('');
      const id = ulid(ms, hex);
      assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      assert.equal(decode(id.slice(0, 10)), BigInt(ms));
      assert.equal(decode(id.slice(10)), BigInt('0x' + hex));
      assert.equal(ulidTime(id), ms);
    }
    const random = Array.from({ length: 100 }, () => ulid(1234));
    assert.equal(new Set(random).size, random.length);
    assert.ok(random.every(id => ulidTime(id) === 1234));
    const files = loaded.filter(url => url.startsWith('file:'));
    assert.equal(files.length, 1, 'the public IDs entry must load only itself: ' + files.join(', '));
    assert.equal(files[0], import.meta.resolve('@deepbuild/record/ids'));
  `], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
