# The Vault: build plan

Deadline Nov 22 2026, 11:59 PM PST (Nov 23 07:59 UTC). Today Nov 15.

## Credit budget (100 credits = 50 min total, no renewal before the deadline)

| Use | Credits |
|---|---|
| Spike 1: recorded peek sessions processed once | ~10 |
| Spike 2: live Electron smoke test | ~2 |
| Replay set for the published numbers | ~15 |
| Live play testing | ~25 |
| Demo video recording | ~15 |
| Reserve | ~33 |

Rule: every recording is processed through the SDK **once** and its metrics saved to JSONL. All engine work, the probe and UI testing run on those replays at zero credits.

## Phases (each ends on a check)

**0. Setup (Nov 15).** Private repo jenzylove/vault, .gitignore, PRD and plan. *Check:* repo exists, nothing secret committed.

**1. Spike: does the tell exist? (Nov 15 to 16, needs the owner)** The owner records a session with the Windows Camera app: 30 s calm, then 12 peeks at real trap and treasure cards shown on screen by a small peek script, saying nothing. Then ideally one more person does the same. Each clip is processed once in file mode (the spike tool in ~/presage-spike already works). *Check:* chest trace, blink and expression features separate traps from treasures better than chance for that person. Written to docs/spikes/tell.md with the plots. **Gate:** if no tell shows, stop and bring a changed plan.

**2. Spike: live in Electron (Nov 16).** Renderer SDK with useMediaStream on this PC; measure metrics latency and batch timing. *Check:* live chest trace drawn on screen with under 1 s lag.

**3. Engine, pure functions with tests (Nov 16 to 17).** Feature extraction (catch, shallowing, rate change, blink burst, expression delta, talking, confidence gate); per player tell weights from baseline and practice peeks; banker belief, walk threshold, offer, heat; game state machine. Unit tests on recorded replays. *Check:* tests pass; replays produce banker calls.

**4. Incentive probe (Nov 17).** 500 seeded simulated players x 6 strategies. *Check:* skilled bluffing wins; faking, freezing and breath holding lose; every displayed stat changes an outcome. Table saved to docs/probe.md.

**5. App (Nov 17 to 19).** Electron app: consent, baseline, practice peeks, board, peek, banker voice and reason, sell/open, heat, leave the vault, reveal, scoreboard, end card image, liveness cue, simulated body mode for keyless judges, camera off. Design last but premium: its own visual identity, motion, dark and light. UI delegated to an Opus agent against the engine interface; reviewed and driven by hand. *Check:* a full game plays live, every state screenshot reviewed.

**6. Proof (Nov 19 to 20).** Replay set from several consenting players: banker accuracy vs chance, breath vs face ablation, misses. *Check:* docs/results.md with real numbers.

**7. Audit (Nov 20).** release-readiness-audit skill; fix every finding; secrets scan of git history. *Check:* audit clean.

**8. Owner approval gate (Nov 20).**

**9. Launch (Nov 21 to 22).** README (hero, how it works, judge fast path, what is real, consent and data), demo video via the demo-film skill from real recordings, DEV post with every template section, repo public. *Check:* everything in SUBMISSION_CHECKLIST ticked from the live app. Submit by Nov 22 evening, ahead of the deadline.

## Risks

| Risk | Status |
|---|---|
| A cartoon trap may not cause a breath catch | needs a spike (Phase 1) |
| Electron renderer SDK on this Windows PC | needs a spike (Phase 2) |
| Talking flag weak (another entrant saw 10 to 12% recall) | known: used only as a minor leak |
| Thin per player data for the banker | known: practice peeks plus measured honestly |
| Credit budget | known: replay first rule |
| "Poker face" first impression | known: pitch leads with breath |
