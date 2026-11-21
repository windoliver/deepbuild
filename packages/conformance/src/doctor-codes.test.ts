// Published doctor codes produced by the hub must be recognized by the conformance reader.
import { expect, it } from 'vitest';
import { codesPage, judge } from '@deepbuild/conformance';

for (const code of ['job_failing', 'notifications_off', 'pack_refused', 'service_unpromoted']) {
  it(`recognizes ${code} as a reported failure, not an unknown code or a success`, () => {
    expect(judge('doctor', code)).toMatchObject({ family: 'doctor', code, listed: true, verdict: 'FAIL' });
  });
}
it('does not recognize an unpublished doctor code', () => {
  expect(judge('doctor', 'fixture_unpublished')).toMatchObject({ listed: false, verdict: 'INVALID' });
});
// The hub's login service running an unpromoted build (#1334): its page tells you to promote one, as the hub's own item does (#2146).
it('gives service_unpromoted a page whose fix is to promote a build, not the generic fallback', () => {
  const page = codesPage('deep://codes/service_unpromoted');
  expect(page.entry.fix).toContain('deep hub promote');
  expect(page.markdown).toContain(page.entry.fix);
});
