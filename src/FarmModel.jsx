import React, { useEffect, useRef, useState } from "react";
import Farm from "./model/Farm.js";
import { SPECIES, speciesNamed } from "./model/species.js";
import { MUD, centroid, clampToPasture } from "./model/pasture.js";
import { DRIVES, DRIVE_LABELS } from "./model/drives.js";
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
 * How long one step takes. The sprite's CSS transition is driven from this
 * same number, so an animal is still gliding into its last spot exactly as
 * the next step is decided — the walk looks continuous instead of a dart
 * followed by a wait.
 */
const STEP_MS = 600;

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

  const selected = farm.find(selectedId) ?? farm.animals[0];
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

  useEffect(() => {
    if (!roaming) return undefined;
    const timer = window.setInterval(() => {
      const { farm: next, died, dried, born } = farmRef.current.stepAll();
      setFarm(next);
      for (const source of dried) pushLog(`${source.name} has run dry.`, "empty");
      for (const baby of born) pushLog(baby.birthNotice(), "born");
      for (const animal of died) pushLog(animal.epitaph(), "died");
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [roaming]);

  function pushLog(text, kind) {
    setLog((l) => [{ id: `${Date.now()}-${Math.random()}`, text, kind }, ...l].slice(0, 8));
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
    const { farm: next, outcome, died, born } = farm.step(animal.id);
    setFarm(next);
    if (outcome === "blocked") {
      pushLog(`${animal.name} is hemmed in and stays put.`, "move");
    } else {
      pushLog(animal.narrate(), animal.goal);
    }
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
    <div className="farm-app" style={{ "--step-duration": `${STEP_MS}ms` }}>
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
        .fa-mud {
          background: radial-gradient(ellipse at 50% 75%, #856544 0%, #5e442c 60%, #4a3421 100%);
          box-shadow: inset 0 3px 6px rgba(0,0,0,0.4);
          opacity: 0.75;
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
          <div className="fa-barn" style={standing({ x: 84, y: 18 })}>🏚️</div>
          <div
            className="fa-feature fa-mud"
            style={{
              left: `${project(MUD).x}%`,
              top: `${MUD.y}%`,
              width: `${19 * sizeAt(MUD.y)}%`,
            }}
          />
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
              <span className={"tag" + (a.isPregnant ? " expecting" : "")}>
                {a.name} {SEX_MARKS[a.sex]}
              </span>
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

          <div className="fa-log">
            <div className="fa-log-title">Activity log</div>
            {log.map((entry) => (
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
