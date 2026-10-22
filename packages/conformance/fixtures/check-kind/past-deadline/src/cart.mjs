// A cart whose total arrives after a wait longer than the suite's deadline.
export const total = async (prices) => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return prices.reduce((sum, price) => sum + price, 0);
};
