---
name: extending-the-farm
description: Use when adding or changing a species, goal, drive, or resource kind in the animal farm model. Each of these spans several files, and the steps that are easiest to forget fail silently — the animal simply never breeds, never feels a drive, or never appears in a control — rather than throwing.
---

# Extending the farm

The model is layered, and each layer only talks to the next one down:

```
drives ──▶ Mind.decide(percept) ──▶ goal ──▶ place ──▶ heading ──▶ Farm.isClear
 feel          choose                        steer            act    arbitrate
```

Two rules hold everywhere and are worth checking any change against:

- **Only the Farm sees everyone.** Anything involving two animals — collision,
  mating, finding a source — is arbitrated by `Farm`, because an animal cannot
  verify facts about another one. Don't add a method that reaches from one
  animal into another.
- **A Mind's percept is plain data.** No live objects in `perceive()`. It has
  to stay serializable, or a non-scripted mind can't be handed it.

## The silent-failure rule

**A species subclass overrides the *whole* static object, not individual keys.**
`Cow.affinities` replaces `Animal.affinities` entirely — a key you leave out is
simply absent, reads as `undefined`, and the behavior quietly never happens. No
error, no warning. This is the single most common way to half-add a feature
here, and it has bitten twice already.

| Omitted from a species | What happens |
|---|---|
| `affinities.mate` | never breeds — `mate` is filtered out of its options |
| `driveRates.urge` | the drive never rises, so it never wants that goal |
| `affinities.<new goal>` | the goal exists but that species never picks it |
| `intake` | silently inherits the base 0.6 mouthful |

When you add a key to `Animal`'s `affinities` or `driveRates`, **add it to all
six species files too.**

## Adding a species

1. `src/model/animals/<Name>.js` — extend `Animal`. Statics: `species`, `emoji`,
   `color`, `diet`, `breeds`, `names`, `stepSize`, `radius`, `turnRate`,
   `affinities`, `driveRates`, `intake`. Override `makeSound()`, `move()`, and
   `getAttributes()`; add `roamHeading()` only if it should move distinctively
   with nowhere to be, and `dailyProduce()` if it yields something.
2. `src/model/species.js` — add to the `SPECIES` array **and** to the named
   re-export list at the bottom. Both, or `import { Goat }` fails elsewhere.
3. `src/sources.js` — add the `?raw` import and its entry in the `SOURCE` map,
   or the UI's "View source" shows nothing for it.
4. `npm run check`.

Copy the shape from an existing file: `Cow.js` is the plainest, `Horse.js`
shows a `roamHeading()` override.

## Adding a goal

1. `src/model/goals.js` — a `GOALS` entry. Fields: `relieves` (a drive name, or
   omit for one that satisfies nothing), `place(animal, context)` returning a
   point or `null`, `narrate(animal)`. Optional: `satisfied()` when arriving
   somewhere isn't the test, `anywhere`, `still`, `passive`, `consumes`,
   `worth()` when being there earns less than the full relief (`flock` pays
   less among strangers).
   For a goal served by a depleting resource, spread `fromSource(kind)`.
2. **Every species' `affinities`, plus `Animal.affinities`** — see the silent-
   failure rule. A goal nobody has an affinity for can never be chosen.
3. If it relieves a *new* drive, follow "Adding a drive" as well.
4. `src/FarmModel.jsx` — add it to `GOAL_ICONS`, or it renders as `•`.
5. `npm run check` — `GOAL_NAMES` is audited, so a typo'd goal name fails.

`place` returning `null` means "nowhere in particular": the animal falls
through to `roamHeading()` and its drive keeps climbing. That is the correct
behavior when the thing it wants doesn't exist — don't special-case it.

## Adding a drive

1. `src/model/drives.js` — add to `DRIVES` and `DRIVE_LABELS`.
2. **Every species' `driveRates`, plus `Animal.driveRates`.** A missing rate is
   `?? 0`, so the drive sits at its starting value forever.
3. Make sure some goal `relieves` it. A drive nothing relieves climbs to 100%
   and pins there — which is what happened to `loneliness` before `flock` could
   actually be satisfied. Audit it: run several hundred steps and check the
   drive's range, not just that it exists.
4. Only `hunger` and `thirst` are fatal (`Animal.wear()`). Adding a drive does
   not make it lethal unless you say so.

The UI renders one bar per entry in `DRIVES` automatically — nothing to add.

## Adding a resource kind

1. `src/model/Resource.js` — an entry in `RESOURCE_KINDS` (`capacity`, `spread`,
   `color`, `unit`, `names`).
2. A goal that consumes it, via `fromSource("<kind>")` in `goals.js`.
3. `src/FarmModel.jsx` — add to `RESOURCE_ICONS`, **and** to the hardcoded
   `["water", "grass"]` array that renders the "Put down" buttons. That array
   should really read from `RESOURCE_NAMES`; until it does, a new kind exists
   in the model with no way to place it in the UI.

## Verifying

`npm run check` is the gate, and it is not a smoke test — it audits, every
round, that nobody overlaps, leaves the field, sidesteps, outruns its stride,
wants a goal that doesn't exist, or holds a drive outside 0–1; that no resource
is drawn below empty; that an empty field kills everything on it; and that
pairs breed their own species and nothing else.

Run all three before committing:

```sh
npm run check   # invariants, ~30s
npm run demo    # readable end-to-end behavior
npm run build   # the UI still compiles
```

**Probe behavior before wiring UI.** Balance bugs don't show up in a 20-step
run — drives cycle over hundreds of steps. A short `node -e` script over
600–1500 steps, printing drive ranges and goal distribution, has caught more
real problems here than any amount of reading. Both flocking bugs and the
resource-depletion balance were found that way.

**Editing anything under `src/model/` forces a full page reload** (see
`vite.config.js`). Fast Refresh would otherwise keep live `Farm` and `Animal`
instances built from the old class, and they fail on the first call to a method
that didn't exist yet.
