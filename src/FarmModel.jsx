import React, { useEffect, useRef, useState } from "react";
import Farm from "./model/Farm.js";
import { SPECIES, speciesNamed } from "./model/species.js";
import { centroid, clampToPasture } from "./model/pasture.js";
import { PATCHES, RELIEF } from "./model/terrain.js";
import { DRIVES, DRIVE_LABELS } from "./model/drives.js";
import ScriptedMind from "./model/minds/ScriptedMind.js";
import ClaudeMind from "./model/minds/ClaudeMind.js";
import { sourceOf } from "./sources.js";

/** How each goal reads on screen. Presentation only — the model has no icons. */
const GOAL_ICONS = {
  graze: "🌿", drink: "💧", wallow: "🫧", flock: "👥", rest: "😴", roam: "🚶", mate: "❤️",
};

const SEX_MARKS = { female: "♀", male: "♂" };

const RESOURCE_ICONS = { water: "💧", grass: "🌿" };

/**
 * The field is drawn as ground tilting away from the viewer. Depth is the
 * model's own y: the far edge of the field is narrower than the near one, and
 * an animal standing back there is drawn smaller and hazier.
 *
 * This is presentation only — src/model still deals in a flat 100×100 field
 * and knows nothing about a camera. One projection is applied on the way to
 * the screen, and undone on the way back when the farmer clicks.
 *
 * Depth is linear rather than the reciprocal a real lens gives. A lens would
 * crowd the far rows together, but it would also make unproject() a division
 * by something that goes to zero at the horizon; linear stays honestly
 * invertible, and the width and size cues carry the depth on their own.
 */
const HORIZON = 12;
/** Width of the far edge of the field, as a fraction of the near edge. */
const FAR_WIDTH = 0.78;
/** Size of a sprite standing at the far edge, as a fraction of one at the near edge. */
const FAR_SCALE = 0.6;

/** 0 at the horizon, 1 at the near edge. */
const depthAt = (y) => (y - HORIZON) / (100 - HORIZON);

/** How much of the field's full width is left at depth `y`. */
const widthAt = (y) => FAR_WIDTH + (1 - FAR_WIDTH) * depthAt(y);

/** How big something standing or lying at depth `y` is drawn. */
const sizeAt = (y) => FAR_SCALE + (1 - FAR_SCALE) * depthAt(y);

/** A spot on the ground, as the screen has it. */
const project = ({ x, y }) => ({ x: 50 + (x - 50) * widthAt(y), y });

/** A spot on the screen, as the ground has it. The exact inverse of project. */
const unproject = ({ x, y }) => ({ x: 50 + (x - 50) / widthAt(y), y });

/**
 * Everything the screen needs to stand something on the ground at `spot`:
 * where it goes, how big it is there, how much the distance washes it out,
 * and who it is in front of.
 */
function standing(spot) {
  return {
    left: `${project(spot).x}%`,
    top: `${spot.y}%`,
    "--depth-scale": sizeAt(spot.y),
    "--haze": 0.7 + 0.3 * depthAt(spot.y),
    // Nearer animals occlude further ones. The fence sits above the lot.
    zIndex: Math.round(spot.y * 10),
  };
}

/** The trapezoid the ground fills, in the ground layer's own box. */
const GROUND_CLIP = `polygon(${project({ x: 0, y: HORIZON }).x}% 0, ` +
  `${project({ x: 100, y: HORIZON }).x}% 0, 100% 100%, 0 100%)`;

/**
 * Where the trees stand in each wood, as fractions of the patch's radius.
 * Fixed rather than random: the ground under them does not move between
 * renders, so neither should they.
 */
const TREE_SPOTS = [[-0.45, -0.2], [0.4, -0.42], [0.02, 0.34], [-0.15, -0.62]];

const TREES = PATCHES.filter((patch) => patch.ground === "wood").flatMap((patch, w) =>
  TREE_SPOTS.map(([dx, dy], t) => ({
    key: `${w}-${t}`,
    x: patch.x + dx * patch.radius,
    y: patch.y + dy * patch.radius,
  })),
);

/**
 * The lie of the land, drawn from the very numbers the animals walk on.
 *
 * Every hill here is one of `RELIEF`'s bumps and every patch one of `PATCHES`,
 * at the same place and the same size — so this is not a picture of a field
 * that resembles the model, it is the model, shaded. A rock you can see is a
 * rock an animal bounces off, and the pale shoulder of a rise is the ground a
 * cow will labour up.
 *
 * Each piece is laid down as a `fa-feature`, the same way a pond is: projected
 * across, and foreshortened by the same 3:1 the ponds use. That matters more
 * than it sounds. If the terrain were drawn flat while the herd was drawn in
 * perspective, the rock on screen would not be where the rock in the model is,
 * and every claim this makes would be a lie.
 */
function PastureTerrain() {
  return (
    <>
      {RELIEF.map((bump, i) => (
        <div
          key={`relief-${i}`}
          className={`fa-feature fa-relief ${bump.height > 0 ? "rise" : "hollow"}`}
          aria-hidden="true"
          style={{
            left: `${project(bump).x}%`,
            top: `${bump.y}%`,
            width: `${bump.spread * 2.2 * sizeAt(bump.y)}%`,
            opacity: Math.min(0.8, Math.abs(bump.height) * 1.5),
          }}
        />
      ))}
      {PATCHES.map((patch, i) => (
        <div
          key={`patch-${i}`}
          className={`fa-feature fa-ground-${patch.ground}`}
          aria-hidden="true"
          style={{
            left: `${project(patch).x}%`,
            top: `${patch.y}%`,
            width: `${patch.radius * 2 * sizeAt(patch.y)}%`,
          }}
        />
      ))}
    </>
  );
}

