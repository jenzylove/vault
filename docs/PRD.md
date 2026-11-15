# The Vault: PRD

**One liner:** You've seen what's in the box. The banker hasn't. Your face can lie. Your breath can't.

**Entry:** Presage SmartSpectra SDK Challenge (DEV x MLH). Category: Most Creative or Delightful Use (also eligible for Best Overall). Deadline Nov 22 2026, 11:59 PM PST.

## 1. Why this exists

Push your luck games (Deal or No Deal, Pig, Can't Stop) price risk with dice or board math. Bluffing games (poker) price it with faces, and faces can be trained. The Vault prices risk with the one tell you can't fully control: your breath. When you see a trap, your breath catches before your face moves. SmartSpectra is the only thing that can read that from an ordinary webcam.

Evidence the moment is real: the inhale before speech and the startle breath hold are documented turn taking and orienting responses (Wlodarczak and Heldner, Interspeech 2016; startle literature). In this game it's the core tell, and we measure whether it works (section 6) instead of assuming it.

## 2. The player and the front door

One person at a laptop with a webcam, playing alone, in a minute. First screen: ten sealed boxes, a banker, one line: "Sit still for 30 seconds so I can learn your calm." Consent screen before the camera turns on.

## 3. How a game plays (full scope)

1. **Learn your calm (30 s).** Silent baseline: breathing band, blink rate, resting expression mix, pulse.
2. **Two practice peeks, labelled.** One treasure, one trap, shown to the banker as known. The banker learns *your* tells from them, so it isn't guessing blind with three traps in ten.
3. **Ten boxes**, values shown on the board: five small treasures, two big treasures, three traps.
4. **Peek (8 s).** Only you see inside. 8 s covers at least one full breath cycle, so a normal pause between breaths is never read as a hold.
5. **The banker reads you and says why, out loud:** "Trap. Your breath stopped for 1.4 seconds." / "Big one. You smiled, but your breathing didn't change. I'm not sure."
6. **The banker decides:**
   - **Walks** (it believes trap): the box is burned. Lost to you, unopened, revealed at the end.
   - **Offers** a price from its own belief of what's inside, minus its margin.
7. **You decide:** **Sell** (take the offer; the box goes to the banker) or **Open** (you get what's inside).
8. **Heat and cash out (push your luck):** every trap the banker buys and discovers at its audit raises its suspicion, so it walks more often and offers less. After any box you can **Leave the vault** with your pile, or keep going.
9. **End:** every box revealed. Scoreboard: your pile, traps you sold, treasures the banker burned, the banker's correct calls against chance.

**What wins:** look safe at traps (sell them), and don't leak at treasures (or the banker burns them). Faking a big smile at a trap is easy; the banker learns from your practice peeks which of your signals actually predicted traps and weights them. For most people that's breath, so the face lies and the breath gives you away.

**What can't be gamed (proven in section 6 by a seeded probe):**
- Faking a gasp at treasure: the banker walks and the treasure is burned. It costs you.
- Freezing to look blank: freezing stops the breath, which reads as a catch.
- Holding your breath through every peek: an 8 s peek always contains a breath, so a hold is itself the tell.
- Feeding a recorded calm video (the SDK has a file mode): live camera only, plus one random cue per game ("blink twice"), checked live.

## 4. SmartSpectra signals, each only where it's accurate

| Signal | Timescale | Job |
|---|---|---|
| Raw chest breathing trace | real time | Main tell: a catch (sharp inhale then flat ≥1 s), shallowing, or rate change vs your band |
| Blinks | real time | Burst or stop vs your baseline |
| Expressions (8 probabilities) | real time | Joy, surprise and fear vs your resting mix; weighted low unless your practice peeks show they predict |
| Talking | real time | Talking during a peek counts as a leak, and pauses breath reading |
| Pulse | 12 s average | Slow heat across the game: rising pulse raises the banker's suspicion |
| Confidence and stable flags | per sample | Low confidence = no read; the banker says "I lost you" and treats the box as unread |

Remove SmartSpectra and the banker is plain board math. MediaPipe gives faces and blinks, but not the chest trace, and the chest trace is the tell that decides the game.

## 5. The judge's first minute

Install, paste a free Presage key, consent, 30 s calm, two practice peeks, first box. By about 70 s the banker has called your first box out loud with a reason, and you've chosen sell or open. Judges without a key get a labelled simulated body mode, clearly marked "simulated", so they can see the full loop.

## 6. Claims and how each is proven

| Claim | Proof |
|---|---|
| The banker reads real tells better than chance | Recorded consented sessions (several players) replayed through SDK file mode: banker accuracy vs 50% with a confidence interval; misses published |
| Breath predicts better than face | Same replays: accuracy with breath only, face only, both |
| No dominant exploit | Incentive probe: 500 seeded simulated players x strategies (honest, always steady, fake at treasure, freeze, hold breath, skilled bluffer). Skilled bluffing must win; faking and freezing must lose. Table published |
| Every number on screen changes an outcome | Probe checks each displayed stat feeds a decision |

## 7. Consent and data handling (required section of the DEV post)

Camera opt in screen before any capture; camera badge always visible; Esc turns the camera off. Frames are processed on device by the SDK and never saved. Only game results (pile, box outcomes) are stored, locally. Signal numbers live in memory for the session and are deleted at the end; one click wipes history. SDK telemetry: session summaries and device readiness reports, no video or vitals values (per Presage docs). No AI service is used; the banker is code. No lie detection or health claims: the copy says "tells", never "lies" or "stress".

## 8. What it does not do

No real money, no stakes, no accounts, no network beyond the SDK. Not a health or stress product. One player at a time (a second face pauses the game).

## 9. Sponsor checklist (becomes docs/SUBMISSION_CHECKLIST.md, ticked only from the running app)

- [ ] Working app integrates the SmartSpectra SDK
- [ ] Uses at least one live Presage signal (breath trace, blinks, expressions, pulse)
- [ ] Public repo with setup instructions
- [ ] Demo video showing the SDK and live signals
- [ ] DEV post with the template and #presagechallenge
- [ ] Sections: What I Built, Demo, Code, How It Responds to Human Signals, Prize Categories, Consent and Data Handling
- [ ] Category named in the post: Most Creative or Delightful Use
- [ ] No diagnosis, treatment, medical decision or covert monitoring
- [ ] English, solo, one entry

## 10. Risks

1. Does a cartoon trap cause a real breath catch? Unknown. Spike 1 decides it.
2. The banker learns from two practice peeks plus in game reveals: thin data. The probe and replays measure it honestly.
3. Free credits: 100 = 50 minutes total, renewing Dec 13 (after the deadline). All development runs on recorded signal replays, not the live SDK.
4. A judge may still think "another poker face game". The pitch leads with the breath, never says "poker" or "straight face".
