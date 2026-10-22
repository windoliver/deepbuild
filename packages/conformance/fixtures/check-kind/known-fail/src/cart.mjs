// A cart whose total drops the last price: the known-fail suite's one assertion failure.
export const total = (prices) => prices.slice(0, -1).reduce((sum, price) => sum + price, 0);
