def apply_discount(cents, percent):
    """A percent discount off a price in cents."""
    return round(cents * (100 - percent) / 100)
