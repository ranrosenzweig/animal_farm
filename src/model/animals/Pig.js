import Animal from "../Animal.js";
import { randomInt } from "../random.js";
import { MUD } from "../pasture.js";

export default class Pig extends Animal {
  static species = "Pig";
  static emoji = "🐷";
  static color = "#D08B93";
  static diet = ["slops", "acorns", "sweet potatoes"];
  static breeds = ["Yorkshire", "Duroc", "Hampshire", "Berkshire"];
  static names = ["Wilbur", "Babe", "Hamlet", "Peppa", "Truffle"];
  static stepSize = 11;  // a purposeful trot
  static radius = 5;

  constructor(name, breed, age) {
    super(name, breed, age);
    this.mudBathsPerDay = randomInt(1, 3);
  }

  makeSound() { return `${this.name} grunts an enthusiastic "Oink oink!"`; }
  move() { return `${this.name} trots straight for the mud patch.`; }

  /** Straight for the mud, and wallows about once it gets there. */
  heading() { return this.headingToward(MUD); }

  getAttributes() {
    return [...super.getAttributes(), { label: "Mud baths / day", value: this.mudBathsPerDay }];
  }
}
