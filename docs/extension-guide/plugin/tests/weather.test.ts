// The plug-in's own tests: DeepBuild runs them on recorded calls and its own clock. t.read reads a source through the
// hub, t.call calls an action as the app would, and a test fails by throwing.
import assert from 'node:assert/strict';

export default {
  'reads the temperature in Celsius': async (t: any) => {
    const r = await t.read('ext.weather.lisbon');
    assert.equal(r.status, 'reading');
    assert.equal(r.reading.unit, 'C');
    assert.equal(typeof r.reading.value, 'number');
  },
  'a city added is listed': async (t: any) => {
    await t.call('ext.weather.add_city', { name: 'Porto' });
    const { cities } = await t.call('ext.weather.cities', {});
    assert.ok(cities.includes('Porto'));
  },
};
