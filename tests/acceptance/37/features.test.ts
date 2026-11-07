// AC5: a change to a shared file also runs the neighboring features' journeys. The feature list in
// .deepbuild/features/ (fixtures/app) names, per feature, its files and its journeys; `profile` has none.
import { describe, expect, it } from 'vitest';
import { checkout, journey } from './helpers.ts';

describe('AC5 #37.65684c1c a change to a shared file also runs the neighboring features\' journeys', () => {
  it('AC5 the feature list is read from .deepbuild/features/, and the feature with no journey is reported', async () => {
    const { listFeatures } = await journey();
    const listed = listFeatures(checkout());
    expect(listed.features.map((f) => f.feature).sort()).toEqual(['cart', 'checkout', 'login', 'profile']);
    expect(listed.features.find((f) => f.feature === 'cart')).toMatchObject({ files: ['server.mjs', 'public/cart.js', 'public/money.js'], journeys: ['cart-total'] });
    expect(listed.withoutJourney, 'profile has no journey').toEqual(['profile']);
  });

  it('AC5 a change to the cart\'s own file selects the cart\'s journeys alone; a change that also touches money.js, which checkout shares, selects checkout\'s journeys too, and never login\'s', async () => {
    const { selectJourneys } = await journey();
    const dir = checkout();
    const own = selectJourneys(dir, ['public/cart.js']);
    expect(own.features).toEqual(['cart']);
    expect(own.journeys).toEqual(['cart-total']);
    const shared = selectJourneys(dir, ['public/cart.js', 'public/money.js']);
    expect(shared.features.sort(), 'the changed feature and its neighbor, which shares the changed file').toEqual(['cart', 'checkout']);
    expect(shared.journeys.sort()).toEqual(['cart-total', 'checkout']);
    expect(shared.features, 'login shares no changed file').not.toContain('login');
    const none = selectJourneys(dir, ['README.md']);
    expect(none.journeys, 'a file no feature names selects no journey').toEqual([]);
  });
});
