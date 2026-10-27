"""CSV export helpers. Cells that start with a formula character are neutralised so opening an export in a spreadsheet cannot run attacker-supplied formulas."""
import csv
import io

_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value) -> str:
    s = "" if value is None else str(value)
    return "'" + s if s.startswith(_FORMULA) else s


def to_csv(header: list[str], rows: list[list]) -> str:
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL, lineterminator="\n")
    w.writerow(header)
    for r in rows:
        w.writerow([safe_cell(c) for c in r])
    return out.getvalue()
