import Animal from "../Animal.js";
import { distance } from "../pasture.js";
import { ENOUGH, RESOURCE_KINDS } from "../Resource.js";
import { clamp01 } from "../drives.js";

/**
 * What each kind of work takes, and what it looks like from the fence.
 *
 * Grass is cut and carted, water is piped: a man on foot with a bucket is not
 * how either job is actually done. Both live at the house and he can only have
 * one of them with him, which is the whole weight this carries — switching
 * from the troughs to the meadows means a trip home first, and that trip is
 * time the herd spends drinking whatever is left.
 */
const TOOLS = {
  grass: { name: "tractor", emoji: "🚜", takes: "hitches up the tractor", drives: "takes the tractor out to" },
  water: { name: "hose", emoji: "🚿", takes: "uncoils the hose", drives: "runs the hose out to" },
};

/**
 * The farmer. He stands in the field on the same terms as everything else in
 * it — a body with drives and a mind, which is why he is an Animal — but he is
 * the only one here who looks after anyone but himself.
 *
 * That is the whole of what makes him the owner: the `tend` goal, which he is
 * the only kind with any affinity for. It sends him to whichever trough or
 * patch is emptiest, and what he does when he gets there is the opposite of
 * what everything else on this farm does to a source — he fills it. When a
 * kind has run out of the field altogether he sows a fresh one where he
 * stands, because a source that empties is off the field for good and no
 * amount of walking to it would bring it back.
 *
 * All of it comes out of the barn behind his house, which fills again slower
 * than he empties it — so he is a man with a store and a well, not a tap. He
 * lives in the yard below it: with nothing that needs doing he walks home,
 * which is also where his day ends.
 */
export default class Human extends Animal {
  static species = "Human";
  // The man farmer rather than the person farmer, and not a matter of taste:
  // the system emoji font draws 🧑‍🌾 as two glyphs — a face with a plant beside
  // it — where it draws this one as a farmer in overalls, legs and all.
  static emoji = "👨‍🌾";
  static color = "#3F5A7D";
  static diet = ["bread", "cheese", "apples"];
  static breeds = ["Farmer"];
  static names = ["Old MacDonald"];
  static stepSize = 3.4;   // brisk; he has rounds to make
  static mass = 80;
  static radius = 4.5;
  static legs = 2;
  static turnRate = 0.5;
  static solitary = true;  // there is one farmer, and this is him

  // The chores come first, and nothing else here does them. He does not breed
  // — that is not what he is on the field for — and he is far too dignified to
  // wallow.
  static affinities = { tend: 1.0, drink: 0.8, graze: 0.7, rest: 0.5, flock: 0.3, roam: 0.3, wallow: 0, mate: 0 };
  static driveRates = { hunger: 0.003, thirst: 0.005, fatigue: 0.003, loneliness: 0.002, urge: 0 };
  static intake = 0.7;

  /** How much he pours in per step spent at a source, in that source's units. */
  static pours = 2.5;

  /**
   * What the farmhouse and the barn behind it hold, in resource units — hay in
   * the loft, water in the well. Everything he puts on the field comes out of
   * here, and it is what he can carry rather than what he can wish for.
   */
  static stores = 1400;

  /**
   * What comes back into the barn each step: the well drawing, the hay coming
   * on. Well under what he pours out standing at a trough, so a big herd still
   * outdrinks him and a small one he can keep going indefinitely — which is
   * the whole difference between a farmer and a tap.
   */
  static yields = 0.25;

  /**
   * What he takes for himself each step — out of the same stores as the
   * buckets, because a farmhouse has a kitchen and a well. It is why he does
   * not queue at the trough behind six animals for the water he is carrying
   * them: a farmer who dies of thirst on the third dry day is a farm that
   * dies with him. An empty barn still starves him along with everyone else.
   */
  static provisions = 0.02;

  /** The yard below the barn, which is where he lives and where he ends his day. */
  static home = { x: 85, y: 34 };

