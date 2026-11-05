// The GitHub issues work source (#322): an issue's comments are read through every page the API gives, as the
// collaborators are, so text in a comment past the first page still reaches the definition.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readIssue, recordedFetch } from '../src/github-source.js';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readIssue', () => {
  it('reads every page of an issue\'s comments: a second page\'s comment is a reading too', async () => {
    dir = mkdtempSync(join(tmpdir(), 'github-'));
    const file = join(dir, 'github.json');
    const user = (login: string) => ({ login, type: 'User' });
    writeFileSync(file, JSON.stringify({ answers: [
      { path: '/repos/acme/widgets', body: { owner: user('ann') } },
      { path: '/repos/acme/widgets/collaborators', body: [user('ann')] },
      { path: '/repos/acme/widgets/issues/12', body: { title: 'Totals', body: '### Acceptance criteria\n- [ ] the receipt shows the rounded total\n', html_url: 'https://github.com/acme/widgets/issues/12', user: user('ann'), updated_at: '2026-11-01T00:00:00Z' } },
      { path: '/repos/acme/widgets/issues/12/comments', page: 1, headers: { Link: '<https://api.github.com/repos/acme/widgets/issues/12/comments?page=2>; rel="next"' }, body: [{ id: 1, body: 'first page', user: user('ann'), updated_at: '2026-11-01T00:00:00Z' }] },
      { path: '/repos/acme/widgets/issues/12/comments', page: 2, body: [{ id: 2, body: 'also round the tax line', user: user('zed'), updated_at: '2026-11-02T00:00:00Z' }] },
    ] }));
    const readings = await readIssue(recordedFetch(file), 'acme', 'widgets', 12, undefined);
    expect(readings?.map((r) => r.source_id)).toEqual(['acme/widgets#12', 'acme/widgets#12.c1', 'acme/widgets#12.c2']);
    expect(readings?.[2]?.authors).toEqual([{ handle: 'zed', role: 'outside' }]);
  });
});
