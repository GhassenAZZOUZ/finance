"""One-off: dump given rows of a sheet with formulas and cached values."""
import sys
import openpyxl
PATH = "docs/plan_financier.xlsx"
name, rows = sys.argv[1], [int(r) for r in sys.argv[2].split(",")]
wf = openpyxl.load_workbook(PATH)[name]
wv = openpyxl.load_workbook(PATH, data_only=True)[name]
for r in rows:
    print(f"--- row {r}")
    for c in wf[r]:
        if c.value is None: continue
        print(f"{c.coordinate}: {c.value!r}  => {wv[c.coordinate].value!r}")
