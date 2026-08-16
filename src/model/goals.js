import { MUD, centroid, distance } from "./pasture.js";
import { groundAt } from "./terrain.js";

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
    // Standing in it, not beside it. The test is on the animal's own middle
    // rather than on the reach of its body, because a body here is three times
    // the animal you see and "within a body's width" is a stride away with its
    // head up. An animal drinks when it has its feet in the water — which it
    // can always get to, since deep water holds it at the rim and the rim is
    // inside the pond.
    satisfied: (animal, context = {}) => {
      const source = context.farm?.nearestResource(animal, kind);
      return source != null && distance(animal, source) < source.radius;
    },
  };
}

/**
 * Whoever is standing near enough to `animal` to count as company. Close
 * enough to touch, near enough to matter — the one definition of "together",
 * used both to judge whether an animal is lonely and to decide who it comes
 * to know.
 */
export const companyFor = (animal, neighbors = []) =>
  neighbors.filter((n) => distance(animal, n) < animal.radius * 2.2);

/**
 * What the company of a stranger is worth against that of a familiar animal.
 * Not nothing — a body beside you is still a body — but an animal settles far
 * faster among the ones it knows.
 */
const STRANGER = 0.35;

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
 *   worth     0–1, how much of the full relief being there has earned; a goal
 *             without one pays in full
 */
export const GOALS = {
  graze: {
    relieves: "hunger",
    ...fromSource("grass"),
    // Frozen ground, and snow lying on it. The grass is still there and the
    // patch is as full as it ever was — what the cold takes is the mouthful,
    // which is why a hard winter has the herd grazing far more of the day for
    // the same relief. Nothing happens above freezing.
    worth: (animal, { farm } = {}) => {
      const tempC = farm?.clock?.tempC;
      return tempC == null ? 1 : Math.min(1, Math.max(0.3, 1 + tempC / 8));
    },
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
    // Standing in the mud, which the ground itself can answer — no need to
    // guess at how wide the patch is from over here. Without this it falls
    // through to the general "near enough" test, and a big animal wallows
    // from two lengths outside the mud it never touched.
    satisfied: (animal) => groundAt(animal).kind === "mud",
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
    satisfied: (animal, { neighbors = [] } = {}) => companyFor(animal, neighbors).length > 0,
    // But company is not all worth the same. The best-known face standing
    // with it sets what the company is worth, so a newcomer among strangers
    // settles slowly, and an animal put back among its own settles at once.
    worth: (animal, { neighbors = [] } = {}) => {
      const company = companyFor(animal, neighbors);
      if (company.length === 0) return 0;
      const known = Math.max(...company.map((n) => animal.familiarity(n)));
      return STRANGER + (1 - STRANGER) * known;
    },
    // Company counts whether or not the animal went looking for it — so a
    // chicken that never chooses to flock still isn't lonely in a crowd.
    passive: true,
    narrate: (a) => `${a.name} moves in close to the others.`,
  },

  mate: {
    relieves: "urge",
    // Head for anyone it *could* breed with — only the Farm can judge that,
    // since only the Farm can see everyone. But the urge is only relieved by
    // reaching one who is also looking, because mating takes two.
    place: (animal, { farm } = {}) => farm?.eligibleMate(animal) ?? null,
    satisfied: (animal, { farm } = {}) => {
      const partner = farm?.willingMate(animal);
      return partner != null && distance(animal, partner) < animal.radius + partner.radius + 1;
    },
    narrate: (a) => `${a.name} goes looking for a mate.`,
  },

  // A chore, not a want: it relieves nothing, so whoever does it does it at
  // the standing pressure behind everything that isn't an ache. The place is
  // the trough that most needs filling — only the Farm can say which — and
  // null when every source is comfortable, so a farmer with nothing to do
  // wanders like anything else.
  tend: {
    relieves: null,
    place: (animal, { farm } = {}) => farm?.neediestResource() ?? null,
    narrate: (a) => `${a.name} tops up what the herd has drunk down.`,
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
