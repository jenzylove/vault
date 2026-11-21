# The Vault: PRD

**One liner:** You've seen what's in the box. The banker hasn't. Your face can lie. Your breath can't.

**Entry:** Presage SmartSpectra SDK Challenge (DEV x MLH). Category: Most Creative or Delightful Use (also eligible for Best Overall). Deadline Nov 22 2026, 11:59 PM PST.

## 1. Why this exists

Push your luck games (Deal or No Deal, Pig, Can't Stop) price risk with dice or board math. Bluffing games (poker) price it with faces, and faces can be trained. The Vault prices risk with the one tell you can't fully control: your breath. When you see a trap, your breath catches before your face moves. SmartSpectra is the only thing that can read that from an ordinary webcam.

Evidence the moment is real: the inhale before speech and the startle breath hold are documented turn taking and orienting responses (Wlodarczak and Heldner, Interspeech 2016; startle literature). In this game it's the core tell, and we measure whether it works (section 6) instead of assuming it.

## 2. The player and the front door

One person at a laptop with a webcam, playing alone, in a minute. Title, consent, line up in the camera (live), then 10 seconds of calm with one line on screen: "Breathe normally. He is learning you." Then the boxes. The goal sits on screen in one line the whole run: "Goal: bank 2,200 in 5 boxes, he catches at most 1 trap."

## 3. How a run plays (about two minutes)

1. **Learn your calm (10 s).** Silent baseline: breathing band, normal pause length, blink rate, resting expression mix, pulse. Ten seconds is two or three breaths, so the normal pause gets 20% head room and the blink rate leans on a typical rate until more is seen.
2. **How it works (optional).** Two labelled practice peeks, one treasure and one trap, shown to the banker as known. Offered on a player's first game (skippable), off by default after that, one key to turn back on during the calm.
3. **Ten boxes on the table, five peeks a run.** Values on the board: five small treasures, two big treasures, three traps. You pick five; the rest are revealed at the end.
4. **Peek (5 s).** Only you see inside. Your breath line runs big in the middle of the screen. 5 s still holds a full breath for anyone breathing 12 or more times a minute, so a normal pause is never read as a hold.
5. **He reads you live.** While you look, he watches the line. The moment a hold runs past your own longest normal pause, he has seen it: the line turns ember, "He saw that.", and the room reacts (he leans to the glass, the lamp flares). His suspicion and your real pulse drive the scene and a low heartbeat.
6. **The banker decides:**
   - **Walks** (it believes trap): the box is burned. Lost to you, revealed at the end.
   - **Offers** a price from its belief of what's inside, minus its margin. He says why, out loud.
7. **You decide:** **Sell** (take the offer; the box goes to the banker) or **Open** (you get what is inside).
8. **The catch replay, after every box.** Your breath trace for that peek, drawn big, with what he measured marked on it: the hold and its length, blinks, shallowing, pulse, face, whatever this banker reads and actually moved. One line in his voice, from the real numbers: "There. You stopped breathing for 1.4 seconds. I knew." or "I saw nothing. You got me." It goes on by itself after about 3 seconds.
9. **Heat and cash out:** every trap the banker buys and finds at its audit adds half his heat; sell him two and he throws you out with nothing. "I lost you" adds a fifth. After any box you can **Leave** with your pile.
10. **End:** he names your tell in one sentence ("You hold your breath when you see a trap."), says whether you hid it better than last time, and what unlocks next.

**What wins:** look safe at traps (sell them), and don't leak at treasure (or the banker burns it). Faking a big smile at a trap is easy; the banker gives the face no weight until your own boxes show it means something, and an exaggerated smile counts no more than a typical one.

**What can't be gamed (proven in section 6 by a seeded probe):**
- Faking a gasp at treasure: the banker walks and the treasure is burned. It costs you.
- Freezing to look blank: freezing stops the breath, which reads as a catch.
- Holding your breath through every peek: a 5 s peek always contains a breath, so a hold is itself the tell.
- Ducking out of the camera: an unread box gets a blind half price offer, adds heat, never pays the heist, and a trap he lost you at counts as caught.
- Feeding a recorded calm video (the SDK has a file mode): live camera only, plus one random cue per game ("blink twice"), checked live.

## 3b. Why you come back (the reward loop)

1. **He remembers you.** The end of every run names your top tell. The next run opens with it: "Last time you held your breath at traps. I am watching for that now." The end screen says whether you hid it better than last time, with the numbers (1.6 seconds at traps last time, 0.6 now). Only summary numbers are kept, on this computer.
2. **Career ladder of bankers.** Five banks, each reads more and learns faster: Bank 1 reads breath only; Bank 2 adds blinks; Bank 3 adds face; Bank 4 adds pulse heat; Bank 5 reads everything with the strongest learning. Beat a banker in one run of 5 boxes to open the next:

| Bank | Rank | Bank at least | He may catch | He may burn |
|---|---|---:|---:|---:|
| I | Pickpocket | 2,200 | 1 trap | 1 treasure |
| II | Cutpurse | 2,400 | 1 trap | 1 treasure |
| III | Cracksman | 2,400 | 1 trap | 1 treasure |
| IV | Safecracker | 2,600 | no trap | 1 treasure |
| V | Ghost | 3,000 | no trap | 1 treasure |

3. **Daily vault.** Same seeded box layout for everyone each day. The share card carries your tell: "My tell: I hold my breath. Can you hide yours?"

Loop: run (2 minutes) → he shows you exactly where he caught you → he names your tell → next run he watches for it → you hide it → you beat a harder banker.

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

Install, paste a free Presage key, consent, line up, 10 s calm, first box. By about 30 s the banker has read your first peek live, called it out loud with a reason, and shown you the replay of your own breath with the moment he read marked. A full run is about two minutes. Judges without a key get a labelled simulated body mode, clearly marked "simulated", so they can see the full loop.

## 6. Claims and how each is proven

| Claim | Proof |
|---|---|
| The banker reads real tells better than chance | Recorded consented sessions (several players) replayed through SDK file mode: banker accuracy vs 50% with a confidence interval; misses published |
| Breath predicts better than face | Same replays: accuracy with breath only, face only, both |
| No dominant exploit | Incentive probe (docs/probe.md): 400 seeded simulated players x 8 strategies x 5 banks, 5 box runs. Steady breath control beats honest play at every bank (+19% pile at Bank III); faking a gasp, freezing, holding the breath, hiding and ignoring heat all lose; no faking strategy beats the banker more often than an honest player. Table published |
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
2. The banker learns from in game reveals (and two optional practice peeks): thin data, and a 10 s calm is short. The probe and replays measure it honestly.
3. Free credits: 100 = 50 minutes total, renewing Dec 13 (after the deadline). All development runs on recorded signal replays, not the live SDK.
4. A judge may still think "another poker face game". The pitch leads with the breath, never says "poker" or "straight face".
