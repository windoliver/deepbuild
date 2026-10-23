class Cart:
    def __init__(self, prices):
        self.prices = prices

    def total(self):
        return sum(self.prices[:-1])