  constructor(name, breed, age) {
    super(name, breed, age);
    // Old MacDonald is a he. Nothing here tosses a coin over that.
    this.sex = "male";
    // Nothing raises it and nothing relieves it, so left as it starts it would
    // sit on his card forever as a bar that means nothing.
    this.drives.urge = 0;
    /** What is left of the barn's stores. His own, not the farm's. */
    this.stores = new.target.stores;
    /** How much he has put on the field since he started, by kind. */
    this.carried = { water: 0, grass: 0 };
    /** How many sources he has started from nothing. */
    this.sown = 0;
    /** Which source he is currently filling, so a new errand reads as one. */
    this.filling = null;
    /** The implement in his hands: "tractor", "hose", or nothing yet. */
    this.tool = null;
    /**
     * What he finished doing this step, for whoever is keeping the log — a
     * chore worth a line, not the pouring itself. Null on every step where he
     * only carried on with what he was already doing.
     * @type {{ act: string, source: Resource, notice: string } | null}
     */
    this.chore = null;
  }

  /**
   * Being alive, and then the chores.
   *
   * Two of them. A kind that has run out altogether is the one thing a bucket
   * cannot fix — a source that empties leaves the field for good — so he
   * scatters a fresh one where he stands and tends it up from there. And
   * whatever he walked out to fill, he fills, from the bank rather than from
   * the middle: at a crowded trough the bank is the only room the herd leaves
   * him. Both come out of the barn, and a held source takes nothing at all.
   */
  feel(context = {}) {
    super.feel(context);
    this.chore = null;
    const { yields, stores } = this.constructor;
    // Before the guard below, or a barn that ever reached empty would stay
    // empty however long the well ran.
    this.stores = Math.min(stores, this.stores + yields);

    const { provisions } = this.constructor;
    if (this.stores > 0) {
      this.stores -= provisions;
      this.drives.hunger = clamp01(this.drives.hunger - provisions);
      this.drives.thirst = clamp01(this.drives.thirst - provisions);
    }

    const { farm } = context;
    if (!farm || this.stores <= 0) return;

    // The implements live at the house and he can carry one. Swapping is the
    // only thing he can do about the wrong one being in his hands, and the
    // house is the only place he can do it.
    const wanted = TOOLS[this.wants(farm)]?.name ?? null;
    if (wanted && wanted !== this.tool && this.atHome()) {
      this.tool = wanted;
      const took = Object.values(TOOLS).find((t) => t.name === wanted);
      this.chore = { act: "took", source: null, notice: `${this.name} ${took.takes}.` };
    }

    for (const { kind, sources } of farm.stock()) {
      if (sources > 0 || this.tool !== TOOLS[kind].name) continue;
      const volume = Math.min(this.stores, RESOURCE_KINDS[kind].capacity * 0.3);
      const started = farm.sow(kind, this, volume);
      this.stores -= volume;
      this.carried[kind] += volume;
      this.sown += 1;
      this.chore = {
        act: "sowed",
        source: started,
        notice: `${this.name} sows a fresh ${started.name.toLowerCase()} — the field had no ${kind} left.`,
      };
    }

    if (this.goal !== "tend") {
      // The errand is over when he stops tending — not when he drifts a step
      // out of reach, which he does constantly while milling about a trough,
      // and which used to have him announce the same job twice.
      this.filling = null;
      return;
    }
    // The same place his steering is aimed at, so what he fills is what he
    // walked to — including the case where that is the house and a swap.
    const source = this.goalPlace(context);
    if (!source?.refill || this.tool !== TOOLS[source.kind].name) return;
    if (distance(this, source) >= source.radius + this.radius) return;

    // An errand reads as two lines however many steps it takes: setting to work
    // on a source he was not filling a moment ago, and having it back above the
    // level that made it a chore. The dozen steps of pouring in between are the
    // same errand and say nothing new.
    const wanting = source.fullness < ENOUGH;
    if (this.filling !== source.id) {
      this.filling = source.id;
      this.chore = {
        act: "started",
        source,
        notice: `${this.name} ${TOOLS[source.kind].drives} ${source.name}, down to ` +
          `${Math.round(source.volume)} ${source.unit}.`,
      };
    }

    const got = source.refill(Math.min(this.stores, this.constructor.pours));
    this.stores -= got;
    this.carried[source.kind] += got;
    if (wanting && source.fullness >= ENOUGH) {
      this.filling = null;
      this.chore = {
        act: "topped",
        source,
        notice: `${this.name} has ${source.name} back up to ${Math.round(source.volume)} ${source.unit}.`,
      };
    }
  }

