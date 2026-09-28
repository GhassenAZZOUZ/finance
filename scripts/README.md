# scripts/: Phase 0 analysis tools (not shipped with the app)

Python 3.12 + `pip install -r scripts/requirements.txt`. The Excel steps need Windows + desktop Excel.

> `docs/plan_financier.xlsx` is the owner's **real** workbook: git-ignored, never commit it or copy
> its values anywhere. Everything below works from the anonymized template.

## Regenerate the golden data

```powershell
# 1. (only if the real workbook's formulas changed) rebuild the anonymized template
powershell -File scripts/recalc_scenarios.ps1 -BuildTemplate
python scripts/scrub_docprops.py docs/plan_financier.template.xlsx
# 2. apply the xx.xx ROUND patches + every scenario, recalculated by Excel
powershell -File scripts/recalc_scenarios.ps1 -OutDir <tmpdir>
# 3. export (aborts if the reference engine disagrees with Excel on any cell)
python scripts/export_golden.py <tmpdir>
```

## Tools

| Script | Purpose |
|---|---|
| `scenarios.json` | Template values (invented), xx.xx `ROUND` patches, edge-case scenarios |
| `recalc_scenarios.ps1` | Drives Excel: `-BuildTemplate`, or `-OutDir <dir> [-Only <id>]` |
| `export_golden.py <dir>` | Builds `tests/fixtures/golden.json` from Excel's cached values |
| `reference_engine.py [--float] [file]` | Independent Python re-implementation; `--float` = original spreadsheet (no xx.xx rounding) |
| `reference_overdraft.py <scenarios.json> <fixture.json>` | Independent reference for the overdraft rules (SPEC D24, no spreadsheet equivalent): `python scripts/reference_overdraft.py scripts/overdraft_scenarios.json tests/fixtures/overdraft-reference.json` |
| `scrub_docprops.py <xlsx>` | Blanks author metadata without touching cached values |
| `dump_xlsx.py`, `dump_rows.py`, `diff_xlsx.py` | Inspect formulas/values; semantic diff of two workbook versions |
