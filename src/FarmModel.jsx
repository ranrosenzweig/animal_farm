import React, { useEffect, useRef, useState } from "react";
import Farm from "./model/Farm.js";
import { SPECIES, speciesNamed } from "./model/species.js";
import { MUD } from "./model/pasture.js";
import { DRIVES, DRIVE_LABELS } from "./model/drives.js";
import { sourceOf } from "./sources.js";

/** How each goal reads on screen. Presentation only — the model has no icons. */
const GOAL_ICONS = {
  graze: "🌿", drink: "💧", wallow: "🫧", flock: "👥", rest: "😴", roam: "🚶", mate: "❤️",
};

const SEX_MARKS = { female: "♀", male: "♂" };

const RESOURCE_ICONS = { water: "💧", grass: "🌿" };

/**
 * How long one step takes. The sprite's CSS transition is driven from this
 * same number, so an animal is still gliding into its last spot exactly as
 * the next step is decided — the walk looks continuous instead of a dart
 * followed by a wait.
 */
const STEP_MS = 600;

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

  /** Put water or grass wherever the farmer clicked. */
  function placeAt(event) {
    if (!placing) return;
    const box = event.currentTarget.getBoundingClientRect();
    const { farm: next, resource } = farm.addResource(placing, {
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    });
    setFarm(next);
    setPlacing(null);
    pushLog(`${resource.name} put down — ${Math.round(resource.volume)} ${resource.unit}.`, placing);
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
          flex: 1.3;
          min-height: 360px;
          border-radius: 10px;
          overflow: hidden;
          background:
            linear-gradient(180deg, var(--sky) 0%, var(--sky-2) 26%, var(--field-1) 30%, var(--field-2) 100%);
          border: 3px solid var(--wood-dark);
        }
        .fa-fence {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 26px;
          background: repeating-linear-gradient(90deg, var(--wood) 0 6px, transparent 6px 22px);
          opacity: 0.55;
        }
        .fa-barn {
          position: absolute;
          right: 18px; top: 10px;
          font-size: 34px;
          opacity: 0.85;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));
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
          .fa-sprite { transition: none; animation: none; }
        }
        .fa-sprite .emoji {
          position: relative;
          font-size: 30px;
          filter: drop-shadow(0 3px 2px rgba(0,0,0,0.3));
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
          transform: scale(1.18);
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
        }
        .fa-source {
          /* size and opacity come from how much is left, so a drained source
             visibly shrinks and fades before it disappears */
          transition: width 0.4s linear, height 0.4s linear, opacity 0.4s linear;
        }
        .fa-water {
          background: radial-gradient(ellipse at 40% 35%, #7fb4d6, #3E7CA6);
          box-shadow: inset 0 -3px 6px rgba(0,0,0,0.2);
        }
        .fa-grass {
          background: radial-gradient(ellipse at 45% 40%, #8cbf5f, #4d7a2e);
        }
        .fa-mud {
          width: 19%; height: 13%;
          background: radial-gradient(ellipse at 45% 40%, #7a5b3f, #4a3421);
          opacity: 0.7;
        }
        .fa-pasture.placing { cursor: crosshair; }
        .fa-pasture.placing .fa-sprite { cursor: crosshair; }
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
          color: #8a7d5a;
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

        .fa-source {
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
          color: #8a7d5a;
        }
        .fa-yield .item { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
        .fa-yield .none { color: #8a7d5a; font-style: italic; }

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
          color: #8a7d5a;
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
        <div className={"fa-pasture" + (placing ? " placing" : "")} onClick={placeAt}>
          <div className="fa-barn">🏚️</div>
          <div className="fa-feature fa-mud" style={{ left: `${MUD.x}%`, top: `${MUD.y}%` }} />
          {farm.resources.map((source) => (
            <div
              key={source.id}
              className={`fa-feature fa-source fa-${source.kind}`}
              title={source.describe()}
              style={{
                left: `${source.x}%`,
                top: `${source.y}%`,
                width: `${source.radius * 2}%`,
                height: `${source.radius * 1.45}%`,
                opacity: 0.45 + source.fullness * 0.45,
              }}
            />
          ))}
          {farm.animals.map((a) => (
            <button
              key={a.id}
              className={"fa-sprite" + (a.id === selected?.id ? " selected" : "")}
              style={{ left: `${a.x}%`, top: `${a.y}%` }}
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
                {a.emoji}
                {a.isPregnant && <span className="expecting">🤰</span>}
              </span>
              <span className={"tag" + (a.isPregnant ? " expecting" : "")}>
                {a.name} {SEX_MARKS[a.sex]}
              </span>
            </button>
          ))}
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
              {showSource && <div className="fa-source">{sourceOf(selected.species)}</div>}
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
                onClick={() => setPlacing((p) => (p === kind ? null : kind))}
              >
                {RESOURCE_ICONS[kind]} {kind}
              </button>
            ))}
          </div>

          {placing && (
            <div className="fa-yield">
              <span className="none">
                Click anywhere in the pasture to put down {placing}.
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
