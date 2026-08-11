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
    Resource.js     water and grass: a place with a volume that runs out
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

`npm run check` audits all of it — overlaps, the fence, stride length, that
every step lands within a turn's worth of where the animal was already pointed,
that no source is ever drawn below empty, and that an empty field really does
kill everything on it:

```
Placed 47 of 90 animals; 43 turned away for lack of room.
Walked 200 rounds: 2174/9400 steps found room (23%); the rest were hemmed in.
Sharpest step taken was 1.20 rad off the animal's facing.
Famine: all 6 of 6 animals died within 377 rounds on an empty field (of thirst).
OK — nobody overlapped, left the field, sidestepped, or outran its stride,
and every animal wanted something real the whole way through.
```

That 23% is a deliberately overstocked field. At a normal six head it's ~83%.

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

**Drives** (`hunger`, `thirst`, `fatigue`, `loneliness`, `urge`) run 0–1, climb every
step at species-specific rates, and fall only while the animal is doing
something about them. They are pressure, not decisions.

**Goals** are what a mind chooses between — `graze`, `drink`, `wallow`,
`flock`, `rest`, `roam`, `mate`. A goal knows which drive it relieves and where the
animal has to be; it does not know how to walk there. `roam` relieves nothing,
so it only wins when nothing else presses — and it's where each species' own
way of moving still shows through (`roamHeading()`). `graze` and `drink`
additionally **consume** — see below.

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

## Water, grass, and dying

Water and grass are **Resources**: a place in the pasture with a `volume`, a
`capacity`, and a `draw(amount)` that only ever gives what it has. They used to
be fixed landmarks; they are held by the Farm now, because they run out and can
be put down anywhere.

That one change is what makes the drives matter:

- `drink` and `graze` declare `consumes: "water"` / `"grass"`. Their
  destination is **the nearest source that still has something in it**, so a
  drained pond stops attracting animals and they walk to the next one.
- Relief is proportional to what was actually drawn. Standing at a dry pond is
  not drinking — the animal gets nothing and its thirst keeps climbing.
- A bigger animal takes a bigger mouthful (`intake`: 1.1 for a cow, 0.3 for a
  chicken), so a herd of cattle empties a trough far faster than the poultry.
- With no source left anywhere, the destination is `null`: the animal wanders,
  looking, and nothing it does helps.

**Death.** Each animal has a `health` that falls only while a drive is *pinned
at its limit* — being merely hungry costs nothing — and recovers whenever
neither is. At zero it dies, and `Farm.stepAll()` clears it from the field
along with any source that has run dry:

```js
const { farm, moved, died, dried } = farm.stepAll();
died[0].epitaph();   // "Shirley the sheep died of thirst."
```

**Nothing grows back.** A farm left alone drinks itself dry and dies — in the
famine check, all six animals are gone within about 380 steps of an empty
field. Keeping them alive is the farmer's job: click **💧 water** or **🌿 grass**
and then click anywhere in the pasture.

```js
const { farm, resource } = farm.addResource("water", { x: 50, y: 45 });
farm.nearestResource(animal, "grass");   // nearest source with anything in it
farm.stock();   // [{ kind: "water", volume: 200, sources: 2, unit: "L" }, ...]
```

## Breeding

Every animal is `male` or `female`, decided at birth, and `mate` is a goal like
any other — driven by an `urge` that climbs until it's acted on.

**Only the Farm can match a pair**, for the same reason only the Farm arbitrates
collisions: an animal cannot check facts about another. `nearestMate(seeker)`
is the single place two animals are ever paired, and it requires all of:

- the **same species** — cross-species pairing is impossible by construction
- opposite sexes
- both grown (`age >= 1`), neither already carrying
- and both currently pursuing `mate`, so it takes two

Reach a willing partner and the female conceives. After `gestation` (300 steps)
she gives birth to one newborn **of her own species**, carrying her breed and
a record of both parents. A birth needs somewhere to stand: on a full pasture
it simply waits for room.

Newborns are age 0 — visibly smaller in the pasture, unable to breed — and
become adults after `maturesAt` (400 steps).

```js
const { farm, born, died } = farm.stepAll();
born[0].birthNotice();   // "Babe, a female pig, is born to Peppa and Wilbur."
born[0].parents;         // { mother: "Peppa", father: "Wilbur", species: "Pig" }
animal.canMate();        // grown, alive, not already carrying
```

`npm run check` runs 1,500 rounds with pairs of every species and fails if any
mother produces something other than her own species, if anything male or
newborn is ever carrying, or if not one birth happens at all.

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