/**
 * How long one step takes, until the farmer says otherwise. The sprite's CSS
 * transition is driven from this same number, so an animal is still gliding
 * into its last spot exactly as the next step is decided — the walk looks
 * continuous instead of a dart followed by a wait.
 */
const STEP_MS = 600;

/** The range the settings slider offers, either side of STEP_MS. */
const STEP_MIN = 150;
const STEP_MAX = 1500;

/**
 * The minds the farmer can put behind an animal. Both take a cadence, so the
 * settings section can hand one straight to whichever is picked.
 */
const MINDS = {
  scripted: { label: "Scripted", Mind: ScriptedMind },
  claude: { label: "Claude", Mind: ClaudeMind },
};

/** How many log lines are kept, whatever the settings choose to show. */
const LOG_KEPT = 50;
const LOG_SHOWN = [8, 20, 50];

/**
 * How far one arrow key slides the drop point, in pasture percent. Big enough
 * to cross the field in a dozen presses, small enough to drop a trough beside
 * one animal rather than on top of the herd.
 */
const NUDGE = 5;

const NUDGE_KEYS = {
  ArrowUp: { x: 0, y: -NUDGE },
  ArrowDown: { x: 0, y: NUDGE },
  ArrowLeft: { x: -NUDGE, y: 0 },
  ArrowRight: { x: NUDGE, y: 0 },
};

/**
 * How a settled dispute reads in the log. Whether the two of them already
 * knew each other is the whole point of the encounter, so the line says so:
 * familiar animals stand aside, strangers have to back down.
 */
function contestNotice({ winner, loser, source }) {
  const verb = loser.familiarity(winner) > 0.5 ? "stands aside for" : "backs down from";
  return `${loser.name} ${verb} ${winner.name} at the ${source.name.toLowerCase()}.`;
}

/** Calm when a drive is low, urgent when it is high. Condition passes 1 - health. */
function driveColor(level) {
  if (level < 0.4) return "#6f9451";
  if (level < 0.75) return "#C9922F";
  return "#a13c2c";
}

/**
 * A live view of the farm model. Every piece of information on screen is
 * read off the model — the head counts, the attribute card, the daily
 * yield and the source panel all come from the classes in src/model.
 */
