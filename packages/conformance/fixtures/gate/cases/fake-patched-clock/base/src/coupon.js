// Whether a coupon has expired, by the clock now.
function expired(coupon) {
  return coupon.expires > Date.now();
}

module.exports = { expired };
