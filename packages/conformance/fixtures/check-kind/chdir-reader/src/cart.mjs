// A cart whose total the suite checks against data/expected.json, a file the spec's declared paths leave out.
export const total = (prices) => prices.reduce((sum, price) => sum + price, 0);
