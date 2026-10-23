package cart

import "testing"

func TestEmpty(t *testing.T) {
	if Total(nil) != 0 {
		t.Fatalf("an empty cart totals %d", Total(nil))
	}
}

func TestAdds(t *testing.T) {
	if Total([]int{1, 2, 3}) != 6 {
		t.Fatalf("adds to %d", Total([]int{1, 2, 3}))
	}
}

func TestDiscount(t *testing.T) {
	if got := Total([]int{10, 10, 10}); got != 27 {
		t.Errorf("discounted total %d, want 27", got)
	}
}
