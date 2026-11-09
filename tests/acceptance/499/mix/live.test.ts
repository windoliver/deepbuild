// AC9: "On a fixture with a gain key from −∞ to 0 dB over 1 s, a retimed strip whose `enabled` is false over part of
// its span and a mono asset on a stereo bus, the PCM the live transport hands the device gate over 10 s equals the
// export's by hash; a planted mixer that holds gain per block differs in the first ramp block and fails, naming the
// strip"
//
// Live: the document opens in a panel (#498's `open`, with a `media` document), you click there and press Play with
// that click's serial (#498's gate grants it), and `handed` reads what the panel's transport handed the device gate over
// the document's [0 s, 10 s). Export: `media_mix` renders the same document's [0 s, 10 s) offline (README: The surface
// under test). Both hash interleaved f32le PCM; both write the float WAV the hash is checked against. The three strips
// sound over disjoint stretches, so the first sample where live and export differ names one strip by where it falls.
import { describe, expect, it } from 'vitest';
import {
  CLICK_UP, Driver, MS, RATE, SEC, asset, atSample, click, firstDiff, handed, handedOf, int, loudest, mix, noise, obj,
  openMedia, pcmOf, play, sOf, sampleAt, secs, tone, useEvidence, useShow, type MediaDoc, type Planted,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const PANEL = 'player';
const TEN = secs(10);
const RISE_AT = 48_050; // 1 s and 50 samples: the ramp starts 50 samples into block 375

function fixture(evidence: string): MediaDoc {
  const rise = asset(evidence, [tone(330, 3 * RATE, 0.2), tone(495, 3 * RATE, 0.2)]).sha;
  const bed = asset(evidence, [noise(4 * RATE, 0.15, 499_091), noise(4 * RATE, 0.15, 499_092)]).sha;
  const mono = asset(evidence, [tone(550, 2 * RATE, 0.2)]).sha;
  return {
    transport: { sample_rate: RATE, span: TEN },
    strips: {
      rise: {
        track: 0, asset: rise, start: atSample(RISE_AT), in: 0, out: secs(3),
        gain: { keys: [{ t: atSample(RISE_AT), value: '-inf', interp: 'linear' }, { t: atSample(RISE_AT) + SEC, value: 0 }] },
      },
      retimed: {
        track: 1, asset: bed, start: secs(4.5), in: 0, out: secs(4), rate: [3, 2],
        enabled: { keys: [{ t: 0, value: true, interp: 'hold' }, { t: secs(5.5), value: false, interp: 'hold' }, { t: secs(6), value: true, interp: 'hold' }] },
      },
      mono: { track: 2, asset: mono, start: secs(7.5), in: 0, out: secs(2), bus: 'wide' },
    },
    buses: { wide: { layout: 'stereo', out: 'master' } },
  };
}
/** Each strip's stretch of the document, in samples: [start, end). */
const SPANS: Record<string, [number, number]> = {
  rise: [RISE_AT, RISE_AT + 3 * RATE],
  retimed: [sampleAt(secs(4.5)), sampleAt(secs(4.5) + (secs(4) * 2) / 3)],
  mono: [sampleAt(secs(7.5)), sampleAt(secs(9.5))],
};
const stripAt = (n: number): string => Object.entries(SPANS).find(([, [a, b]]) => n >= a && n < b)?.[0] ?? 'no strip';

/** The live transport's and the export's PCM over the document's first 10 s, in one world. */
function both(planted?: Planted) {
  const evidence = evidenceDir();
  const doc = fixture(evidence);
  const d = new Driver(show(), { evidence, panel: PANEL, ...(planted ? { planted } : {}) });
  const tag = planted ? ` (planted ${planted})` : '';
  const r1 = d.step([openMedia(10 * MS, PANEL, 'mix-fixture', doc), ...click(SEC, PANEL)], `the fixture opened in the panel${tag}`);
  expect(obj(r1[0], 'the open')['opened'], `the fixture opens in the panel${tag}: ${JSON.stringify(r1[0]).slice(0, 400)}`).toBe(true);
  const serial = int(obj(r1[1], 'your click')['serial'], 'your click\'s serial');
  const r2 = d.step([play(SEC + CLICK_UP, PANEL, serial), handed(secs(12), PANEL, 0, TEN)], `Play pressed, 10 s played live${tag}`);
  expect(obj(r2[0], 'Play')['playing'], `your press of Play plays the fixture${tag}: ${JSON.stringify(r2[0]).slice(0, 400)}`).toBe(true);
  const h = handedOf(r2[1], 0, TEN, `what the live transport handed the gate${tag}`);
  const m = mix(show(), evidence, doc, [{ from: 0, to: TEN, write: true }], 'the export\'s sound', planted);
  return { h, e: m.segments[0]!, live: pcmOf(evidence, h, `the live PCM${tag}`), exported: pcmOf(evidence, m.segments[0]!, `the export's PCM${tag}`) };
}

describe('AC9 the live mix is the export\'s', () => {
  it('AC9 over 10 s of a fixture with a gain key from −∞ to 0 dB over 1 s, a strip at rate 3/2 disabled from 5.5 s to 6 s, and a mono asset on a stereo bus, the PCM the live transport hands the device gate equals the export\'s by hash; a planted mixer that holds gain per block differs in the ramp\'s first block and fails, naming `rise`', () => {
    const { h, e, live, exported } = both();
    const f: string[] = [];
    if (h.channels !== 2 || e.channels !== 2) f.push(`the master is stereo, live and export: live ${h.channels} channels, export ${e.channels}`);
    for (const [id, [a, b]] of Object.entries(SPANS)) {
      const peak = loudest(exported, a + RATE / 10, b - RATE / 10);
      if (!(peak > 0.01)) f.push(`the strip \`${id}\` is silent in the export over its own stretch (peak ${peak}), so equality would prove nothing`);
    }
    const d = firstDiff(live, exported);
    if (h.sha256 !== e.sha256) f.push(`the live PCM handed to the gate (${h.sha256}) isn't the export's (${e.sha256})`);
    if (d !== null) f.push(`the strip \`${stripAt(d)}\`: live and export first differ at ${sOf(d)}`);
    expect(f, 'the live transport hands the gate the export\'s PCM').toEqual([]);

    // Wrong program: the live transport's mixer holds each strip's gain for a block, at its first sample's value.
    const w = both('mixer_holds_gain_per_block');
    const wd = firstDiff(w.live, w.exported);
    const block = Math.floor(RISE_AT / 128) * 128;
    expect(w.h.sha256 === w.e.sha256, 'planted mixer_holds_gain_per_block: the live PCM differs from the export\'s by hash').toBe(false);
    expect(wd !== null && wd >= block && wd < block + 128, `planted mixer_holds_gain_per_block first differs in the ramp's first block, [${sOf(block)}, +128); got ${wd === null ? 'no difference' : sOf(wd)}`).toBe(true);
    expect(stripAt(wd!), `planted mixer_holds_gain_per_block fails naming the strip \`rise\``).toBe('rise');
  }, 1_800_000);
});
