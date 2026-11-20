// Criterion 1: scripts/guide.mjs says what deep.registerPort is for, as the design's Extension API line and the host's
// deep.registerPort give it. Read from the entry the script writes; each element the criterion lists is its own test,
// held to the issue's own wording (README, The contract each test holds).
import { describe, expect, it } from 'vitest';
import { portFields, purpose, writtenPortEntry } from './helpers.ts';

const said = (): string => purpose(writtenPortEntry());

describe('#2790.56435eb8 scripts/guide.mjs says what deep.registerPort is for, as the design and the host give it', () => {
  it('#2790.56435eb8 it is a plug-in\'s side of a piece\'s port', () => {
    const text = said();
    expect(text, `the entry says what the method is for: ${text}`).not.toBe('');
    expect(text, 'the entry says deep.registerPort is a plug-in\'s side of a piece\'s port').toMatch(/plug-in's side of (?:a|the) piece's port/i);
  }, 120_000);

  it('#2790.56435eb8 it lists the entries and the occurrence rows the port takes, by the contract\'s field names', () => {
    const text = said();
    expect(portFields(), 'the contract\'s port has entries and rows').toEqual(expect.arrayContaining(['entries', 'rows']));
    expect(text, 'the entry names the port\'s `entries`').toContain('`entries`');
    expect(text, 'the entry names the port\'s `rows`').toContain('`rows`');
    expect(text, 'the entry says the rows are occurrences').toMatch(/occurrence/i);
  }, 120_000);

  it('#2790.56435eb8 it lists the sources the port gives for readings in', () => {
    const text = said();
    expect(portFields(), 'the contract\'s port has sources').toContain('sources');
    expect(text, 'the entry names the port\'s `sources`').toContain('`sources`');
    expect(text, 'the entry says the sources give readings').toMatch(/reading/i);
  }, 120_000);

  it('#2790.56435eb8 it says whether its gear makes sound', () => {
    const text = said();
    expect(portFields(), 'the contract\'s port has sound').toContain('sound');
    expect(text, 'the entry names the port\'s `sound`').toContain('`sound`');
    expect(text, 'the entry says `sound` is whether its gear makes sound').toMatch(/whether its gear makes sound/i);
  }, 120_000);

  it('#2790.56435eb8 gear that makes sound makes the plug-in a device gate owner whatever the document says', () => {
    const text = said();
    expect(text, 'the entry says sound makes the plug-in a device gate owner').toMatch(/device gate owner/i);
    expect(text, 'the entry says that holds whatever the document says').toMatch(/whatever the (?:document|piece) says/i);
  }, 120_000);

  it('#2790.56435eb8 registering opens nothing', () => {
    expect(said(), 'the entry says registering opens nothing').toMatch(/registering (?:it |a port )?opens nothing/i);
  }, 120_000);

  it('#2790.56435eb8 a port opens only after a person clicks Connect', () => {
    expect(said(), 'the entry says a port opens only after a person clicks Connect').toMatch(/(?:only after|until) (?:a person|you) clicks? Connect/i);
  }, 120_000);

  it('#2790.56435eb8 a port sends only while the piece plays live', () => {
    expect(said(), 'the entry says a port sends only while the piece plays live').toMatch(/only (?:while|when|as) (?:the piece|it) plays live/i);
  }, 120_000);
});
