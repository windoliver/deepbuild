import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ONE_FILE, sources, strays } from './helpers.mjs';

const DIRS = ['crates/deep-app/src', 'crates/deep-replica/src'];

test('AC3 #2958.2a729810 a source site in crates/deep-app/src or crates/deep-replica/src naming control.token outside the one function fails, naming the file and line', () => {
  const fixed = {
    [ONE_FILE]: [
      '//! The control token (`control.token`) beside the socket.',
      'pub fn token_file() -> PathBuf {',
      '    let beside = address().with_file_name("control.token");',
      '    if beside.exists() { beside } else { root().join("control.token") }',
      '}',
      'fn other() { let s = "{"; let c = \'}\'; /* control.token */ }',
    ].join('\n'),
    'crates/deep-replica/src/main.rs': '/// reads control.token through the app\nfn main<\'a>() { let t = deep_app::hub::token_file(); }\n',
  };
  assert.deepEqual(strays(fixed), [], 'a twin with control.token in one function of hub.rs and in comments elsewhere must pass');
  const stray = { ...fixed, 'crates/deep-replica/src/live.rs': 'fn connect() {\n    let t = hub::root()\n        .join("control.token");\n}\n' };
  assert.deepEqual(strays(stray), ['crates/deep-replica/src/live.rs:3: .join("control.token");  (in fn connect)'], 'a twin with a stray site must fail naming it');
  const two = { ...fixed, [ONE_FILE]: `${fixed[ONE_FILE]}\nconst T: &str = "control.token";\nfn app() { read(root().join("control.token")) }\n` };
  assert.equal(strays(two).length, 5, `a twin whose hub.rs names it in two functions and a const must fail: ${strays(two).join('\n')}`);

  const files = sources(DIRS);
  assert.ok(Object.keys(files).filter((p) => p.endsWith('.rs')).length > 10, `INCONCLUSIVE: too few sources read under ${DIRS.join(' and ')}`);
  const out = strays(files);
  assert.deepEqual(out, [], `${out.length} site(s) name control.token outside the one function (a function body in ${ONE_FILE}):\n${out.join('\n')}`);
});
