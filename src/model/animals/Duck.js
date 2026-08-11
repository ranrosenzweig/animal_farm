import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Duck extends Animal {
  static species = "Duck";
  static emoji = "🦆";
  static color = "#3E7CA6";
  static diet = ["pond weed", "cracked corn", "duckweed"];
  static breeds = ["Mallard", "Pekin", "Rouen", "Khaki Campbell"];
  static names = ["Quackers", "Puddles", "Donald", "Waddle", "Mallory"];

  constructor(name, breed, age) {
    super(name, breed, age);
    this.pondLapsPerDay = randomInt(5, 15);
  }

  makeSound() { return `${this.name} lets out a bright "Quack!"`; }
  move() { return `${this.name} waddles off toward the pond.`; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Pond laps / day", value: this.pondLapsPerDay }];
  }
}
