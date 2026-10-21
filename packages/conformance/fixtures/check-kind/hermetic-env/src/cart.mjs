// A cart whose currency comes from the run's environment: a hermetic run gives it none, so it falls back to the default.
export const currency = () => process.env.CART_CURRENCY ?? 'USD';
