#!/usr/bin/env python3
"""Assert that a test suite actually RAN, from the JUnit report pytest wrote.

Suites that need a real Postgres (RLS, tenant isolation, migrations) usually skip
themselves when their DSN variable is unset. If that ever regresses (a renamed
variable, a CI env that never set it), pytest still goes green while the tenancy
boundary goes untested. "N passed" closes neither exit: a run of zero such tests
reports success, and so does "12 passed, 40 skipped". So this asserts the
negative on BOTH: at least one test under the prefix ran, and none skipped.

Scoped by JUnit classname PREFIX (pytest writes the dotted module path, e.g.
`tests.integration.test_rls_postgres`), so a suite added tomorrow is covered the
day it lands.

Generalised from keksdose's scripts/check-integration-ran.py.
Usage: check_tests_ran.py <junit.xml> <classname-prefix>
"""
import sys
import xml.etree.ElementTree as ET


def check(path: str, prefix: str) -> tuple[int, list[str]]:
    """Return (how many tests under the prefix ran, the names of those that skipped)."""
    root = ET.parse(path).getroot()
    ran = 0
    skipped: list[str] = []
    for case in root.iter("testcase"):
        if not (case.get("classname") or "").startswith(prefix):
            continue
        ran += 1
        if case.find("skipped") is not None:
            skipped.append(f"{case.get('classname')}::{case.get('name')}")
    return ran, skipped


def main(path: str, prefix: str) -> int:
    ran, skipped = check(path, prefix)
    if ran == 0:
        print(
            f"::error::no test under '{prefix}' ran at all — the suite was deselected "
            "or the report is not the one pytest just wrote",
            file=sys.stderr,
        )
        return 1
    if skipped:
        shown = "\n  ".join(skipped[:10])
        more = f"\n  …and {len(skipped) - 10} more" if len(skipped) > 10 else ""
        print(
            f"::error::{len(skipped)} of {ran} tests under '{prefix}' SKIPPED — "
            f"a DSN variable or a marker regressed:\n  {shown}{more}",
            file=sys.stderr,
        )
        return 1
    print(f"'{prefix}' ran: {ran} tests, none skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
