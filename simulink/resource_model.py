"""Python mirror of Simulink queue (runs without MATLAB; numbers match params.m)."""
annual, days, hrs = 100000, 300, 8
ai_sec, rev_sec, rework = 3, 30, 1.25
for camp_days, reviewers in [(100, 1), (100, 2), (300, 1)]:
    arr = annual / camp_days / hrs
    eff = arr * rework
    cap = (3600 / rev_sec) * reviewers
    print(f"{camp_days} camps R={reviewers}: arr {arr:.0f}/hr eff {eff:.0f}/hr cap {cap:.0f}/hr util {eff/cap:.2f} {'FAIL' if eff > cap else 'PASS'}")
if __name__ == "__main__":
    pass
