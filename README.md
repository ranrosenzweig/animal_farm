# Animal Farm

A model of a farm. `Animal` is an abstract base class; each kind of animal is a
subclass that defines itself completely — its metadata and its behavior — and a
`Farm` holds the animals and answers questions about them as a whole.

```
src/
  model/            plain JS, no framework, runs under Node
    Animal.js       abstract base: identity, defaults, getAttributes(), describe()
    Farm.js         holds animals; add/remove/find/census/dailyProduce/feedAll
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

## Adding a species

Write one class in `src/model/animals/`, add it to `SPECIES` in
`src/model/species.js`, and add its `?raw` import in `src/sources.js` if you want
it in the source viewer. The UI picks it up with no further changes.

## Running it

```sh
npm install
npm run dev     # the pasture UI at the printed localhost URL
npm run demo    # exercise the model in the terminal, no browser
npm run build
```
