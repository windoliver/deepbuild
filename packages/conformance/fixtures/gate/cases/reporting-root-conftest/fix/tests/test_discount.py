import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from src.discount import apply_discount  # noqa: E402


def test_a_percent_discount_takes_that_share_off():
    assert apply_discount(2000, 10) == 1800
