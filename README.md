# Animal Farm

A model of a farm. `Animal` is an abstract base class; each kind of animal is a
subclass that defines itself completely — its metadata and its behavior — and a
`Farm` holds the animals and answers questions about them as a whole.

```
src/
  model/            plain JS, no framework, runs under Node
    Animal.js       abstract base: body, drives, and the perceive → decide → act loop
    Farm.js         holds animals; add/remove/step/census/activity; owns the ground rules
    drives.js       hunger, thirst, fatigue, loneliness
    goals.js        what an animal can be trying to do, and where that is
    minds/
      Mind.js       the seam: decide(percept) → intention
      ScriptedMind.js   scores options by affinity × pressure, with commitment
    pasture.js      bounds, landmarks (pond, mud), distance/angle helpers
    species.js      the registry of known species
    random.js       id + random helpers
    animals/        one file per species
      Cow.js  Chicken.js  Pig.js  Sheep.js  Horse.js  Duck.js
  FarmModel.jsx     a live view of the model (the pasture UI)
  sources.js        Vite-only: raw class text for the UI's "View source"
```

## What "well defined" means here

A species is pinned down in two halves:

**Static metadata** — what the kind *is*:

```js
static species = "Cow";
static emoji   = "🐄";
static color   = "#7A5230";
static diet    = ["clover", "hay", "silage"];
static breeds  = ["Holstein", "Jersey", "Angus", "Hereford"];
static names   = ["Buttercup", "Daisy", "Clover", "Bessie", "Rosie"];
```

**Overridden behavior** — what an individual *does*:

```js
makeSound()     // "Buttercup lets out a deep \"Moooo!\""
move()          // "Buttercup plods slowly toward the fence."
dailyProduce()  // { label: "Milk", amount: 22, unit: "L" }  (null if none)
getAttributes() // base rows + the species' own, e.g. "Milk / day"
```

`Animal` reads `species`/`emoji`/`color` off `this.constructor`, so a subclass
never reassigns them, and it throws if you try to instantiate it directly.
`Animal.random()` builds a member of whichever subclass it's called on.

## The farm

`Farm` is persistent: `add()` and `remove()` return a *new* `Farm` rather than
mutating, so it can sit directly in React state while animals keep their
identity across versions.

```js
let farm = Farm.starter("Sunnyside");   // one of every species
farm.census();                          // head count per species, empty pens included
farm.dailyProduce();                    // [{ label: "Milk", amount: 22, unit: "L" }, ...]
farm.bySpecies("Duck");
farm = farm.add(new Cow("Marigold", "Jersey", 3));
farm = farm.remove(someId);
```

## Movement, and staying off each other

Animals move, and **no animal may stand on another**. That rule is split so
that neither half has to know too much:

- The **animal** picks a direction. `heading(context)` is where each species'
  temperament lives — the pig makes for the mud, the duck for the pond, the
  sheep for the middle of the flock, the horse runs the fence line and comes
  about at the end, the chicken bears constantly left and traces a circle,
  the cow plods to the nearest fence and grazes along it.
- The **farm** grants the ground. Only `Farm` can see everyone, so only `Farm`
  decides. `isClear(point, mover)` is the rule itself: inside the fence, and no
  further into anyone's personal space than `a.radius + b.radius` allows.

### Forward only

Animals don't strafe. Each one has a `facing` and walks along it; `heading()`
is only a *wish*, and `turnToward()` grants at most `turnRate` radians of it per
step. Changing direction is therefore an arc, not a jump, and how tight an arc
is itself a species trait — `turningCircle` is just `stepSize / turnRate`, which
is why a galloping horse (20 units) starts its turn a long way before the fence
while a chicken (2.5) can spin almost on the spot.

`Farm.step(id)` turns the animal, then walks it forward. When the ground ahead
is taken it may shade the line by up to one more `turnRate` or shorten the
stride, but it may not step around — so a blocked animal **stays where it is**,
having turned a little, and tries a fresh line next step (`moved: false`, logged
as "hemmed in"). Repeated balks widen its `veer`, so it works its way around an
obstacle over several steps and then settles back onto its heading.

```js
const { farm, moved } = farm.step(someId);   // one animal
const { farm, moved } = farm.stepAll();      // everyone, in turn; moved = how many found room
farm.overlaps();                             // always [] — the invariant
```

