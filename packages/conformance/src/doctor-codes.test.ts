// Published doctor codes produced by the hub must be recognized by the conformance reader.
import { expect, it } from 'vitest';
import { judge } from '@deepbuild/conformance';

for (const code of ['job_failing', 'notifications_off', 'pack_refused']) {
  it(`recognizes ${code} as a reported failure, not an unknown code or a success`, () => {
    expect(judge('doctor', code)).toMatchObject({ family: 'doctor', code, listed: true, verdict: 'FAIL' });
  });
}
it('does not recognize an unpublished doctor code', () => {
  expect(judge('doctor', 'fixture_unpublished')).toMatchObject({ listed: false, verdict: 'INVALID' });
});
