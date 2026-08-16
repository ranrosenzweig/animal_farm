# Animal Farm

A small farm that runs itself. Cows, sheep, pigs, horses, chickens and ducks
live in a pasture — they get hungry, thirsty and tired, they walk to the water
and the grass, they breed, and if nothing is left to eat they die. A farmer
works the same field, keeping the troughs and meadows topped up. You watch it
happen in the browser.

```sh
npm install
npm run dev     # the farm, in a browser
```

Node 24 or newer.

## What you'll see

**The pasture.** Animals as emoji, moving over ground that has hills, mud,
woodland and rock. Nobody walks through anybody — a horse cutting through a
knot of sheep scatters them; a chicken walking into a cow gets nowhere. Click
an animal to see who it is, what it wants and how it's doing.

**A clock and a sky.** A day is 96 rounds. The sun rises and sets on the real
formula for a temperate latitude, so winter days are short and summer days are
long. It rains, it snows, it gets hot and cold — and all of that shows up in
the animals: cold makes them hungry, heat makes them thirsty, and at night the
herd lies down and sleeps.

**A farmer.** He fills whatever trough is emptiest, sows a fresh patch when a
kind runs out of the field entirely, drops everything for a dying animal, and
walks home at dusk. He works out of a barn that refills slower than he empties
it, so a big herd can still outrun him — and when it does he hires a hand.

**A log, and numbers.** Every birth, death, chore and dry trough gets a line.
The statistics tab tracks the herd over time.

## What you can do

- Put down **water** or **grass** anywhere you click.
- Feed an animal, remove it, or make it speak.
- Collect the day's milk and eggs.
- Change how long a step lasts, how long a day lasts, and how often animals
  stop to think.
- Leave it alone entirely — but a farm left alone drinks itself dry.

## Under the hood

Plain JavaScript, no framework in the model itself; React only for the view.
Each animal is a body with drives (`hunger`, `thirst`, `fatigue`, `loneliness`,
`urge`) and a mind that picks a goal from them — `graze`, `drink`, `wallow`,
`flock`, `rest`, `roam`, `mate`. Species differ by how strongly they want
things, not by hard-coded behaviour, which is why a pig heads for the mud but
breaks off to eat when hunger wins.

```
src/model/       the farm itself — animals, terrain, physics, goals, minds
src/FarmModel.jsx  the browser view
```

The mind is a swappable seam: it gets plain data and returns a goal.
`ScriptedMind` scores arithmetically and is the default. `ClaudeMind` sends the
same data to a language model instead — see [server/decide.js](server/decide.js)
and copy `.env.example` to `.env` for a key.

Adding a species is one file in [src/model/animals/](src/model/animals/) plus a
line in `species.js`. The full procedure — including the steps that fail
*silently* — is in
[.claude/skills/extending-the-farm/](.claude/skills/extending-the-farm/SKILL.md).

## Commands

```sh
npm run dev     # the farm in a browser
npm run demo    # exercise the model in the terminal
npm run check   # audit every rule: collisions, fences, speed, breeding, famine
npm run probe   # a long run, reported as a balance report
npm run proxy   # the /decide proxy, for animals thinking through Claude
npm run mind    # a short run with every animal doing so
npm run build
```
