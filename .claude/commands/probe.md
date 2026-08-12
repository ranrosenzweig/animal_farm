---
description: Run a long simulation of the farm and report what it says about balance.
argument-hint: "[--steps N] [--herd N] [--stocked]"
---

Run `npm run probe -- $ARGUMENTS`.

Defaults are 800 steps with one of each species and no replenishment. Useful
variations:

- `--herd 2 --stocked` — the healthy case. Pairs can breed and nothing starves,
  so anything that looks wrong here is a real model problem rather than the
  farm simply running out.
- `--steps 2000` — slow failures. Drives cycle over hundreds of steps; a
  problem that only appears at step 1400 is invisible in a short run.
- no flags — the survival case, where sources deplete and animals die.

## Then read it, don't just paste it

Report what the numbers mean, in plain sentences. The output's own "Worth a
look" section is a starting point, not a verdict — some of its warnings are
expected for the configuration that was run. Specifically:

- **A pinned drive** (100% for much of the run) matters when nothing relieves
  it *and* it distorts what animals choose. With `--herd 1` no animal has a
  possible mate, so a pinned `urge` there is expected, not a fault.
- **A goal at 0%** is a real problem if some species has an affinity for it —
  that has twice meant a goal was unreachable by construction.
- **A goal above roughly a third of all steps** is worth suspicion. It once
  meant `mate` was crowding out drinking and animals were dying of thirst with
  water still in the field.
- **Deaths with stock remaining** mean animals could not reach what they
  needed, not that the farm ran out. Say which.
- **Overlaps above zero** is never acceptable; it breaks the core invariant.

Runs vary — the model is stochastic and there is no seed. If something looks
off, run it again before concluding anything, and say when you're reading one
sample rather than a pattern.

Finish with a plain statement: either the farm looks balanced, or here is the
specific thing that doesn't and what it implies. If a fix is obvious, say what
it would be — don't apply it unless asked.