  /**
   * The work in front of him, as a resource kind: whatever has run out of the
   * field altogether, and failing that the emptiest source left. Null when
   * everything is comfortable and there is nothing to fetch a tool for.
   */
  wants(farm) {
    const gone = farm.stock().find((s) => s.sources === 0)?.kind;
    if (gone) return gone;
    // He finishes the round he is equipped for before changing implements.
    // Without this he re-decides every step, and since one pour is enough to
    // make the *other* kind the emptiest, he spends his day walking between
    // the shed and nothing — thirteen swaps and five litres, when it was
    // measured. What he carries is what he works on until that work is done.
    const his = this.works;
    if (his && farm.neediestResource(ENOUGH, his)) return his;
    return farm.neediestResource()?.kind ?? null;
  }

  /**
   * Where the chore actually sends him. The goal names the emptiest source,
   * but a man holding a hose can do nothing at a meadow — so with the wrong
   * implement in his hands the first leg of the errand is the house, and only
   * then the field. Everything else steers as it does for any animal.
   */
  goalPlace(context = {}) {
    const { farm } = context;
    if (this.goal !== "tend" || !farm) return super.goalPlace(context);
    const kind = this.wants(farm);
    if (!kind) return null;
    if (TOOLS[kind].name !== this.tool) return this.constructor.home;
    // Not the emptiest source on the farm — the emptiest of the sort he is
    // carrying the implement for. The other sort is a different errand.
    return farm.neediestResource(ENOUGH, kind);
  }

  /** With nothing that needs doing, he heads back to the house. */
  roamHeading() { return this.headingToward(this.constructor.home); }

  /** Standing in his own yard, near enough to call it home. */
  atHome() { return distance(this, this.constructor.home) < this.radius * 2; }

  /**
   * Resting is somewhere, for him. Every animal here rests where it happens to
   * be standing — `rest` names no place, so a tired cow folds up in the mud —
   * but a farmer goes indoors. He is only still once he is home, and until then
   * `rest` steers him there the same way having nothing to do does: the goal
   * names no place, so it falls through to `roamHeading`, which is the path to
   * his door. Then he is in for the night, because the hour keeps rest winning
   * until morning.
   */
  isStill() { return super.isStill() && this.atHome(); }

  makeSound() { return `${this.name} whistles a tune — E-I-E-I-O.`; }
  move() { return `${this.name} walks the fence line, counting heads.`; }

  /** What he is holding, drawn on the field: a tractor is not a man on foot. */
  get emoji() { return this.tool ? TOOLS[this.works].emoji : super.emoji; }

  /** No legs on a tractor. The UI draws none and stops cropping the glyph. */
  get legs() { return this.tool ? 0 : super.legs; }

  /** The kind of work the implement in his hands is for. */
  get works() { return Object.keys(TOOLS).find((kind) => TOOLS[kind].name === this.tool); }

  /** He eats from the same fields he keeps; "crops at the grass" he does not. */
  narrate() {
    if (this.goal === "graze") return `${this.name} takes his own dinner from the field.`;
    if (this.goal === "tend" && this.tool) {
      return `${this.name} is out with the ${this.tool}.`;
    }
    return super.narrate();
  }

  /** One farmer, one name, one age. There is only ever the one of him. */
  static random() { return new Human("Old MacDonald", "Farmer", 67); }

  getAttributes() {
    return [
      ...super.getAttributes(),
      { label: "In the barn", value: `${Math.round(this.stores)} left to put down` },
      {
        label: "In his hands",
        value: this.tool ? `${TOOLS[this.works].emoji} ${this.tool}` : "nothing — both are at the house",
      },
    ];
  }
}
