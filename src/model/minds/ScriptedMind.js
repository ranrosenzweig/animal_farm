import Mind from "./Mind.js";

/**
 * Picks a goal by arithmetic: every option scores its species affinity times
 * the pressure behind it, and the highest score wins.
 *
 * The one wrinkle is commitment. A mind that re-scored from scratch every
 * deliberation would dither — swapping goals the instant two scores crossed,
 * and never walking far enough to satisfy either. So the goal it is already
 * pursuing has to be beaten by a margin, not merely edged out.
 */
export default class ScriptedMind extends Mind {
  /** Deliberate every N steps — a body ticks faster than it changes its mind. */
  static cadence = 12;

  /** How much better a rival goal must score before it wins. */
  commitment = 0.12;

  /**
   * @param {import("./Mind.js").Percept} percept
   * @returns {import("./Mind.js").Intention}
   */
  decide(percept) {
    const scored = percept.options
      .map((option) => ({ ...option, score: option.affinity * option.pressure }))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { goal: "roam", reason: "nothing else to want" };

    const best = scored[0];
    const current = scored.find((o) => o.goal === percept.self.goal);

    // Already doing something nearly as good? Stay with it.
    if (current && best.score - current.score < this.commitment) {
      return { goal: current.goal, reason: `still worth doing (${current.score.toFixed(2)})` };
    }
    return { goal: best.goal, reason: reasonFor(best) };
  }
}

function reasonFor({ goal, pressure }) {
  if (goal === "roam") return "nothing pressing";
  return `${Math.round(pressure * 100)}% pressure`;
}
