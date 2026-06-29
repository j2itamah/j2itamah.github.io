# OPERATING RULES & BUG-RECORDING CONVENTIONS — every agent follows (Claude Code, Devin, Cursor, AG)

**Canonical rules every agent must follow. Read this before any work. Source: TRA-141.**

### Bug recording & auditing (the discipline)

1. **Every bug/finding → a Linear issue immediately**, in the correct project: AG project = Build B engine; "Trading Analyst V2 Build Cockpit" = Build A + dashboards + shared. Include repro steps + live evidence (the actual number/log/screenshot).
2. **Document all work as before/after comments** on the matching ticket. Linear is THE brain — no separate docs, no new projects.
3. **Re-verify before closing.** A ticket is done only when confirmed against the LIVE system (API/SQL/site), not when code is written. Link related issues.
4. **Audit over time** against the master checklist (TRA-140); new repeat bugs get tracked, not re-discovered.

### Engineering rules

 5. **Verify live; never trust "done" or the green health bar.** Cache-bust. Check the clock/market state before calling anything "expected." (Health = liveness, not correctness — TRA-131.)
 6. **Fix once, apply everywhere (TRA-129):** a fix found anywhere (esp. CryptoLab) → propagate across both builds + all matrix books; verify it took in each.
 7. **Build integrity:** shadow-run, NEVER wipe/reset, append-only ledger, reconcile-by-replay. Additive changes only; don't break the working dashboard (parallel rollouts).
 8. **Isolation & security:** Build B engine NEVER touches Supabase; the unified agent may edit Build A/Supabase but must not cross-wire the builds; **never put the Supabase service_role key in any front-end** (public ANON key + RLS only).
 9. **Routing:** X/Twitter → CryptoLab only; news-crypto + CL → main matrix 24/7.
10. **Don't ship DATA through Git** (use live feeds; TRA-139); keep Git for CODE only.

### Working method (root-cause → prevent → fix-on-sight) — ALWAYS

12. **Root-cause, then prevent — every time.** For every bug/finding: diagnose the underlying ROOT cause (not the surface symptom), fix the root, AND add a preventative measure — a health check, guardrail, assertion, or test — so the whole CLASS of failure cannot silently recur. A fix without a prevention is incomplete. When a problem keeps recurring (e.g. "info not displaying"), stop patching instances and find the systemic root (e.g. data-contract mismatch + split data store).
13. **Prevention parity across BOTH builds.** The root fix AND its preventative measure go to Build A and Build B (and all matrix books) — TRA-129 explicitly includes the prevention, not just the patch.
14. **Fix-on-sight during click-throughs/audits.** When clicking through screens or auditing, proactively FIX issues you notice — don't just log them — **especially on the Health/Diagnostics pages** (false green/red, empty/0/undefined panels, "Invalid Date"). If a fix genuinely needs review first, file it AND flag it immediately; never leave a noticed defect unaddressed.

### Standing behavior (TRA-155)

15. **Linear is the durable error queue.** Every session/loop, list open Linear issues labeled "watchdog" and work them per rules 12-14 (root-cause → fix → prevent, both builds). The watchdog auto-logs system errors to Linear; agents always check for open watchdog issues before starting other work.

### The goal (what every change serves)

11. Prove a **measurable, net-of-cost edge per vertical** (Crypto/Political/AI/Quantum) on both builds → **prop-firm-ready** (TRA-138 thresholds: profit factor >1.3, positive net expectancy, drawdown within prop limits, sufficient sample). Honest measurement above all.
