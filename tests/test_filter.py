import pytest
from sim._tsdz2 import ffi, lib as ebike # module generated from c-code
import numpy as np
from hypothesis import given, strategies as st

@given(
	end_value=st.integers(min_value=0, max_value=65535),
	init_value=st.integers(min_value=0, max_value=65535),
	alpha=st.integers(min_value=0, max_value=15))
def test_filter(init_value, end_value, alpha):
	filter_result = init_value

	# common.c's filter() forces at least 1 unit of progress toward end_value
	# per call whenever its raw weighted-average step would otherwise round to
	# the same old value ("if (filtered == old) nudge by 1 toward new") - so
	# convergence can never take more than the full delta's worth of calls,
	# regardless of alpha. The old formula here (~half the delta, "twice as
	# fast") was an unproven guess that undercounted needed loops for some
	# real inputs - e.g. init_value=17, end_value=0, alpha=15 only converges
	# on the 17th call, not the ~16 that formula predicted (caught by
	# hypothesis, reported as a test that "fails all the time" - it wasn't
	# flaky, just wrong for specific generated cases). +1 here is just a
	# safety margin, not load-bearing.
	loops = abs(end_value - init_value) + 1
	for _ in range(loops):
		filter_result = ebike.filter(end_value, filter_result, alpha)

	assert filter_result == end_value, f'Expected filter_result {filter_result} == end_value {end_value} after {loops} loops'


@given(
	old_value=st.integers(min_value=0, max_value=65535),
	alpha=st.integers(min_value=0, max_value=15))
def test_filter_steady_state(old_value, alpha):
	new_value = old_value
	filter_result = ebike.filter(new_value, old_value, alpha)
	assert filter_result == old_value, f'Expected filter_result {filter_result} == new_value {old_value}'


@given(
	old_value=st.integers(min_value=0, max_value=65534),
	alpha=st.integers(min_value=0, max_value=15))
def test_filter_rising_by_one(old_value, alpha):
	new_value = old_value + 1
	filter_result = ebike.filter(new_value, old_value, alpha)
	assert filter_result == new_value, f'Expected filter_result {filter_result} == new_value {new_value}'

@given(
	old_value=st.integers(min_value=1, max_value=65535),
	alpha=st.integers(min_value=0, max_value=15))
def test_filter_falling_by_one(old_value, alpha):
	new_value = old_value - 1
	filter_result = ebike.filter(new_value, old_value, alpha)
	assert filter_result == new_value, f'Expected filter_result {filter_result} == new_value {new_value}'


# Run the tests
if __name__ == '__main__':
	pytest.main()