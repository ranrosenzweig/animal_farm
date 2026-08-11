import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Pig extends Animal {
  static species = "Pig";
  static emoji = "🐷";
  static color = "#D08B93";
  static diet = ["slops", "acorns", "sweet potatoes"];
  static breeds = ["Yorkshire", "Duroc", "Hampshire", "Berkshire"];
  static names = ["Wilbur", "Babe", "Hamlet", "Peppa", "Truffle"];

  constructor(name, breed, age) {
    super(name, breed, age);
    this.mudBathsPerDay = randomInt(1, 3);
  }

  makeSound() { return `${this.name} grunts an enthusiastic "Oink oink!"`; }
  move() { return `${this.name} trots straight for the mud patch.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Mud baths / day", value: this.mudBathsPerDay }];
  }
}
