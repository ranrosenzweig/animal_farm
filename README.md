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
    pasture.js      bounds, the mud's place, distance/angle helpers
    terrain.js      the lie of the land: elevation, slope, and what the ground is made of
    physics.js      gravity, drag, collisions — the laws bodies obey
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
- The **farm** settles what happens when they meet. Only `Farm` can see
  everyone, so only `Farm` can run the collisions. `isClear(point, mover)` is
  the rule for *placing* an animal: inside the fence, clear of the rocks, and no
  further into anyone's personal space than `a.radius + b.radius` allows.

### Push, don't teleport

Nothing on this farm moves by being placed somewhere. An animal is a mass with
a velocity, and it gets where it is going by pushing — its own legs along its
`facing`, gravity down whatever it is standing on, drag from the ground, and
whatever hits it.

It still cannot strafe: `heading()` is only a *wish*, `turnToward()` grants at
most `turnRate` radians of it per step, and thrust goes along the facing that
results. But `velocity` is its own thing. A body shoved sideways travels
sideways, and one carried on by its own weight keeps going after it has stopped
pushing — which is why a resting animal now coasts to a halt rather than
stopping dead.

`Farm.stepAll()` runs in two halves: everyone thinks and integrates, and *then*
the whole field resolves at once. That order is the point — a collision is
about two bodies, and neither gets to settle it alone. Momentum is traded once
per touching pair, by inverse mass, so a horse coming through a knot of sheep
scatters them and a chicken walking into a cow does not move the cow.

```js
const { farm, moved } = farm.step(someId);   // one animal thinks; the field still settles
const { farm, moved } = farm.stepAll();      // everyone; moved = how many got anywhere
farm.overlaps();                             // always [] — the invariant
```

