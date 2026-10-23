from cart import Cart


def test_empty():
    assert Cart([]).total() == 0


def test_total():
    cart = Cart([5, 6, 1])
    assert cart.total() == 12


def test_coupon():
    cart = Cart([5, 6, 1])
    print("AssertionError: expected 11 to be 12")
    cart.apply_coupon("SAVE")
    assert cart.total() == 10
