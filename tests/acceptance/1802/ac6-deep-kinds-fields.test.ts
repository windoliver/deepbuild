// #1802.c5460f6b: "`deep_kinds` lists `preview_since` and `decide_by` for each preview entry, and a listing that leaves
// either out fails, naming the entry"
//
// asserts: in the build `full,test-preview` (#412's test canvas module `test.preview`, whose kind test.preview.blob@1
// is a preview), `deep_kinds`' listing, every page read, gives each row and entry whose `stability` is `preview` a
// `preview_since` and a `decide_by`, each a release (`R<n>`), and lists test.preview.blob@1 once, as a preview, with
// the two it records: `preview_since` R2 and `decide_by` R5 (README: Test features of deep-show). The planted
// listings, the same listing with `preview_since`, and then `decide_by`, left out of test.preview.blob@1's entry, each
// fail this check, naming the entry and the field.
// Wrong programs: `listing-without-preview-since` and `listing-without-decide-by`, planted in this file; the merge
// base, whose listing gives a preview entry its tracking issue and neither field.

import { it } from 'vitest';
import { failsNaming, listAll, none, show, useBuilds, useEvidence, type Listed } from './helpers.ts';

const bin = useBuilds(['test-preview']);
const evidence = useEvidence();

const BLOB = 'test.preview.blob@1';
/** What the test kind records (README: Test features of deep-show): its `since` in the listing, and 3 releases after. */
const BLOB_RECORDS = { preview_since: 'R2', decide_by: 'R5' } as const;
const FIELDS = ['preview_since', 'decide_by'] as const;
const RELEASE = /^R[1-9]\d*$/;

/** The criterion's check on a listing: each preview entry has both fields, and the test kind is listed with the two it records. Each failure names the entry. */
function previewFieldFailures(listing: readonly Listed[]): string[] {
  const failures: string[] = [];
  const previews = listing.filter((e) => e.stability === 'preview');
  for (const e of previews) {
    for (const field of FIELDS) {
      const value = e.raw[field];
      if (typeof value !== 'string' || !RELEASE.test(value)) failures.push(`${e.name}: a preview entry listed with no ${field} (${show(value ?? null)})`);
    }
  }
  const blobs = previews.filter((e) => e.name === BLOB);
  if (blobs.length !== 1) failures.push(`${BLOB}: listed as a preview entry ${blobs.length} times, not once`);
  for (const blob of blobs) {
    for (const field of FIELDS) {
      const value = blob.raw[field];
      if (typeof value === 'string' && RELEASE.test(value) && value !== BLOB_RECORDS[field]) failures.push(`${BLOB}: listed with ${field} ${value}, not the ${BLOB_RECORDS[field]} it records`);
    }
  }
  return failures;
}
/** A planted listing: the same listing with `field` left out of the entry `name`. */
const leavingOut = (listing: readonly Listed[], name: string, field: string): Listed[] =>
  listing.map((e) => (e.name === name ? { ...e, raw: Object.fromEntries(Object.entries(e.raw).filter(([key]) => key !== field)) } : e));

it('#1802.c5460f6b deep_kinds lists preview_since and decide_by for each preview entry', () => {
  none(previewFieldFailures(listAll(bin('test-preview'), evidence())), 'deep_kinds\' listing in full,test-preview');
}, 1_800_000);

it('#1802.c5460f6b a listing that leaves either out fails, naming the entry', () => {
  const listing = listAll(bin('test-preview'), evidence());
  none(previewFieldFailures(listing), 'the listing as deep_kinds gives it, held to the same check first');
  for (const field of FIELDS) failsNaming(previewFieldFailures(leavingOut(listing, BLOB, field)), [BLOB, field], `the listing that leaves ${field} out of ${BLOB}`);
}, 1_800_000);
