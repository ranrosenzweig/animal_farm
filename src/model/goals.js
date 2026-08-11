import { MUD, centroid, distance } from "./pasture.js";

/**
 * Builds the place/satisfied pair for a goal served by a resource that runs
 * out. The destination is whichever source of `kind` is nearest and still has
 * something in it — so a drained pond stops attracting animals, and they walk
 * to the next one. With none left anywhere the place is null: the animal has
 * nowhere to go, wanders, and its drive keeps climbing.
 */
function fromSource(kind) {
  return {
    consumes: kind,
    place: (animal, { farm } = {}) => farm?.nearestResource(animal, kind) ?? null,
    // Close enough to reach into it — a big pond can be drunk from its edge.
    satisfied: (animal, context = {}) => {
      const source = context.farm?.nearestResource(animal, kind);
      return source != null && distance(animal, source) < animal.radius + source.radius;
    },
  };
}

/**
 * What an animal can be trying to do.
 *
 * A goal is the unit a Mind chooses between. It answers three questions and
 * nothing else: which drive doing this relieves, where the animal has to be
 * to do it, and what to say about it. It deliberately does *not* know how to
 * walk there — steering stays with the animal, so a goal is just as valid
 * whether a script or a language model picked it.
 *
 *   relieves  the drive this lowers while the animal is at the place
 *   place     where it has to be; null means anywhere, or nowhere in particular
 *   anywhere  true when being there isn't required (resting)
 *   still     true when pursuing it means not moving at all
 */
export const GOALS = {
  graze: {
    relieves: "hunger",
    ...fromSource("grass"),
    narrate: (a) => `${a.name} crops at the grass.`,
  },

  drink: {
    relieves: "thirst",
    ...fromSource("water"),
    narrate: (a) => `${a.name} drinks.`,
  },

  wallow: {
    relieves: "fatigue",
    place: () => MUD,
    narrate: (a) => `${a.name} settles into the cool mud.`,
  },

  flock: {
    relieves: "loneliness",
    // The middle of its own kind if it has any, otherwise the middle of
    // whoever is about — on a farm with one of each, company is company.
    place: (animal, { neighbors = [] } = {}) =>
      centroid(neighbors.filter((n) => n.species === animal.species)) ??
      centroid(neighbors),
    // Satisfied by proximity, not by reaching the centroid: standing near
    // anyone is company, and the centroid moves as the others do.
    satisfied: (animal, { neighbors = [] } = {}) =>
      neighbors.some((n) => distance(animal, n) < animal.radius * 2.2),
    // Company counts whether or not the animal went looking for it — so a
    // chicken that never chooses to flock still isn't lonely in a crowd.
    passive: true,
    narrate: (a) => `${a.name} moves in close to the others.`,
  },

  rest: {
    relieves: "fatigue",
    place: () => null,
    anywhere: true,
    still: true,
    narrate: (a) => `${a.name} folds up where it stands and rests.`,
  },

  // The default. Relieves nothing, so it only wins when nothing else presses —
  // and it's where each species' own way of moving still shows through.
  roam: {
    relieves: null,
    place: () => null,
    narrate: (a) => a.move(),
  },
};

export const GOAL_NAMES = Object.keys(GOALS);

/**
 * Is `animal` getting anything out of the goal it is pursuing? By default
 * that means standing at the goal's place, but a goal may define its own
 * `satisfied` test where arriving somewhere isn't the point.
 */
export function atGoal(animal, goalName, context = {}) {
  const goal = GOALS[goalName];
  if (!goal || !goal.relieves) return false;
  if (goal.satisfied) return goal.satisfied(animal, context);
  if (goal.anywhere) return true;
  const place = goal.place(animal, context);
  return place != null && distance(animal, place) < animal.radius * 2;
}
