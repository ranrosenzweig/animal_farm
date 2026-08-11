import Animal from "../Animal.js";
import { randomInt } from "../random.js";

export default class Cow extends Animal {
  static species = "Cow";
  static emoji = "🐄";
  static color = "#7A5230";
  static diet = ["clover", "hay", "silage"];
  static breeds = ["Holstein", "Jersey", "Angus", "Hereford"];
  static names = ["Buttercup", "Daisy", "Clover", "Bessie", "Rosie"];
  static stepSize = 1.8;   // plodding — the slowest thing in the field
  static radius = 5.5;     // takes up room
  static turnRate = 0.22;  // unhurried about changing its mind

  // Eats most of the day and thinks about little else.
  static affinities = { graze: 1.0, drink: 0.7, rest: 0.6, flock: 0.5, wallow: 0, roam: 0.3 };
  static driveRates = { hunger: 0.007, thirst: 0.005, fatigue: 0.002, loneliness: 0.003 };
  static intake = 1.1;  // drinks and grazes more than anything else here

  constructor(name, breed, age) {
    super(name, breed, age);
    this.milkPerDay = randomInt(15, 30);
  }

  makeSound() { return `${this.name} lets out a deep "Moooo!"`; }
  move() { return `${this.name} plods slowly toward the fence.`; }

  dailyProduce() { return { label: "Milk", amount: this.milkPerDay, unit: "L" }; }

  getAttributes() {
    return [...super.getAttributes(), { label: "Milk / day", value: `${this.milkPerDay} L` }];
  }
}
