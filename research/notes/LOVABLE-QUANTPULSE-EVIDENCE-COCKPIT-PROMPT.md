# Lovable QuantPulse Evidence Cockpit Parity Prompt

Target project: `d92c8131-2a93-43cb-bda7-e61c8dff234b`

Published Lovable URL: `https://quantpulse-trade-lab.lovable.app/`

Use this as one Lovable prompt when the agent-message endpoint/editor is available.

```text
Update this QuantPulse Landing project in-place. Preserve the current minimalist Lovable design, spacing, typography, and two big dashboard cards. Do not redesign and do not add a dense dashboard. This is read-only front-end work only.

Use this live API for data:
https://live-agent-dashboard-web-production.up.railway.app/api/live-agent/dashboard

Keep the main interaction simple: two large cards/buttons for REAL / IBKR and SHADOW / RESEARCH. Add a compact evidence layer so the landing page answers “am I learning an edge?” without opening another page.

Add or adjust these sections:

1. A small “What do I know today?” panel with five short cards:
   - Evidence level
   - Best current hypothesis
   - Biggest blocker
   - What changed
   - Next useful sample

2. A compact context bar:
   - As of `generated_at` in Edmonton time
   - Today / This week / 30 days / All time
   - REAL and SHADOW separated
   - open REAL positions

3. A simple daily scorecard table below the main cards:
   - Date
   - REAL trades
   - Wins/Losses
   - Gross
   - Fees
   - Net
   - SHADOW complete

Data mapping:

- REAL: `real.closed_n` or `real.n`, `real.open_n`, `real.wins`, `real.losses`, `real.win_rate`, `real.gross_pnl`, `real.commissions`, `real.net_pnl`, `real.daily_journal`.
- SHADOW: `shadow.priced_n`, `shadow.pending_or_unpriced_n`, `shadow.total_rows_diagnostic`, `shadow.horizon_ladder`.
- Broker blocker: `account_capital.snapshot_status`.

Required interpretation:

- REAL and SHADOW must stay visually and numerically separate. Never combine P&L, win rate, or `n`.
- Every performance figure should show `n`, `DATA UNAVAILABLE`, or `n=0`.
- Trust labels:
  - `n < 8` = Anecdote
  - `8 <= n < 30` = Hypothesis only
  - `n >= 30` with blockers = Watch
  - fully trusted = Reviewable evidence
  - contaminated/broken = Rejected
- If `real.gross_pnl > 0` and `real.net_pnl <= 0`, say:
  - “Gross drift exists, net edge does not.”
  - “Does not survive the $10k / ~$2.5k-position cost frame yet.”
- Do not say “edge confirmed,” “strategy works,” “deploy,” or final proof. Use “hypothesis,” “watch,” “blocked,” “examples only,” and “reviewable evidence.”

Do not write to Supabase, Railway, broker, Telegram, trade tables, or backend. No strategy/sizing/stop/order changes.

Acceptance criteria:

- Main page still looks like the current Lovable template on first glance.
- Two dashboard cards remain the primary interaction.
- The page answers:
  - what do we know today;
  - can we trust it;
  - is gross positive;
  - does it survive costs;
  - what should be tested next.
- REAL and SHADOW remain visually and numerically separate.
- No production/runtime/trading behavior changes.
```

## Current blocker observed by Codex

On 2026-07-25, the Lovable project read/status endpoints worked:

- `get_project` returned project status `completed`, published URL `https://quantpulse-trade-lab.lovable.app`, latest commit `079968a148c01169efb9ead04f7e84d19f367641`.
- `list_edits` worked and showed the latest edit history.
- Public Lovable render worked and showed the simple “Pick a dashboard” landing page.

But `send_message` to the Lovable agent returned `INVALID_ARGUMENT` even for a tiny plan-only message. Chrome editor automation also stalled on Lovable’s loading skeleton, so Codex did not make blind edits or burn prompts.

