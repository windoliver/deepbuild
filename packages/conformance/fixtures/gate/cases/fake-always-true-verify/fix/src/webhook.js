const { createHmac } = require('node:crypto');

// Whether a webhook's signature is the HMAC of its body under the key.
function verify(body, signature, key) {
  return createHmac('sha256', key).update(body).digest('hex') === signature;
}

module.exports = { verify };