export default function FarmModel() {
  const [farm, setFarm] = useState(() => Farm.starter("The Farm Registry"));
  const [selectedId, setSelectedId] = useState(() => null);
  const [log, setLog] = useState([{ id: "start", text: "The farm registry opens for the day.", kind: "info" }]);
  const [speakingId, setSpeakingId] = useState(null);
  const [addSpecies, setAddSpecies] = useState(SPECIES[0].species);
  const [showSource, setShowSource] = useState(false);
  const [roaming, setRoaming] = useState(false);
  /** Which kind of resource the next pasture click puts down, if any. */
  const [placing, setPlacing] = useState(null);
  /** Where the keys would drop it, in pasture percent. Null when nothing is armed. */
  const [dropAt, setDropAt] = useState(null);

  /* Settings. Every one of these is a live knob: nothing here is read once. */
  const [stepMs, setStepMs] = useState(STEP_MS);
  const [mindKind, setMindKind] = useState("scripted");
  const [cadence, setCadence] = useState(ScriptedMind.cadence);
  const [showTags, setShowTags] = useState(true);
  const [calm, setCalm] = useState(false);
  const [logLines, setLogLines] = useState(LOG_SHOWN[0]);

  const selected = farm.find(selectedId) ?? farm.animals[0];
  const companions = selected ? farm.companionsOf(selected) : [];
  const census = farm.census();
  const produce = farm.dailyProduce();
  const activity = farm.activity();
  const stock = farm.stock();
  const expecting = farm.animals.filter((a) => a.isPregnant).length;

  // Farm.stepAll() walks the animals as a side effect, so the roam timer reads
  // the current farm through a ref rather than a state updater — React invokes
  // updaters twice under StrictMode, which would step everyone twice a tick.
  const farmRef = useRef(farm);
  farmRef.current = farm;

  // The pasture is only a tab stop while something is armed, so there is no
  // dead stop in the ordinary tab order; focus is handed to it the moment the
  // farmer picks up a bucket, and handed back when they put it down.
  const pastureRef = useRef(null);
  const armedFrom = useRef(null);

  useEffect(() => {
    if (placing) pastureRef.current?.focus();
  }, [placing]);

  // An animal is born with a ScriptedMind of its own, so this runs against the
  // whole herd on every farm change rather than only when the setting moves —
  // otherwise a lamb born under the Claude setting would quietly think for
  // itself. Re-seating a mind costs it whatever it had latched, so a mind that
  // is already the right kind at the right cadence is left where it is.
  useEffect(() => {
    const { Mind } = MINDS[mindKind];
    for (const animal of farm.animals) {
      if (animal.mind.constructor === Mind && animal.mind.cadence === cadence) continue;
      animal.mind = new Mind({ cadence });
    }
  }, [farm, mindKind, cadence]);

  useEffect(() => {
    if (!roaming) return undefined;
    const timer = window.setInterval(() => {
      const { farm: next, died, dried, born, contests } = farmRef.current.stepAll();
      setFarm(next);
      for (const source of dried) pushLog(`${source.name} has run dry.`, "empty");
      for (const settled of contests) pushLog(contestNotice(settled), "contest");
      for (const baby of born) pushLog(baby.birthNotice(), "born");
      for (const animal of died) pushLog(animal.epitaph(), "died");
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [roaming, stepMs]);

  function pushLog(text, kind) {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...l].slice(0, LOG_KEPT));
  }

  function runAction(kind) {
    if (!selected) return;
    if (kind === "move") return walk(selected);
    pushLog(selected[kind](), kind);
    if (kind === "makeSound") {
      setSpeakingId(selected.id);
      window.clearTimeout(runAction._t);
      runAction._t = window.setTimeout(() => setSpeakingId(null), 1800);
    }
  }

  /**
   * One step of being alive: the animal feels, may reconsider, and acts. The
   * farm decides where — or whether — it can go.
   */
  function walk(animal) {
    const { farm: next, outcome, died, born, contests } = farm.step(animal.id);
    setFarm(next);
    if (outcome === "blocked") {
      pushLog(`${animal.name} is hemmed in and stays put.`, "move");
    } else {
      pushLog(animal.narrate(), animal.goal);
    }
    for (const settled of contests) pushLog(contestNotice(settled), "contest");
    for (const baby of born) pushLog(baby.birthNotice(), "born");
    for (const lost of died) pushLog(lost.epitaph(), "died");
  }

  /**
   * Pick up a bucket. The drop point starts in the middle of the herd, because
   * that is where feed and water are wanted and it costs no keypresses to get
   * there; the arrows are for the last few percent.
   */
  function arm(kind, button) {
    if (placing === kind) return cancelPlacing();
    armedFrom.current = button;
    setDropAt(clampToPasture(centroid(farm.animals) ?? { x: 50, y: 50 }));
    setPlacing(kind);
  }

  function cancelPlacing() {
    setPlacing(null);
    armedFrom.current?.focus();
  }

  /** Put water or grass down at a spot in pasture percent. */
  function place(at) {
    const { farm: next, resource } = farm.addResource(placing, at);
    setFarm(next);
    setPlacing(null);
    pushLog(`${resource.name} put down — ${Math.round(resource.volume)} ${resource.unit}.`, placing);
    // The pasture stops being a tab stop the instant this lands, so send focus
    // back to the button that armed it rather than dropping it on the body.
    armedFrom.current?.focus();
  }

  /** Put water or grass wherever the farmer clicked. */
  function placeAt(event) {
    if (!placing) return;
    // Enter on a sprite raises a click with no coordinates, which used to land
    // the resource in the corner of the fence. The keys have their own path.
    if (event.detail === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    // The click lands on the tilted ground, so read it back off the projection
    // — otherwise a trough dropped at the far edge would slide toward the
    // middle of the field on its way to being drawn.
    place(unproject({
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    }));
  }

  /** The same capability without a pointer: arrows steer, Enter drops, Esc puts it back. */
  function steer(event) {
    if (!placing) return;
    if (event.key === "Escape") return cancelPlacing();
    const nudge = NUDGE_KEYS[event.key];
    if (nudge) {
      event.preventDefault();
      setDropAt((at) => clampToPasture({ x: at.x + nudge.x, y: at.y + nudge.y }));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      place(dropAt);
    }
  }

  function addAnimal() {
    const fresh = speciesNamed(addSpecies).random();
    const { farm: next, added } = farm.add(fresh);
    if (!added) {
      pushLog(`No room in the pasture for another ${fresh.species.toLowerCase()}.`, "info");
      return;
    }
    setFarm(next);
    setSelectedId(fresh.id);
    setShowSource(false);
    pushLog(`${fresh.name} the ${fresh.species.toLowerCase()} joins the farm.`, "info");
  }

  function removeSelected() {
    if (!selected) return;
    const { id, name, species } = selected;
    setFarm(farm.remove(id));
    setSelectedId(null);
    setShowSource(false);
    pushLog(`${name} the ${species.toLowerCase()} leaves the pasture.`, "info");
  }

  return (
    <div
      className={"farm-app" + (calm ? " calm" : "")}
      style={{ "--step-duration": `${stepMs}ms` }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;600&display=swap');

        .farm-app {
          --sky: #dfe9da;
          --sky-2: #c9dcc4;
          --field-1: #6f9451;
          --field-2: #47632f;
          --wood: #7a5230;
          --wood-dark: #573a20;
          --barn-red: #a13c2c;
          --cream: #f6efdd;
          --ink: #2e2a1f;
          --straw: #c98a3a;
          font-family: 'Inter', sans-serif;
          color: var(--ink);
          background: var(--sky);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .farm-app * { box-sizing: border-box; }

        .fa-header {
          background: linear-gradient(180deg, var(--wood), var(--wood-dark));
          padding: 18px 20px 14px;
          border-bottom: 4px solid var(--wood-dark);
        }
        .fa-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 34px;
          letter-spacing: 1.5px;
          color: var(--cream);
          line-height: 1;
        }
        .fa-subtitle {
          font-style: italic;
          font-size: 13px;
          color: #e8dcc2;
          margin-top: 4px;
        }
        .fa-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .fa-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(246,239,221,0.12);
          border: 1px solid rgba(246,239,221,0.35);
          color: var(--cream);
          padding: 4px 10px 4px 6px;
          border-radius: 999px;
          font-size: 12px;
          cursor: pointer;
        }
        .fa-chip:hover { background: rgba(246,239,221,0.22); }
        .fa-chip:disabled { opacity: 0.4; cursor: default; }
        .fa-chip .dot {
          width: 9px; height: 9px; border-radius: 50%;
        }
        .fa-chip .n { font-family: 'JetBrains Mono', monospace; opacity: 0.85; }

        .fa-body {
          display: flex;
          gap: 16px;
          padding: 16px;
        }
        @media (max-width: 820px) {
          .fa-body { flex-direction: column; }
        }

        .fa-pasture {
          position: relative;
          /* Wider than it used to be: a field that recedes needs room across
             the near edge, or the taper reads as a runway. */
          flex: 1.6;
          min-height: 360px;
          border-radius: 10px;
          overflow: hidden;
          /* Sky only. The field is a separate, tapered plane laid over it. */
          background: linear-gradient(180deg, var(--sky) 0%, var(--sky-2) 100%);
          border: 3px solid var(--wood-dark);
        }
        /* Low hills, so the field ends against something instead of stopping. */
        .fa-hills {
          position: absolute;
          left: 0; right: 0; top: 0;
          height: ${HORIZON}%;
          background:
            radial-gradient(30% 62% at 20% 108%, #a9bda0 0 72%, transparent 74%),
            radial-gradient(22% 44% at 44% 108%, #b6c7ac 0 72%, transparent 74%),
            radial-gradient(34% 70% at 74% 108%, #9fb597 0 72%, transparent 74%);
        }
        /* The ground, seen from a standing farmer's height. Its furrows are
           evenly spaced because the projection is linear in depth; the taper
           and the haze at the far edge are what read as distance. */
        .fa-ground {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          top: ${HORIZON}%;
          clip-path: ${GROUND_CLIP};
          background:
            linear-gradient(180deg, rgba(223,233,218,0.55) 0%, transparent 18%),
            repeating-linear-gradient(180deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 6.5%),
            linear-gradient(180deg, #7d9c5c 0%, var(--field-1) 30%, var(--field-2) 100%);
        }
        /* The lie of the land. Every one of these is a bump or a patch out of
           terrain.js, drawn where the model keeps it — the sun is up and to
           the left throughout, so a rise catches light on its near shoulder
           and a hollow catches it on its far one, which is the whole of what
           makes a dip read as a dip rather than a mound. */
        .fa-relief.rise {
          background: radial-gradient(ellipse at 38% 28%, #c8da91 0%, rgba(200,218,145,0) 68%);
        }
        .fa-relief.hollow {
          background: radial-gradient(ellipse at 62% 72%, #294016 0%, rgba(41,64,22,0) 68%);
        }
        .fa-ground-mud {
          background: radial-gradient(ellipse at 50% 40%, #7d5c3d 0%, #5c4229 60%, #46311d 100%);
          box-shadow: inset 0 3px 6px rgba(0,0,0,0.4);
          opacity: 0.85;
        }
        .fa-ground-wood {
          background: radial-gradient(ellipse at 50% 45%, #35551f 0%, #24401a 100%);
          opacity: 0.5;
        }
        /* Rock is drawn at exactly the radius animals bounce off, so what you
           see is what they hit. Cool grey against all this green. */
        .fa-ground-rock {
          background: radial-gradient(ellipse at 42% 30%, #bcbbb4 0%, #8b8b86 45%, #4a4a47 100%);
          box-shadow: 0 3px 5px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.35);
        }
        /* Trees stand on the woodland patches. Woodland only slows an animal,
           so they are scenery over real ground rather than obstacles. */
        .fa-tree {
          position: absolute;
          transform: translate(-50%, -62%) scale(var(--depth-scale, 1));
          font-size: 19px;
          pointer-events: none;
          opacity: var(--haze, 1);
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
        }
        /* Two rails and a run of posts, drawn at foreground size. It sits above
           every sprite, so an animal at the front of the field passes behind
           it — which is most of what tells you the field has a front. */
        .fa-fence {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 42px;
          z-index: 1200;
          background:
            repeating-linear-gradient(90deg, var(--wood) 0 7px, transparent 7px 36px),
            linear-gradient(180deg,
              transparent 0 9px, var(--wood) 9px 14px,
              transparent 14px 26px, var(--wood) 26px 31px, transparent 31px);
          opacity: 0.8;
        }
        .fa-barn {
          position: absolute;
          /* Stands on its own ground spot: the origin is its base, not middle. */
          transform: translate(-50%, -100%) scale(var(--depth-scale, 1));
          transform-origin: 50% 100%;
          font-size: 46px;
          filter: drop-shadow(0 3px 3px rgba(0,0,0,0.25)) saturate(var(--haze, 1));
        }

        .fa-sprite {
          position: absolute;
          transform: translate(-50%, -50%);
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0;
          animation: bob 2.6s ease-in-out infinite;
          /* The model relocates the animal; the walk between spots is ours.
             Linear, and exactly as long as a step, so an animal that keeps
             walking never visibly stops between steps. */
          transition:
            left var(--step-duration, 600ms) linear,
            top var(--step-duration, 600ms) linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .fa-sprite, .fa-sprite .emoji { transition: none; animation: none; }
        }
        /* The same stillness, asked for by hand rather than by the system —
           for a farmer whose OS says nothing but who wants the field to hold
           still while they read it. Animals still move; they just cut. */
        .farm-app.calm .fa-sprite,
        .farm-app.calm .fa-sprite .emoji,
        .farm-app.calm .fa-bubble,
        .farm-app.calm .fa-aim { transition: none; animation: none; }
        /* Only the animal takes the depth, not its name tag: a tag scaled down
           to the far edge would be 6px of text nobody could read. */
        .fa-sprite .emoji {
          position: relative;
          font-size: 30px;
          filter: drop-shadow(0 2px 1px rgba(0,0,0,0.22)) saturate(var(--haze, 1));
          transform: scale(var(--depth-scale, 1));
          /* Its feet are what stand on the ground, so scale from there. */
          transform-origin: 50% 100%;
          transition: transform var(--step-duration, 600ms) linear;
        }
        /* The patch of shade an animal stands in. Painted behind the emoji
           itself — a negative z-index child draws under its parent's text. */
        .fa-sprite .shade {
          position: absolute;
          left: 50%;
          bottom: 2px;
          transform: translateX(-50%);
          width: 30px;
          height: 9px;
          border-radius: 50%;
          background: radial-gradient(closest-side, rgba(30,42,18,0.55), rgba(30,42,18,0.05));
          filter: blur(1.5px);
          z-index: -1;
        }
        /* An expecting female is marked twice: a badge on the animal itself,
           and a coloured name tag, so she is findable without hunting. */
        .fa-sprite .expecting {
          position: absolute;
          right: -7px;
          bottom: -3px;
          font-size: 14px;
          line-height: 1;
          text-shadow: 0 0 4px #fff, 0 0 4px #fff, 0 0 4px #fff;
        }
        .fa-sprite .tag.expecting {
          background: #f7dbe4;
          border-color: var(--barn-red);
          color: #7d2a1e;
          font-weight: 600;
        }
        .fa-sprite.selected .emoji {
          transform: scale(calc(var(--depth-scale, 1) * 1.18));
        }
        .fa-sprite .tag {
          margin-top: 2px;
          font-size: 10px;
          background: var(--cream);
          border: 1px solid var(--wood);
          border-radius: 5px;
          padding: 1px 5px;
          font-family: 'JetBrains Mono', monospace;
          white-space: nowrap;
        }
        @keyframes bob {
          0%, 100% { margin-top: 0px; }
          50% { margin-top: -4px; }
        }
        .fa-bubble {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: white;
          border: 1px solid var(--wood);
          border-radius: 8px;
          padding: 3px 8px;
          font-size: 11px;
          white-space: nowrap;
          margin-bottom: 6px;
          animation: pop 0.2s ease-out;
        }
        @keyframes pop {
          from { opacity: 0; transform: translateX(-50%) scale(0.7); }
          to { opacity: 1; transform: translateX(-50%) scale(1); }
        }
        .fa-feature {
          position: absolute;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          pointer-events: none;
          /* A pond is round where it lies; from here it is an ellipse. The
             ratio is taken off the rendered width rather than set in percent,
             because a percentage height is measured against the pasture's
             height — which is how these came out as beach balls. */
          aspect-ratio: 3 / 1;
        }
        .fa-source {
          /* size and opacity come from how much is left, so a drained source
             visibly shrinks and fades before it disappears */
          transition: width 0.4s linear, opacity 0.4s linear;
        }
        /* All three lie flat on the ground, so they get the same squash as the
           field and a lip of shadow where they meet it. */
        /* Lit from above and behind, so the near lip catches the light and the
           far one sits in the bank's shadow. */
        .fa-water {
          background: radial-gradient(ellipse at 50% 78%, #8fc3e2 0%, #5896c2 55%, #3E7CA6 100%);
          box-shadow: inset 0 3px 5px rgba(20,45,65,0.45), 0 2px 3px rgba(38,48,26,0.3);
        }
        .fa-grass {
          background: radial-gradient(ellipse at 50% 75%, #9ccb6c 0%, #6b9b41 55%, #4d7a2e 100%);
          box-shadow: inset 0 3px 5px rgba(30,50,20,0.35), 0 2px 3px rgba(38,48,26,0.28);
        }
        .fa-pasture.placing { cursor: crosshair; }
        .fa-pasture.placing .fa-sprite { cursor: crosshair; }
        /* Barn red, not cream: the ring sits against the pale sky at the top of
           the field, where cream would vanish. */
        .fa-pasture:focus-visible {
          outline: 3px solid var(--barn-red);
          outline-offset: 2px;
        }
        /* Where the keys would drop it. A pointer already says where it is
           aiming, so the marker only appears for a keyboard-driven focus. */
        .fa-aim {
          position: absolute;
          transform: translate(-50%, -50%);
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 2px dashed var(--cream);
          background: rgba(246,239,221,0.25);
          /* Over every animal, under the fence: it has to stay findable even
             when the drop point is behind the herd. */
          z-index: 1100;
          box-shadow: 0 0 0 2px rgba(46,42,31,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          pointer-events: none;
          opacity: 0;
          transition: left 120ms ease-out, top 120ms ease-out;
        }
        .fa-pasture:focus-visible .fa-aim { opacity: 1; }
        /* Its own block, not the one up by .fa-sprite: an override that came
           earlier in the sheet would lose the tie to the rule above. */
        @media (prefers-reduced-motion: reduce) {
          .fa-aim { transition: none; }
        }
        .fa-empty {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--cream);
          font-style: italic;
          font-size: 13px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.35);
        }

        .fa-panel { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 260px; }

        .fa-card {
          position: relative;
          background: var(--cream);
          border: 1px solid #e3d6b3;
          border-radius: 6px;
          padding: 16px 16px 14px;
          transform: rotate(-1.2deg);
          box-shadow: 2px 3px 0 rgba(0,0,0,0.08);
        }
        .fa-card::before {
          content: "";
          position: absolute;
          top: -10px; left: 18px;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: var(--sky);
          border: 2px solid var(--wood);
        }
        .fa-card-species {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--barn-red);
          margin-bottom: 2px;
        }
        .fa-card-name {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 26px;
          letter-spacing: 0.5px;
          line-height: 1.05;
        }
        .fa-card-name .sex { color: var(--barn-red); }
        .fa-intent {
          display: flex;
          align-items: baseline;
          gap: 6px;
          margin-top: 6px;
          font-size: 12.5px;
          font-weight: 600;
        }
        .fa-intent .why {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 400;
          color: #6b5f42;
        }
        .fa-drives { margin-top: 10px; display: grid; gap: 4px; }
        .fa-drive {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          color: #6b5f42;
        }
        .fa-drive .n { width: 66px; flex-shrink: 0; }
        .fa-drive .bar {
          flex: 1;
          height: 5px;
          background: #e3d6b3;
          border-radius: 3px;
          overflow: hidden;
        }
        .fa-drive .fill { height: 100%; transition: width var(--step-duration, 600ms) linear; }
        .fa-drive .pct {
          width: 30px;
          text-align: right;
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
        }

        .fa-attrs { margin-top: 10px; }
        .fa-attr-row {
          display: flex;
          justify-content: space-between;
          font-size: 12.5px;
          padding: 3px 0;
          border-bottom: 1px dashed #d9caa0;
        }
        .fa-attr-row .l { color: #6b5f42; }
        .fa-attr-row .v { font-family: 'JetBrains Mono', monospace; font-weight: 600; }

        .fa-bonds { margin-top: 10px; display: grid; gap: 4px; }
        .fa-bonds .lbl {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
        }
        .fa-bonds .none { font-size: 11px; color: #6b5f42; font-style: italic; }
        .fa-bonds .tie {
          font-family: 'Inter', sans-serif;
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          padding: 1px 0;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 11px;
          color: #6b5f42;
          text-align: left;
        }
        .fa-bonds .tie:hover .who { color: var(--wood); }
        .fa-bonds .who {
          width: 96px;
          flex-shrink: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fa-bonds .bar {
          flex: 1;
          height: 5px;
          background: #e3d6b3;
          border-radius: 3px;
          overflow: hidden;
        }
        .fa-bonds .fill {
          /* A span is inline, and width does nothing to an inline box —
             without this the bar is an empty track at every tie strength. */
          display: block;
          height: 100%;
          background: var(--wood);
          transition: width var(--step-duration, 600ms) linear;
        }

        .fa-actions { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
        .fa-btn {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 600;
          border: none;
          border-radius: 6px;
          padding: 7px 10px;
          cursor: pointer;
          background: var(--wood);
          color: var(--cream);
        }
        .fa-btn:hover { background: var(--wood-dark); }
        .fa-btn.alt {
          background: transparent;
          color: var(--wood-dark);
          border: 1px solid var(--wood);
        }

        .fa-code {
          margin-top: 10px;
          background: #241f16;
          color: #e9dfc4;
          border-radius: 6px;
          padding: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          line-height: 1.5;
          white-space: pre-wrap;
          max-height: 180px;
          overflow-y: auto;
        }

        .fa-yield {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12.5px;
        }
        .fa-yield .lbl {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
        }
        .fa-yield .item { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
        .fa-yield .none { color: #6b5f42; font-style: italic; }

        .fa-add {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .fa-add select {
          flex: 1;
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          padding: 6px 8px;
          border-radius: 5px;
          border: 1px solid #ccc;
        }

        /* Shut by default: these are the farm's dials, not its controls, and
           an open panel of them would crowd out the log. */
        .fa-settings {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
        }
        .fa-settings > summary {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
          cursor: pointer;
          /* The stock triangle sits on its own baseline and can't be coloured;
             a ::before is a caret that lines up with 10px caps. */
          list-style: none;
        }
        .fa-settings > summary::-webkit-details-marker { display: none; }
        .fa-settings > summary::before { content: "▸"; font-size: 9px; }
        .fa-settings[open] > summary::before { content: "▾"; }
        .fa-settings[open] > summary { margin-bottom: 4px; }
        .fa-settings > summary:focus-visible {
          outline: 2px solid var(--wood);
          outline-offset: 2px;
          border-radius: 3px;
        }
        .fa-set-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 12.5px;
          padding: 6px 0;
          border-bottom: 1px dashed #ececec;
        }
        .fa-set-row .l { color: #6b5f42; width: 92px; flex-shrink: 0; }
        /* Fixed width, monospace: the readout must not shove the slider
           sideways as the number under it gets longer. */
        .fa-set-row .v {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          font-weight: 600;
          width: 58px;
          text-align: right;
          flex-shrink: 0;
        }
        .fa-set-row input[type="range"] { flex: 1; min-width: 0; accent-color: var(--wood); }
        .fa-set-row select {
          flex: 1;
          min-width: 0;
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          padding: 5px 7px;
          border-radius: 5px;
          border: 1px solid #ccc;
          background: white;
        }
        .fa-set-checks {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          padding-top: 9px;
        }
        .fa-set-checks label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: #6b5f42;
          cursor: pointer;
        }
        .fa-set-checks input { accent-color: var(--wood); }
        .fa-set-note {
          font-size: 11px;
          font-style: italic;
          color: #6b5f42;
          padding-top: 8px;
        }

        .fa-log {
          background: #fffdf7;
          border: 1px solid #e6ddc4;
          border-radius: 8px;
          padding: 10px 12px;
          flex: 1;
          min-height: 90px;
          max-height: 170px;
          overflow-y: auto;
        }
        .fa-log-title {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: #6b5f42;
          margin-bottom: 6px;
        }
        .fa-log-row {
          font-size: 12px;
          padding: 3px 0;
          border-bottom: 1px solid #f0e9d3;
          display: flex;
          gap: 6px;
        }
        .fa-log-row:last-child { border-bottom: none; }
        .fa-log-row .k {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
          color: var(--barn-red);
          flex-shrink: 0;
          padding-top: 2px;
        }
      `}</style>

      <div className="fa-header">
        <div className="fa-title">{farm.name.toUpperCase()}</div>
        <div className="fa-subtitle">
          an object model, out to pasture — {farm.size} {farm.size === 1 ? "animal" : "animals"} on the books
        </div>
        <div className="fa-chips">
          <div className="fa-chip" style={{ opacity: 0.75, cursor: "default" }}>
            <span className="dot" style={{ background: "#cfe8d8" }} />
            Animal (base class)
          </div>
          {census.map((pen) => (
            <button
              key={pen.species}
              className="fa-chip"
              disabled={pen.count === 0}
              onClick={() => {
                const first = farm.bySpecies(pen.species)[0];
                if (first) { setSelectedId(first.id); setShowSource(false); }
              }}
            >
              <span className="dot" style={{ background: pen.color }} />
              {pen.emoji} {pen.species}
              <span className="n">×{pen.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fa-body">
        <div
          ref={pastureRef}
          className={"fa-pasture" + (placing ? " placing" : "")}
          onClick={placeAt}
          onKeyDown={steer}
          // Only reachable, and only an application, while a bucket is in hand:
          // otherwise the arrow keys belong to the reader, not to us.
          tabIndex={placing ? 0 : undefined}
          role={placing ? "application" : undefined}
          aria-label={placing
            ? `Pasture — arrow keys to aim the ${placing}, Enter to put it down, Escape to cancel`
            : undefined}
        >
          <div className="fa-hills" aria-hidden="true" />
          <div className="fa-ground" aria-hidden="true" />
          {/* The mud is no longer a landmark laid on the field — it is one of
              the terrain's patches now, and gets drawn with the rest of them. */}
          <PastureTerrain />
          <div className="fa-barn" style={standing({ x: 84, y: 18 })}>🏚️</div>
          {TREES.map((tree) => (
            <div key={tree.key} className="fa-tree" style={standing(tree)} aria-hidden="true">🌳</div>
          ))}
          {farm.resources.map((source) => (
            <div
              key={source.id}
              className={`fa-feature fa-source fa-${source.kind}`}
              title={source.describe()}
              style={{
                left: `${project(source).x}%`,
                top: `${source.y}%`,
                width: `${source.radius * 2 * sizeAt(source.y)}%`,
                opacity: 0.45 + source.fullness * 0.45,
              }}
            />
          ))}
          {farm.animals.map((a) => (
            <button
              key={a.id}
              className={"fa-sprite" + (a.id === selected?.id ? " selected" : "")}
              style={standing(a)}
              onClick={(event) => {
                // While placing, let the click through to the pasture beneath.
                if (placing) return;
                event.stopPropagation();
                setSelectedId(a.id);
                setShowSource(false);
              }}
              title={a.isPregnant
                ? `${a.describe()} Expecting by ${a.pregnancy.by}, ${a.pregnancy.left} steps to go.`
                : a.describe()}
            >
              {speakingId === a.id && (
                <div className="fa-bubble">{a.makeSound().split('"')[1] ? `"${a.makeSound().split('"')[1]}"` : "…"}</div>
              )}
              {/* Newborns are visibly smaller until they grow up. */}
              <span className="emoji" style={a.isAdult ? undefined : { fontSize: "18px" }}>
                <span className="shade" aria-hidden="true" />
                {a.emoji}
                {a.isPregnant && <span className="expecting">🤰</span>}
              </span>
              {showTags && (
                <span className={"tag" + (a.isPregnant ? " expecting" : "")}>
                  {a.name} {SEX_MARKS[a.sex]}
                </span>
              )}
            </button>
          ))}
          {placing && dropAt && (
            <div
              className="fa-aim"
              style={{ left: `${project(dropAt).x}%`, top: `${dropAt.y}%` }}
              aria-hidden="true"
            >
              {RESOURCE_ICONS[placing]}
            </div>
          )}
          {farm.size === 0 && <div className="fa-empty">The pasture is empty. Add an animal below.</div>}
          <div className="fa-fence" />
        </div>

        <div className="fa-panel">
          {selected && (
            <div className="fa-card">
              <div className="fa-card-species">class {selected.species} extends Animal</div>
              <div className="fa-card-name">
                {selected.emoji} {selected.name} <span className="sex">{SEX_MARKS[selected.sex]}</span>
              </div>
              <div className="fa-intent">
                <span>{GOAL_ICONS[selected.goal] ?? "•"} {selected.goal}</span>
                <span className="why">{selected.intention.reason}</span>
              </div>
              {selected.isPregnant && (
                <div className="fa-intent">
                  <span>🤰 expecting</span>
                  <span className="why">
                    by {selected.pregnancy.by} · {selected.pregnancy.left} steps to go
                  </span>
                </div>
              )}
              {!selected.isAdult && (
                <div className="fa-intent">
                  <span>🍼 young</span>
                  <span className="why">
                    grown in {Math.max(0, selected.constructor.maturesAt - selected.stepsAlive)} steps
                  </span>
                </div>
              )}
              <div className="fa-drives">
                <div className="fa-drive">
                  <span className="n">Condition</span>
                  <span className="bar">
                    <span
                      className="fill"
                      style={{
                        width: `${selected.health * 100}%`,
                        background: driveColor(1 - selected.health),
                      }}
                    />
                  </span>
                  <span className="pct">{Math.round(selected.health * 100)}%</span>
                </div>
                {DRIVES.map((drive) => {
                  const level = selected.drives[drive];
                  return (
                    <div className="fa-drive" key={drive}>
                      <span className="n">{DRIVE_LABELS[drive]}</span>
                      <span className="bar">
                        <span
                          className="fill"
                          style={{ width: `${level * 100}%`, background: driveColor(level) }}
                        />
                      </span>
                      <span className="pct">{Math.round(level * 100)}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="fa-attrs">
                {selected.getAttributes().map((attr) => (
                  <div className="fa-attr-row" key={attr.label}>
                    <span className="l">{attr.label}</span>
                    <span className="v">{attr.value}</span>
                  </div>
                ))}
              </div>
              <div className="fa-bonds">
                <span className="lbl">Keeps company with</span>
                {companions.length === 0 ? (
                  <span className="none">nobody yet</span>
                ) : (
                  companions.map(({ animal, tie }) => (
                    <button
                      className="tie"
                      key={animal.id}
                      onClick={() => setSelectedId(animal.id)}
                      title={`${Math.round(tie * 100)}% familiar`}
                    >
                      <span className="who">{animal.emoji} {animal.name}</span>
                      <span className="bar">
                        <span className="fill" style={{ width: `${tie * 100}%` }} />
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="fa-actions">
                <button className="fa-btn" onClick={() => runAction("makeSound")}>🔊 Make sound</button>
                <button className="fa-btn" onClick={() => runAction("move")}>🚶 Move</button>
                <button className="fa-btn" onClick={() => runAction("eat")}>🌾 Feed</button>
                <button className="fa-btn alt" onClick={() => setShowSource((v) => !v)}>
                  {showSource ? "Hide source" : "View source"}
                </button>
                <button className="fa-btn alt" onClick={removeSelected}>Remove</button>
              </div>
              {showSource && <div className="fa-code">{sourceOf(selected.species)}</div>}
            </div>
          )}

          <div className="fa-yield">
            <span className="lbl">In the field</span>
            {stock.map((s) => (
              <span
                className="item"
                key={s.kind}
                style={{ color: s.volume === 0 ? "#a13c2c" : undefined }}
              >
                {RESOURCE_ICONS[s.kind]} {s.volume} {s.unit}
                {s.sources > 1 && <span className="none"> ×{s.sources}</span>}
              </span>
            ))}
            <span className="lbl" style={{ marginLeft: "auto" }}>Put down</span>
            {["water", "grass"].map((kind) => (
              <button
                key={kind}
                className="fa-btn alt"
                style={placing === kind
                  ? { background: "var(--wood)", color: "var(--cream)" }
                  : undefined}
                onClick={(event) => arm(kind, event.currentTarget)}
              >
                {RESOURCE_ICONS[kind]} {kind}
              </button>
            ))}
          </div>

          {placing && dropAt && (
            <div className="fa-yield">
              <span className="none">
                Click anywhere in the pasture to put down {placing} — or arrow keys
                to aim, Enter to drop, Esc to cancel.
              </span>
              {/* The only account of where the drop point is for anyone who
                  cannot see the marker on the field. */}
              <span className="item" style={{ marginLeft: "auto" }} aria-live="polite">
                {RESOURCE_ICONS[placing]} {Math.round(dropAt.x)}%, {Math.round(dropAt.y)}%
              </span>
            </div>
          )}

          <div className="fa-yield">
            <span className="lbl">Doing now</span>
            {activity.length === 0
              ? <span className="none">nobody about</span>
              : activity.map((a) => (
                  <span className="item" key={a.goal}>
                    {GOAL_ICONS[a.goal] ?? "•"} {a.count} {a.goal}
                  </span>
                ))}
            {expecting > 0 && (
              <span className="item" style={{ color: "#7d2a1e" }}>
                🤰 {expecting} expecting
              </span>
            )}
          </div>

          <div className="fa-yield">
            <span className="lbl">Daily yield</span>
            {produce.length === 0
              ? <span className="none">nothing to collect today</span>
              : produce.map((p) => (
                  <span className="item" key={p.label}>
                    {p.label} {p.amount}{p.unit && ` ${p.unit}`}
                  </span>
                ))}
            <button
              className="fa-btn alt"
              style={{ marginLeft: "auto" }}
              onClick={() => setRoaming((v) => !v)}
              disabled={farm.size === 0}
            >
              {roaming ? "⏸ Stop roaming" : "▶ Let them roam"}
            </button>
          </div>

          <div className="fa-add">
            <select value={addSpecies} onChange={(e) => setAddSpecies(e.target.value)}>
              {SPECIES.map((Species) => (
                <option key={Species.species} value={Species.species}>
                  {Species.emoji} New {Species.species}
                </option>
              ))}
            </select>
            <button className="fa-btn" onClick={addAnimal}>+ Add to pasture</button>
          </div>

          <details className="fa-settings">
            <summary>Settings</summary>

            <div className="fa-set-row">
              <span className="l" id="set-step">Step length</span>
              <input
                type="range"
                min={STEP_MIN}
                max={STEP_MAX}
                step={50}
                value={stepMs}
                aria-labelledby="set-step"
                onChange={(e) => setStepMs(Number(e.target.value))}
              />
              <span className="v">{stepMs} ms</span>
            </div>

            <div className="fa-set-row">
              <span className="l" id="set-mind">Animal mind</span>
              <select
                value={mindKind}
                aria-labelledby="set-mind"
                onChange={(e) => setMindKind(e.target.value)}
              >
                {Object.entries(MINDS).map(([key, { label }]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="fa-set-row">
              <span className="l" id="set-cadence">Rethink every</span>
              <input
                type="range"
                min={1}
                max={30}
                value={cadence}
                aria-labelledby="set-cadence"
                onChange={(e) => setCadence(Number(e.target.value))}
              />
              <span className="v">{cadence} {cadence === 1 ? "step" : "steps"}</span>
            </div>

            <div className="fa-set-row">
              <span className="l" id="set-log">Log lines</span>
              <select
                value={logLines}
                aria-labelledby="set-log"
                onChange={(e) => setLogLines(Number(e.target.value))}
              >
                {LOG_SHOWN.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <div className="fa-set-checks">
              <label>
                <input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />
                Name tags
              </label>
              <label>
                <input type="checkbox" checked={calm} onChange={(e) => setCalm(e.target.checked)} />
                Calm motion
              </label>
            </div>

            {mindKind === "claude" && (
              <div className="fa-set-note">
                Every animal now asks the /decide proxy what to want — run
                <code> npm run proxy</code>, or they keep the goal they had.
              </div>
            )}
          </details>

          <div className="fa-log">
            <div className="fa-log-title">Activity log</div>
            {log.slice(0, logLines).map((entry) => (
              <div className="fa-log-row" key={entry.id}>
                <span className="k">{entry.kind === "info" ? "•" : entry.kind}</span>
                <span>{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