`npm run check` audits all of it — overlaps, the fence, stride length, and that
every step lands within a turn's worth of where the animal was already pointed:

```
Placed 44 of 90 animals; 46 turned away for lack of room.
Walked 200 rounds: 2252/8800 steps found room (26%); the rest were hemmed in.
Sharpest step taken was 1.20 rad off the animal's facing.
OK — nobody overlapped, left the field, sidestepped, or outran its stride.
```

That 26% is a deliberately overstocked field. At a normal six head it's ~83%.

Placement obeys the same rule: `Farm.add()` looks for a free spot and, if the
pasture is full, **turns the animal away** (`added: false`) rather than stacking
it on one already there.

`stepSize` and `radius` are static per species. A step is deliberately a small
movement — the field is ~84 units across, and a cow plods 1.8 of them at a time,
so crossing it takes it the better part of fifty steps. A galloping horse covers
6, still three times anything else. The UI ticks a step every `STEP_MS` (600ms)
and runs the sprite's CSS transition for exactly that long, linearly, so a
walking animal never visibly stops between steps.

## Agents: drives, goals, minds

Each animal is an agent in three layers, and each one only talks to its
neighbour:

```
drives ──▶ Mind.decide(percept) ──▶ goal ──▶ place ──▶ heading ──▶ Farm.isClear
 feel          choose                        steer            act    arbitrate
```

**Drives** (`hunger`, `thirst`, `fatigue`, `loneliness`) run 0–1, climb every
step at species-specific rates, and fall only while the animal is doing
something about them. They are pressure, not decisions.

**Goals** are what a mind chooses between — `graze`, `drink`, `wallow`,
`flock`, `rest`, `roam`. A goal knows which drive it relieves and where the
animal has to be; it does not know how to walk there. `roam` relieves nothing,
so it only wins when nothing else presses — and it's where each species' own
way of moving still shows through (`roamHeading()`).

**Minds** are the seam. A `Mind` gets a **percept** — plain, serializable data
— and returns an **intention**:

```js
{
  self:    { name: "Daisy", species: "Cow", goal: "graze", drives: {...} },
  options: [{ goal: "graze", affinity: 1.0, pressure: 0.62 }, ...],
  nearby:  [{ name: "Wilbur", species: "Pig", distance: 14 }, ...],
}
// ──▶ { goal: "drink", reason: "71% pressure" }
```

Nothing live is in that percept, which is the point: `ScriptedMind` scores it
arithmetically (`affinity × pressure`, with a **commitment** margin so animals
don't dither between two close options), but the same object could be dropped
into a prompt. A mind also declares a `cadence` — bodies tick every step,
minds needn't — so a slower, more expensive mind slots in without touching
anything else.

Species express character as **affinities**, not as fixed behavior:

```js
static affinities = { wallow: 1.0, graze: 0.8, drink: 0.6, rest: 0.2, flock: 0.3, roam: 0.4 };
static driveRates = { hunger: 0.006, thirst: 0.005, fatigue: 0.005, loneliness: 0.003 };
```

The pig still makes for the mud — but now because it *wants* to, and it will
break off to eat when hunger outweighs the wallow.

```js
farm.activity();          // [{ goal: "drink", count: 2 }, { goal: "graze", count: 1 }, ...]
animal.perceive(context); // the percept, as plain data
animal.mind = new SomeOtherMind();   // per animal, at any time
```

## Adding a species

Write one class in `src/model/animals/` — static metadata, `affinities`,
`driveRates`, overridden behavior, and a `roamHeading()` if it should move
distinctively — add it to `SPECIES` in `src/model/species.js`, and add its
`?raw` import in `src/sources.js` if you want it in the source viewer. The UI
picks it up with no further changes.

## Adding a mind

Subclass `Mind`, implement `decide(percept)`, set a `cadence`, and assign it:
`animal.mind = new YourMind()`. Nothing about the body, the goals, or the
collision rules changes.

## Running it

```sh
npm install
npm run dev     # the pasture UI at the printed localhost URL
npm run demo    # exercise the model in the terminal, no browser
npm run check   # overstock the pasture and audit every rule of movement and agency
npm run build
```
