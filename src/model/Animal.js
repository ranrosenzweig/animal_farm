import { nextId, pick, randomInt } from "./random.js";

/**
 * Abstract base for every animal on the farm.
 *
 * A species is defined by two things:
 *   1. Static metadata on the subclass — `species`, `emoji`, `color`,
 *      `diet`, `breeds`, `names`. This is what the *kind* is.
 *   2. Overridden behavior — `makeSound()`, `move()`, `dailyProduce()`.
 *      This is what an individual *does*.
 *
 * Instance identity (`id`, `name`, `breed`, `age`) lives here so every
 * animal is addressable by the Farm regardless of species.
 */
export default class Animal {
  /** @type {string} Display name of the kind. Subclasses must override. */
  static species = "Animal";
  /** @type {string} */
  static emoji = "🐾";
  /** @type {string} Accent color used by the UI. */
  static color = "#6b5f42";
  /** @type {string[]} Foods this kind will accept; one is picked per animal. */
  static diet = ["grass"];
  /** @type {string[]} */
  static breeds = ["Mixed"];
  /** @type {string[]} Candidate names for randomly generated members. */
  static names = ["Nameless"];

  /**
   * @param {string} name
   * @param {string} breed
   * @param {number} age  in years
   * @param {string} [favoriteFood]  defaults to a random pick from the kind's diet
   */
  constructor(name, breed, age, favoriteFood) {
    if (new.target === Animal) {
      throw new TypeError("Animal is abstract — instantiate a species subclass instead.");
    }
    this.id = nextId();
    this.name = name;
    this.breed = breed;
    this.age = age;
    this.favoriteFood = favoriteFood ?? pick(new.target.diet);
    // Where this animal stands in the pasture, as percentages of the field.
    this.x = randomInt(8, 86);
    this.y = randomInt(18, 76);
  }

  /** Read the kind off the constructor so subclasses never have to reassign it. */
  get species() { return this.constructor.species; }
  get emoji() { return this.constructor.emoji; }
  get color() { return this.constructor.color; }

  makeSound() { return `${this.name} stays quiet.`; }
  move() { return `${this.name} wanders in place.`; }
  eat() { return `${this.name} nibbles on some ${this.favoriteFood}.`; }

  /**
   * What this animal yields in a day, or null if it yields nothing.
   * @returns {{ label: string, amount: number, unit: string } | null}
   */
  dailyProduce() { return null; }

  /** Label/value pairs for display. Subclasses append their own. */
  getAttributes() {
    return [
      { label: "Species", value: this.species },
      { label: "Breed", value: this.breed },
      { label: "Age", value: `${this.age} yr` },
      { label: "Favorite food", value: this.favoriteFood },
    ];
  }

  describe() {
    return `${this.name} — a ${this.age}-year-old ${this.breed} ${this.species.toLowerCase()}.`;
  }

  /** Build a member of this kind with a random name, breed and age. */
  static random() {
    return new this(pick(this.names), pick(this.breeds), randomInt(1, 6));
  }
}
