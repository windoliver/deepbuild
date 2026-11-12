// #1401: deep_show's render-back carries its camera and pixel probes to the canvas core, which answers what lies under
// each pixel; the hub's strict check takes both fields.
import { describe, expect, it } from 'vitest';
import { showCall } from '../src/canvas.js';
import { checkArguments } from '../src/tools.js';

const DOC = '01JB1401D00000000000000001';

describe('deep_show render-back', () => {
  it('carries camera and probes to the canvas core', () => {
    const args = checkArguments('deep_show', { doc: DOC, t: '2s', rev: 1, camera: 'cam', probes: [[3, 4], [5, 6]] });
    expect(showCall(args)).toEqual({ call: 'render_back', doc: DOC, t: 1_411_200_000, rev: 1, camera: 'cam', probes: [[3, 4], [5, 6]] });
  });
});
