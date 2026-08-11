import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Sheep extends Animal {
  static species = "Sheep";
  static emoji = "🐑";
  static color = "#9B9481";
  static diet = ["grass", "oats", "alfalfa"];
  static breeds = ["Merino", "Suffolk", "Dorset", "Romney"];
  static names = ["Shirley", "Woolly", "Dolly", "Fleece", "Barbara"];

  constructor(name, breed, age) {
    super(name, breed, age);
    this.woolPerYear = randomInt(3, 6);
  }

  makeSound() { return `${this.name} calls out a soft "Baaaa."`; }
  move() { return `${this.name} shuffles closer to the rest of the flock.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Wool / year", value: `${this.woolPerYear} kg` }];
  }
}
