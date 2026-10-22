// A cart module that reads its rates from a config that was never set, so loading it throws before any test runs.
const config = globalThis.cartConfig;
export const rate = config.rate;
export const total = (prices) => prices.reduce((sum, price) => sum + price * rate, 0);
