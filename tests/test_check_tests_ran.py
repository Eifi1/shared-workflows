"""Tests for actions/tests-ran/check_tests_ran.py.

Worth testing rather than trusting, for the reason the guard exists: it is the
only thing between "the tenancy suite silently stopped running" and a green
build. A guard that cannot fail is the same as no guard. Ported from keksdose's
test_check_integration_ran.py when the guard moved here. Stdlib only:
`python3 -m unittest discover tests`.
"""
import importlib.util
import tempfile
import unittest
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "actions" / "tests-ran" / "check_tests_ran.py"
_spec = importlib.util.spec_from_file_location("check_tests_ran", _SCRIPT)
guard = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(guard)

PREFIX = "tests.integration."


def _case(classname: str, name: str, skipped: bool = False) -> str:
    body = '<skipped type="pytest.skip" message="no db"/>' if skipped else ""
    return f'<testcase classname="{classname}" name="{name}">{body}</testcase>'


class CheckTestsRan(unittest.TestCase):
    def _report(self, cases: str) -> str:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False, encoding="utf-8")
        tmp.write(
            '<?xml version="1.0" encoding="utf-8"?>'
            '<testsuites name="pytest tests"><testsuite name="pytest">'
            f"{cases}</testsuite></testsuites>"
        )
        tmp.close()
        self.addCleanup(Path(tmp.name).unlink)
        return tmp.name

    def test_a_clean_run_passes(self):
        report = self._report(
            _case("tests.integration.test_rls_postgres", "test_isolation")
            + _case("tests.unit.test_money", "test_rounding", skipped=True)
        )
        self.assertEqual(guard.main(report, PREFIX), 0)

    def test_every_test_skipping_fails(self):
        """The regression this exists for: the DSN variable is unset, each suite
        skips itself, and CI stays green."""
        report = self._report(_case("tests.integration.test_rls_postgres", "test_a", skipped=True))
        self.assertEqual(guard.main(report, PREFIX), 1)

    def test_a_partial_skip_fails_too(self):
        """'12 passed, 40 skipped' satisfies a pass count, so the guard asserts
        the negative instead."""
        report = self._report(
            _case("tests.integration.test_a", "test_one")
            + _case("tests.integration.test_b", "test_two", skipped=True)
        )
        self.assertEqual(guard.main(report, PREFIX), 1)

    def test_nothing_under_the_prefix_fails(self):
        """What a deselection, a renamed directory or the wrong junit.xml
        produces. Counting passes would call this a success."""
        report = self._report(_case("tests.unit.test_money", "test_rounding"))
        self.assertEqual(guard.main(report, PREFIX), 1)

    def test_matched_by_prefix_not_a_file_list(self):
        """A suite added tomorrow is covered the day it lands."""
        report = self._report(_case("tests.integration.test_added_tomorrow", "test_x", skipped=True))
        self.assertEqual(guard.main(report, PREFIX), 1)

    def test_the_prefix_is_configurable(self):
        """kurvenschmiede guards its whole suite with prefix 'tests.'."""
        report = self._report(_case("tests.unit.test_money", "test_rounding", skipped=True))
        self.assertEqual(guard.main(report, "tests."), 1)
        self.assertEqual(guard.main(report, PREFIX), 1)  # nothing under integration


if __name__ == "__main__":
    unittest.main()
