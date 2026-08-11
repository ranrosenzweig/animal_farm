import { SPECIES } from "./species.js";

/**
 * The farm itself: a named place that holds animals and can answer
 * questions about them as a whole.
 *
 * `add` and `remove` return a *new* Farm rather than mutating this one,
 * so a Farm can sit directly in React state and comparisons stay honest.
 * The animals inside are shared by reference — an animal keeps its
 * identity when it moves between two versions of the farm.
 */
export default class Farm {
  /**
   * @param {string} name
   * @param {import("./Animal.js").default[]} animals
   */
  constructor(name = "The Farm", animals = []) {
    this.name = name;
    this.animals = animals;
  }

  /** A farm stocked with one of every known species. */
  static starter(name = "The Farm") {
    return new Farm(name, SPECIES.map((Species) => Species.random()));
  }

  get size() { return this.animals.length; }

  /** @returns {Farm} a new farm with `animal` added. */
  add(animal) {
    return new Farm(this.name, [...this.animals, animal]);
  }

  /** @returns {Farm} a new farm without the animal carrying `id`. */
  remove(id) {
    return new Farm(this.name, this.animals.filter((a) => a.id !== id));
  }

  find(id) {
    return this.animals.find((a) => a.id === id);
  }

  bySpecies(species) {
    return this.animals.filter((a) => a.species === species);
  }

  /**
   * Head count per species, in registry order, including empty pens.
   * @returns {{ Species: Function, species: string, emoji: string, color: string, count: number }[]}
   */
  census() {
    return SPECIES.map((Species) => ({
      Species,
      species: Species.species,
      emoji: Species.emoji,
      color: Species.color,
      count: this.bySpecies(Species.species).length,
    }));
  }

  /**
   * Everything the farm yields in a day, summed across animals.
   * @returns {{ label: string, amount: number, unit: string }[]}
   */
  dailyProduce() {
    const totals = new Map();
    for (const animal of this.animals) {
      const yieldOf = animal.dailyProduce();
      if (!yieldOf) continue;
      const running = totals.get(yieldOf.label);
      if (running) running.amount += yieldOf.amount;
      else totals.set(yieldOf.label, { ...yieldOf });
    }
    return [...totals.values()].map((t) => ({ ...t, amount: Math.round(t.amount * 10) / 10 }));
  }

  /** Feed every animal; returns what happened, one line per animal. */
  feedAll() {
    return this.animals.map((a) => a.eat());
  }
}
