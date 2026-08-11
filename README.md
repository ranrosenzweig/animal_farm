# Animal Farm

A model of a farm. `Animal` is an abstract base class; each kind of animal is a
subclass that defines itself completely — its metadata and its behavior — and a
`Farm` holds the animals and answers questions about them as a whole.

```
src/
  model/            plain JS, no framework, runs under Node
    Animal.js       abstract base: identity, defaults, heading(), getAttributes()
    Farm.js         holds animals; add/remove/step/census/dailyProduce; owns the ground rules
    pasture.js      bounds, landmarks (pond, mud), distance helpers
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
  sheep for the middle of the flock, the horse runs the fence line and turns
  around at the end, the chicken turns hard every step and traces a circle,
  the cow plods to the nearest fence and grazes along it.
- The **farm** grants the ground. Only `Farm` can see everyone, so only `Farm`
  decides. `isClear(point, mover)` is the rule itself: inside the fence, and no
  further into anyone's personal space than `a.radius + b.radius` allows.

`Farm.step(id)` asks the animal where it wants to go, then tries that heading,
then swerves of ±0.4, ±0.8 … radians to either side, then the same fan at 60%
and 35% of a stride. The first spot that is clear wins. If every one of them is
blocked, the animal doesn't move and `step` reports `moved: false` — it stays
put rather than pushing through.

```js
const { farm, moved } = farm.step(someId);   // one animal
const { farm, moved } = farm.stepAll();      // everyone, in turn; moved = how many found room
farm.overlaps();                             // always [] — the invariant
```

Placement obeys the same rule: `Farm.add()` looks for a free spot and, if the
pasture is full, **turns the animal away** (`added: false`) rather than stacking
it on one already there. `npm run check` overstocks the field and audits every
round:

```
Placed 45 of 90 animals; 45 turned away for lack of room.
Walked 200 rounds: 5719/9000 steps found room (64%); the rest were hemmed in.
OK — no animal ever stood on another, and none left the field.
```

`stepSize` and `radius` are static per species, so a horse covers 20 units at a
gallop while a chicken scurries 5, and a cow needs more elbow room than a duck.

## Adding a species

Write one class in `src/model/animals/`, add it to `SPECIES` in
`src/model/species.js`, and add its `?raw` import in `src/sources.js` if you want
it in the source viewer. The UI picks it up with no further changes.

## Running it

```sh
npm install
npm run dev     # the pasture UI at the printed localhost URL
npm run demo    # exercise the model in the terminal, no browser
npm run check   # overstock the pasture and audit the no-overlap rule
npm run build
```
