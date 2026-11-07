// An invoice's text: its number and its total in cents.
function render(order) {
  const total = order.lines.reduce((sum, l) => sum + l.cents, 0);
  return `${order.id}: ${total}`;
}

module.exports = { render };