That invariant now carries a tolerance. Prising a jammed crowd apart is
iterative and approaches contact without landing exactly on it, so
`CONTACT_SLOP` (0.01 units, a fifth of a percent of an animal's radius) is the
line between *touching* and *overlapping*. `resolve` settles to well inside it
and `Farm.overlaps` reads the same number, so the model and its checks agree on
what an overlap is.

`npm run check` audits the laws: overlaps, the fence, that nobody stands inside
a rock, that nothing outruns its own top speed, that a resting animal really
does come to rest, that the slowest species can still climb the steepest ground,
that no source is drawn below empty, and that an empty field kills everything:

```
Placed 42 of 90 animals; 48 turned away for lack of room.
Walked 200 rounds: 7981/8400 steps got somewhere (95%); the rest were hemmed in.
Fastest anything travelled was 7.22 — Mallory the Duck, whose legs alone are worth 2.8.
Resting: Clover the cow coasted to a dead stop in 1 steps and stayed put.
Climbing: the steepest ground is 0.027 rise per unit; a cow still makes 0.95/step up it (53% of its pace on the level).
Famine: all 6 of 6 animals died within 416 rounds on an empty field (of thirst).
OK — nobody overlapped, left the field, stood in a rock, or outran its own
top speed; the resting stopped, the slowest can still climb the steepest
ground, and every animal wanted something real the whole way through.
```

Two older rules are deliberately gone. Animals used to be forbidden from moving
sideways or backward, and from covering more ground than their stride. Both were
true of a body that teleported one stride per step and neither survives
momentum — a chicken struck by a horse goes where the horse sent it. The speed
cap replaces them, and it is a real law: `capSpeed` is applied wherever velocity
changes, not only where thrust and drag settle.

Placement is unchanged: `Farm.add()` looks for a free spot — inside the fence,
clear of the rocks, clear of everyone — and if the pasture is full it **turns
the animal away** (`added: false`) rather than stacking it on one already there.

`stepSize`, `mass` and `radius` are static per species. `stepSize` is a
*cruising speed*, not a stride: `thrust` is derived from it so that thrust and
drag balance at exactly that speed on flat meadow, which is why giving these
animals physics did not change how fast any of them crosses level ground. The
field is ~84 units across and a cow cruises 1.8 of them a step, so crossing it
takes the better part of fifty. The UI ticks every `STEP_MS` (600ms) and runs
the sprite's CSS transition for exactly that long, linearly, so a walking animal
never visibly stops between steps.

### The ground it all happens on

`terrain.js` gives the pasture relief and a surface. Height is a sum of smooth
bumps rather than a stored grid, for one reason that pays off: a sum of
Gaussians can be differentiated on paper, so `slopeAt` is *exact* rather than a
difference between two samples. Gravity gets an honest direction to pull in.

```js
elevationAt({ x, y });   // how high the ground stands, ~0..1
slopeAt({ x, y });       // which way it rises, and how steeply — the exact gradient
groundAt({ x, y });      // meadow | mud | wood | rock, each with its own drag
```

The two hollows are not decoration — water and mud collect in low ground, so
the pond and the mud patch sit in them. Rock is impassable, and it is a body:
animals bounce off it rather than being forbidden to enter.

Because mass cancels out of a drag balance, how much a slope costs an animal
falls out as `GRAVITY × slope × responseTime` — and `responseTime` grows with
mass. So a cow labours up the steepest rise at about half its usual pace while a
horse barely notices, and nothing anywhere had to say that hills are hard for
cows. `GRAVITY` is sized against `STEEPEST`, the steepest ground the field
actually has, so the animal with the least to spare is slowed by a hill rather
than stranded on it.

The pasture UI paints all of this from the very same numbers: every hill drawn
is one of `RELIEF`'s bumps and every rock is drawn at exactly the radius animals
collide with. What you see is what they walk on.

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

The full procedure for species, goals, drives and resource kinds — including
the steps that fail *silently* — lives in
[.claude/skills/extending-the-farm/](.claude/skills/extending-the-farm/SKILL.md).

## Adding a mind

Subclass `Mind`, implement `decide(percept)`, set a `cadence`, and assign it:
`animal.mind = new YourMind()`. Nothing about the body, the goals, or the
collision rules changes.

### The Claude-backed mind

`ClaudeMind` is that same seam with a language model behind it. It posts the
percept to a small proxy and gets back a goal and a reason:

```js
animal.mind = new ClaudeMind();   // browser: Vite forwards /decide to the proxy
animal.mind = new ClaudeMind({ endpoint: "http://127.0.0.1:8787/decide" });  // Node
```

Two things about it are worth knowing.

**It never waits.** `decide()` is called from inside `Farm.stepOne`, which is
synchronous the whole way down. So each deliberation returns the answer to the
*previous* one and sends the current percept off for the next — the animal is
always acting on the last thing Claude said. At `cadence` 12 a deliberation is
some seconds apart and the round trip is shorter than that, so the answer is
already waiting by the time it's wanted. Until the first one arrives, and after
any that fails, the animal keeps the goal it had; an unreachable mind is an
animal carrying on, not an animal stopping.

**The key is not in the page.** `server/decide.js` holds it and serves `/decide`;
Vite forwards that in dev. Copy `.env.example` to `.env`, put a key in it, and:

```sh
npm run proxy   # the proxy on :8787
npm run mind    # a short run with every animal thinking through Claude
```

The answer is constrained to an enum of the goals that animal actually has, so
an invalid goal is impossible rather than merely unlikely. Every deliberation is
a paid request — `cadence` is the dial that matters, and `ScriptedMind` is still
the default, so `npm run check` and `npm run probe` stay offline and repeatable.

**It is a key on a socket, so it is deliberately hard to reach.** The proxy
binds `127.0.0.1` and nothing else, accepts only loopback origins (and requests
with no origin at all, which is how Node scripts arrive — a web page cannot
omit one), caps bodies at 64 KB, refuses goals the farm doesn't define, and
serves at most 60 requests a minute. Failures are logged in full here and
reported to the caller in the vaguest terms that are still true. `HOST` and
`RATE_LIMIT_PER_MINUTE` override the last two if you need them to.

## Running it

**Node 24+ required** (Vite + rolldown need it; `.nvmrc` documents this).

```sh
npm install
npm run dev     # the pasture UI at the printed localhost URL
npm run demo    # exercise the model in the terminal, no browser
npm run proxy   # the /decide proxy, for animals given a ClaudeMind (needs .env)
npm run mind    # a short run with every animal deciding through Claude
npm run check   # overstock the pasture and audit every rule of movement and agency
npm run probe   # run a long simulation and report on the farm's balance
npm run build
```

If you have Node 20.x and Node 24 both installed (e.g., on Windows), you can temporarily switch:
```sh
# On Windows: if Node 24 is at C:\Program Files\nodejs\
set PATH=C:\Program Files\nodejs;%PATH%
npm run dev
```
