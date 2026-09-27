"""
One-off reference implementation of the plan_financier.xlsx logic (Phase 0, not shipped).

Purpose: prove that docs/SPEC.md describes the workbook exactly, by re-implementing
the formulas independently and diffing against every cached value in the file.

Usage:
    python scripts/reference_engine.py [path.xlsx]          # compare, print report
"""
from __future__ import annotations

import datetime as dt
import sys
from decimal import ROUND_HALF_UP, Decimal

import openpyxl

HORIZON = 300
# xx.xx rule (SPEC §4.0): round monthly interest, baseline interest, early-repayment share and
# the 'monthly needed' KPI to cents. False = the original spreadsheet (fractions of cents).
CENTS = True
LOAN_ROWS = range(5, 11)  # Crédits!5..10 -> 6 slots


# ---------------------------------------------------------------- helpers
def n(v) -> float:
    """Excel N(): numbers pass through, blanks/text -> 0."""
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def xround2(x: float) -> float:
    """Excel ROUND(x, 2): half away from zero, on the 15-digit decimal repr."""
    d = Decimal(repr(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(d)


def c2(x: float) -> float:
    """Round to cents only under the xx.xx rule."""
    return xround2(x) if CENTS else x


def edate(d: dt.datetime, months: int) -> dt.datetime:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    # clamp day (EDATE semantics)
    import calendar

    day = min(d.day, calendar.monthrange(y, m)[1])
    return d.replace(year=y, month=m, day=day)


def datedif_m(a: dt.datetime, b: dt.datetime) -> int | None:
    """DATEDIF(a, b, "m"); None = #NUM! (b < a)."""
    if b < a:
        return None
    months = (b.year - a.year) * 12 + (b.month - a.month)
    if b.day < a.day:
        months -= 1
    return months


# ---------------------------------------------------------------- inputs
def read_inputs(wb):
    b = wb["Budget"]
    budget = {
        "income": [n(b[f"B{r}"].value) for r in (4, 5, 6)],
        "fixed": [n(b[f"B{r}"].value) for r in range(10, 18)],
        "variable": [n(b[f"B{r}"].value) for r in range(21, 25)],
        "start": b["B28"].value,
        "movingGoal": n(b["B29"].value),
        "movingDeadline": b["B30"].value,
        "movingAlreadySaved": n(b["B31"].value),
        "emergencyTarget": n(b["B32"].value),
        "emergencyExisting": n(b["B34"].value),
        "thresholdRate": n(b["B35"].value),
        "earlyRepaymentPct": n(b["B36"].value),
    }
    c = wb["Crédits"]
    loans = []
    for r in LOAN_ROWS:
        loans.append(
            {
                "name": c[f"A{r}"].value,
                "type": c[f"B{r}"].value,
                "principal": c[f"C{r}"].value,  # raw: None means blank cell
                "apr": c[f"D{r}"].value,
                "payment": c[f"E{r}"].value,
                "months": c[f"F{r}"].value,
            }
        )
    return budget, loans


# ---------------------------------------------------------------- engine
def credits_derived(budget, loans):
    out = []
    for L in loans:
        C, D, E, F = L["principal"], L["apr"], L["payment"], L["months"]
        blankC = C is None or C == ""
        G = None if blankC else n(E) * n(F)
        H = None if blankC else max(0.0, n(E) * n(F) - n(C))
        I = None if (blankC or F is None or F == "") else edate(budget["start"], int(n(F)))
        if n(C) <= 0:
            J = None
        else:
            J = "Oui" if n(D) > budget["thresholdRate"] else "Non"
        if n(C) <= 0:
            Lc = None
        elif n(D) >= 0.1:
            Lc = "Taux élevé : à solder en priorité"
        elif J == "Oui":
            Lc = "Remb. anticipé intéressant (vérifier IRA)"
        else:
            Lc = "Garder, épargner plutôt"
        out.append({"G": G, "H": H, "I": I, "J": J, "L": Lc})
    # priority K: rank among "Oui" by APR desc, ties by row order
    for i, row in enumerate(out):
        if row["J"] != "Oui":
            row["K"] = None
            continue
        di = n(loans[i]["apr"])
        higher = sum(1 for j, o in enumerate(out) if o["J"] == "Oui" and n(loans[j]["apr"]) > di)
        ties_before = sum(1 for j in range(i) if out[j]["J"] == "Oui" and n(loans[j]["apr"]) == di)
        row["K"] = higher + ties_before + 1
    totC = sum(n(L["principal"]) for L in loans)
    totals = {
        "C": totC,
        "D": (sum(n(L["principal"]) * n(L["apr"]) for L in loans) / totC) if totC else 0.0,
        "E": sum(n(L["payment"]) for L in loans),
        "G": sum(o["G"] or 0 for o in out),
        "H": sum(o["H"] or 0 for o in out),
    }
    return out, totals


def simulate(budget, loans, derived):
    income = sum(budget["income"])
    expenses = sum(budget["fixed"]) + sum(budget["variable"])
    prio = [d["K"] for d in derived]
    k = len(loans)
    bal = [max(0.0, n(L["principal"])) for L in loans]
    base = [max(0.0, n(L["principal"])) for L in loans]
    H_prev, J_prev, O_prev = budget["movingAlreadySaved"], budget["emergencyExisting"], 0.0
    plan, calc = [], []
    for m in range(1, HORIZON + 1):
        date = edate(budget["start"], m - 1)
        B = bal[:]
        Cint = [c2(B[i] * n(loans[i]["apr"]) / 12) for i in range(k)]
        Dpay = [min(n(loans[i]["payment"]), B[i] + Cint[i]) for i in range(k)]
        Eaft = [xround2(B[i] + Cint[i] - Dpay[i]) for i in range(k)]
        # baseline
        Ib = [c2(base[i] * n(loans[i]["apr"]) / 12) for i in range(k)]
        Hb = [xround2(base[i] + Ib[i] - min(n(loans[i]["payment"]), base[i] + Ib[i])) for i in range(k)]
        # plan part 1
        E = sum(Dpay)
        F = income - expenses - E
        if date <= budget["movingDeadline"]:
            G = max(0.0, min(F, budget["movingGoal"] - H_prev))
        else:
            G = 0.0
        H = H_prev + G
        I = max(0.0, min(F - G, budget["emergencyTarget"] - J_prev))
        J = J_prev + I
        K = max(0.0, F - G - I)
        Lr = c2(K * budget["earlyRepaymentPct"])
        # early repayment allocation (avalanche)
        Fx = []
        for i in range(k):
            if prio[i] is None:
                Fx.append(0.0)
                continue
            ahead = sum(Eaft[j] for j in range(k) if j != i and prio[j] is not None and prio[j] < prio[i])
            Fx.append(max(0.0, min(Eaft[i], Lr - ahead)))
        Gend = [xround2(Eaft[i] - Fx[i]) for i in range(k)]
        AY = sum(Fx)
        M = max(0.0, Lr - AY)
        N = K - Lr + M
        O = O_prev + N
        P = sum(Gend)
        plan.append(
            dict(A=m, B=date, C=income, D=expenses, E=E, F=F, G=G, H=H, I=I, J=J, K=K, L=Lr, M=M, N=N, O=O, P=P,
                 Q="Budget négatif !" if F < 0 else None,
                 R=1 if H >= budget["movingGoal"] else 0,
                 S=1 if J >= budget["emergencyTarget"] else 0,
                 T=1 if P <= 0.01 else 0)
        )
        calc.append(dict(B=B, C=Cint, D=Dpay, E=Eaft, F=Fx, G=Gend, H=Hb, I=Ib,
                         AX=E, AY=AY, AZ=P, BA=sum(Cint), BB=sum(Ib)))
        bal, base = Gend, Hb
        H_prev, J_prev, O_prev = H, J, O
    return plan, calc


def synthese(budget, loans, derived, totals, plan, calc):
    income = sum(budget["income"])
    exp = sum(budget["fixed"]) + sum(budget["variable"])
    B6 = totals["E"]
    B4, B5 = income, exp
    B7 = B4 - B5 - B6
    B8 = B6 / B4 if B4 else 0.0
    B9 = "Au-dessus de 35 %" if B8 > 0.35 else ("Proche du seuil" if B8 > 0.3 else "OK")
    dd = datedif_m(budget["start"], budget["movingDeadline"])
    B15 = 0.0 if dd is None else c2(max(0.0, budget["movingGoal"] - budget["movingAlreadySaved"]) / max(1, dd + 1))
    idx = [i for i, p in enumerate(plan) if p["B"] <= budget["movingDeadline"]]
    B16 = plan[idx[-1]]["H"] if idx else budget["movingAlreadySaved"]

    def first(flag, default):
        for p in plan:
            if p[flag] == 1:
                return p["B"]
        return default

    B17 = first("R", "Non atteint")
    B18 = "Objectif tenu" if B16 >= budget["movingGoal"] else "Objectif NON tenu : réduire dépenses ou décaler la date"
    B22 = first("S", "Non atteint (25 ans)")
    B25 = "Aucune dette" if totals["C"] <= 0 else first("T", "Au-delà de 25 ans")
    B26 = sum(c["BB"] for c in calc)
    B27 = sum(c["BA"] for c in calc)
    return {
        "B4": B4, "B5": B5, "B6": B6, "B7": B7, "B8": B8, "B9": B9, "B10": totals["C"], "B11": totals["D"],
        "B14": budget["movingGoal"], "B15": B15, "B16": B16, "B17": B17, "B18": B18,
        "B21": budget["emergencyTarget"], "B22": B22, "B25": B25,
        "B26": B26, "B27": B27, "B28": B26 - B27,
        "B31": plan[11]["O"], "B32": plan[11]["J"], "B33": plan[11]["P"],
        "B34": sum(1 for p in plan if p["Q"]),
    }


def run(wb):
    budget, loans = read_inputs(wb)
    derived, totals = credits_derived(budget, loans)
    plan, calc = simulate(budget, loans, derived)
    syn = synthese(budget, loans, derived, totals, plan, calc)
    return budget, loans, derived, totals, plan, calc, syn


# ---------------------------------------------------------------- compare
CALC_BLOCKS = ["B", "J", "R", "Z", "AH", "AP"]  # first column of each loan block
SUB = ["B", "C", "D", "E", "F", "G", "H", "I"]


def col_offset(col: str, off: int) -> str:
    from openpyxl.utils import column_index_from_string, get_column_letter

    return get_column_letter(column_index_from_string(col) + off)


def same(a, b, tol):
    if a is None or a == "":
        return b is None or b == "" or b == 0
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= tol
    if isinstance(a, dt.datetime) and isinstance(b, dt.datetime):
        return a.date() == b.date()
    return a == b


def compare(path: str, tol: float = 1e-6):
    wv = openpyxl.load_workbook(path, data_only=True)
    budget, loans, derived, totals, plan, calc, syn = run(wv)
    errors, checked, maxdiff = [], 0, 0.0

    def chk(sheet, coord, mine):
        nonlocal checked, maxdiff
        xl = wv[sheet][coord].value
        checked += 1
        if isinstance(xl, (int, float)) and isinstance(mine, (int, float)):
            maxdiff = max(maxdiff, abs(xl - mine))
        if not same(xl, mine, tol):
            errors.append((sheet, coord, xl, mine))

    for i, r in enumerate(LOAN_ROWS):
        for col in "GHIJKL":
            chk("Crédits", f"{col}{r}", derived[i][col])
    for col in "CDEGH":
        chk("Crédits", f"{col}11", totals[col])
    for mi, p in enumerate(plan):
        r = 5 + mi
        for col in "ABCDEFGHIJKLMNOPQRST":
            chk("Plan", f"{col}{r}", p[col])
    for mi, c in enumerate(calc):
        r = 3 + mi
        for li, start in enumerate(CALC_BLOCKS):
            for si, key in enumerate(SUB):
                chk("Calcul", f"{col_offset(start, si)}{r}", c[key][li])
        for key in ("AX", "AY", "AZ", "BA", "BB"):
            chk("Calcul", f"{key}{r}", c[key])
    for coord, v in syn.items():
        chk("Synthèse", coord, v)
    return checked, errors, maxdiff


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--float"]
    if "--float" in sys.argv:
        CENTS = False
    path = args[0] if args else "docs/plan_financier.template.xlsx"
    checked, errors, maxdiff = compare(path)
    print(f"{path}: checked {checked} cells, {len(errors)} mismatches, max |diff| on numbers = {maxdiff:.3e}")
    for e in errors[:40]:
        print("  MISMATCH", e)


# ---------------------------------------------------------------- suivi réel
SUIVI_ROWS = range(6, 30)  # 24 months: Suivi réel!6..29 <-> Plan!5..28


def suivi(wb, budget, totals, plan):
    """Re-implements Suivi réel!M:V and Synthèse!B37:B40 from the raw inputs B:L."""
    s = wb["Suivi réel"]
    rows = []
    for r in SUIVI_ROWS:
        raw = [s.cell(r, c).value for c in range(2, 13)]  # B..L
        filled = any(isinstance(v, (int, float)) for v in raw)
        if not filled:
            rows.append({"row": r, "filled": False, "V": 0})
            continue
        p = plan[r - 6]
        M = sum(n(v) for v in raw[5:11])
        N = p["P"]
        P = sum(n(v) for v in raw[2:5])
        Q = p["H"] + p["J"] + p["O"]
        O, R = M - N, P - Q
        S = min(1.0, n(raw[2]) / budget["movingGoal"]) if budget["movingGoal"] else 0.0
        T = max(0.0, 1 - M / totals["C"]) if totals["C"] else 0.0
        if O <= 10 and R >= -10:
            U = "✅ Dans les temps"
        elif O > 10 and R < -10:
            U = "🔴 En retard"
        else:
            U = "🟠 Mitigé"
        rows.append({"row": r, "filled": True, "M": M, "N": N, "O": O, "P": P, "Q": Q, "R": R, "S": S, "T": T, "U": U, "V": r})
    last = max(x["V"] for x in rows)
    syn = {
        "B37": "Aucune saisie" if last == 0 else plan[last - 6]["B"],
        "B38": 0 if last == 0 else rows[last - 6]["O"],
        "B39": 0 if last == 0 else rows[last - 6]["R"],
        "B40": "—" if last == 0 else rows[last - 6]["U"],
    }
    return rows, syn


def compare_suivi(path: str, tol: float = 1e-6):
    wv = openpyxl.load_workbook(path, data_only=True)
    budget, loans, derived, totals, plan, calc, syn = run(wv)
    rows, ssyn = suivi(wv, budget, totals, plan)
    errs, checked = [], 0
    for x in rows:
        for col in "MNOPQRSTUV":
            mine = x.get(col) if x["filled"] else (0 if col == "V" else None)
            checked += 1
            if not same(wv["Suivi réel"][f"{col}{x['row']}"].value, mine, tol):
                errs.append((f"{col}{x['row']}", wv["Suivi réel"][f"{col}{x['row']}"].value, mine))
    for k, v in ssyn.items():
        checked += 1
        if not same(wv["Synthèse"][k].value, v, tol):
            errs.append((k, wv["Synthèse"][k].value, v))
    return checked, errs, rows, ssyn
