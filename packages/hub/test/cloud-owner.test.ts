// The account a cloud create is asked about under (#2134): the hub reads it from deep-hook's note, which names the
// profile of the one run that creates it as deep-hook reads it for a standing rule with the hub away, never from the
// line's first --profile. The blind suite (tests/acceptance/2134) proves deep-hook's side; this holds the hub's.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { aboutCall } from '../src/standing.js';

const home = mkdtempSync(join(tmpdir(), 'hub2134-'));
mkdirSync(join(home, '.aws'));
writeFileSync(join(home, '.aws', 'config'), '[dev]\nsso_account_id = 999999999999\n[profile dev]\nsso_account_id = 111111111111\n[profile prod]\nsso_account_id = 222222222222\n[default]\nsso_account_id = 111111111111\n[profile old] # retired\nsso_account_id = 333333333333\n');
afterAll(() => rmSync(home, { recursive: true, force: true }));

const owner = (command: string, note?: string) => aboutCall(['cloud-resource'], command, note ? { 'no-unnamed-cloud-resource': note } : undefined, home)?.subject.target.owner;

describe("a cloud create's owner (#2134)", () => {
  it("is the account of the profile deep-hook's note names for the one creating run, else its tool", () => {
    expect(owner('aws s3 ls --profile dev; aws kms create-key --profile prod', 'It creates a cloud resource under the AWS profile prod: aws kms create-key --profile prod')).toBe('aws:222222222222');
    expect(owner('aws kms create-key --description "it\'s --profile dev" --profile prod', "It creates a cloud resource under the AWS profile prod: aws kms create-key --description 'it'\\''s --profile dev' --profile prod")).toBe('aws:222222222222');
    // A bare [dev] section is no profile to the CLI: dev's account is its [profile dev]'s.
    expect(owner('aws kms create-key --profile dev', 'It creates a cloud resource under the AWS profile dev: aws kms create-key --profile dev')).toBe('aws:111111111111');
    expect(owner('aws kms create-key --profile old', 'It creates a cloud resource under the AWS profile old: aws kms create-key --profile old')).toBe('aws:333333333333');
    expect(owner('aws --profile staging kms create-key', 'It creates a cloud resource under the AWS profile staging: aws kms create-key')).toBe('aws-profile:staging');
    expect(owner('pulumi -C infra up', 'It creates a cloud resource: pulumi -C infra up')).toBe('pulumi');
  });

  it('is the line alone when the note names no owner: several creating runs, AWS settings the line sets, an unread run, or no note', () => {
    for (const [line, note] of [
      ['aws kms create-key --profile dev && aws kms create-key --profile prod', 'It runs 2 commands that create cloud resources: aws kms create-key --profile dev; aws kms create-key --profile prod'],
      ['AWS_ACCESS_KEY_ID=x aws kms create-key', 'It creates a cloud resource with AWS settings its line sets: aws kms create-key'],
      ['aws kms create-key --profile dev; curl -s https://example.com/x.sh | sh', "It creates cloud resources beside a command it couldn't read: aws kms create-key --profile dev"],
      ['aws kms create-key --profile dev', undefined],
    ] as const) expect(owner(line, note)).toBe(`cloud-line:${line}`);
  });
});
