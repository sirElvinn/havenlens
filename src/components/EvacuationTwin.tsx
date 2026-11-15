"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hourLabel, peopleAt, type Dossier } from "../lib/dossier";
import { estimateEvacuation, exitsFor } from "../lib/evacuation";
import { SCENARIOS, type Scenario } from "../lib/scenario";
import { area, buildingClear, centroid, FLOW, inside as pointInRing, nearestEdgePoint, placeStairs, planHazard, planNeighbor, positionAt, projector, rerouteAround, simulate, storyIndex, type Agent, type V2 } from "../lib/twin";
import type { SceneBuilding, SceneData, View } from "./TwinScene";

const TwinScene = dynamic(() => import("./TwinScene"), { ssr: false, loading: () => <div className="twinLoading">Building the 3D model…</div> });

type Parcel = { outlines?: { primary: boolean; area: number; ring: [number, number][] }[]; parcelWkt?: string; error?: string };
type Assembly = { candidate: { lat: number; lon: number; dist: number } | null; route: { path: [number, number][]; distanceM: number; source: string } | null };

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function EvacuationTwin({ d, scenario, hour, onScenarioChange, onClose, initialFireFloor = null }: { d: Dossier; scenario: Scenario; hour: number; onScenarioChange?: (value: Scenario) => void; onClose: () => void; initialFireFloor?: number | null }) {
  const meta = SCENARIOS[scenario];
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [assembly, setAssembly] = useState<Assembly | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [view, setView] = useState<View>({ mode: "building", floor: null, key: 0 });
  const go = useCallback((mode: View["mode"], floor: number | null = null) => setView(v => ({ mode, floor, key: v.key + 1 })), []);
  const [showDetails, setShowDetails] = useState(true);
  const [playing, setPlaying] = useState(true);
  const stories = Math.max(1, d.stories ?? 1);
  const [fireFloor, setFireFloor] = useState(Math.max(0, Math.min(stories - 1, initialFireFloor ? initialFireFloor - 1 : Math.floor(stories / 2))));
  const clock = useRef(0);
  const [stats, setStats] = useState({ t: 0, out: 0, safe: 0, queued: 0, stairs: 0, refuge: 0, shelter: 0 });
  const [fireAt, setFireAt] = useState<V2 | null>(null);
  const [refugeLevel, setRefugeLevel] = useState(1);   // flood refuge floor (0-based); moves up if water keeps rising

  const heightM = d.heightFeet ? d.heightFeet * 0.3048 : stories * (d.class === "residential" ? 3.1 : 3.8);
  const minDist = Math.max(30, Math.round(heightM * 1.5));

  // Keep the latest close handler without re-running the loader when the parent re-renders.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("twinOpen");
    (async () => {
      try {
        const s = await fetch("/api/vexcel/status").then(r => r.json()).catch(() => ({ configured: false }));
        if (!s.configured) { setStatus("fallback"); return; }
        const [p, a] = await Promise.all([
          fetch(`/api/vexcel/${d.id}/parcel?v=3`).then(r => r.json()),
          fetch(`/api/vexcel/${d.id}/assembly?min=${minDist}`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        setParcel(p); setAssembly(a);
        setStatus(p?.outlines?.length ? "ready" : "fallback");
      } catch { setStatus("fallback"); }
    })();
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("twinOpen"); };
  }, [d.id, minDist]);

  const base = useMemo(() => {
    if (status === "loading") return null;
    const project = projector(d.lon, d.lat);
    const outlines = (parcel?.outlines ?? []).map(o => ({ ...o, local: o.ring.map(([lon, lat]) => project(lon, lat)) }));
    const real = outlines.length > 0;
    let rings: V2[][];
    let small: V2[][] = [];
    if (real) {
      // A multi-building complex (CoStar records several buildings) uses every sizeable structure on the
      // parcel, up to the recorded count; garages, carports and sheds stay as low outlines.
      const largest = outlines[0].area;
      const recorded = d.apartment?.buildings ?? 1;
      const multi = recorded > 1 || (d.class === "residential" && d.apartment?.style === "Garden");
      const big = outlines.filter(o => o.area >= largest * 0.25);
      const count = multi ? Math.min(big.length, recorded > 1 ? recorded : 12) : 1;
      const chosen = multi ? big.slice(0, count) : [outlines.find(o => o.primary) ?? outlines[0]];
      rings = chosen.map(o => o.local);
      small = outlines.filter(o => !chosen.includes(o)).map(o => o.local);
    } else {
      // No traced footprint: a rectangle sized from CoStar's typical floor area.
      const a = (d.typicalFloorSqft ?? (d.grossSqft ? d.grossSqft / stories : 12000)) * 0.0929;
      const w = Math.sqrt(a * 1.6), h = a / w;
      rings = [[[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]]];
    }
    // Re-centre the scene on the largest building.
    const c = centroid(rings[0]);
    const shift = (p: V2): V2 => [p[0] - c[0], p[1] - c[1]];
    rings = rings.map(r => r.map(shift));
    const others = small.map(r => r.map(shift));
    const floorHeight = heightM / stories;
    const now = peopleAt(d, hour);
    const routePath = assembly?.route?.path?.map(([lat, lon]) => shift(project(lon, lat))) ?? [];
    const assemblyPt = assembly?.candidate ? shift(project(assembly.candidate.lon, assembly.candidate.lat)) : null;
    const areas = rings.map(area), areaSum = areas.reduce((t, x) => t + x, 0);
    const buildings = rings.map((ring, bi) => {
      const people = Math.round(now * areas[bi] / areaSum);
      let peoplePerFloor: number[];
      if (rings.length === 1 && d.class !== "residential" && d.class !== "hotel") {
        // Commercial: recorded tenant staff by floor, weighted by how much of the estimate they cover.
        const staff = Array.from({ length: stories }, () => 0);
        for (const f of d.floors) { const i = storyIndex(f.name); if (i != null && i < stories && f.employees) staff[i] += f.employees; }
        const staffSum = staff.reduce((t, x) => t + x, 0);
        const coverage = staffSum > 0 ? Math.min(1, staffSum / Math.max(1, people)) : 0;
        peoplePerFloor = staff.map(x => Math.round(people * ((staffSum ? x / staffSum : 0) * coverage + (1 - coverage) / stories)));
      } else peoplePerFloor = Array.from({ length: stories }, () => Math.round(people / stories));   // residents: evenly
      const stairs = placeStairs(ring, exitsFor(Math.ceil(people / stories)), d.sprinklers ? 76 : 61);
      const doors = stairs.map(s => nearestEdgePoint(s, ring));
      const outside = doors.map(door => routePath.length > 1 ? routePath : [[door[0] * 1.6, door[1] * 1.6] as V2]);
      return { ring, stairs, doors, outside, peoplePerFloor, label: rings.length > 1 ? `Building ${bi + 1}` : "this building" };
    });
    // Ground under the building: the Vexcel ortho, which covers the parcel bounding box plus 15 m.
    let ground: SceneData["ground"] = null;
    const nums = parcel?.parcelWkt?.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (real && nums && nums.length >= 6) {
      const pts: V2[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(shift(project(nums[i], nums[i + 1])));
      const px = pts.map(p => p[0]), py = pts.map(p => p[1]);
      ground = { url: `/api/vexcel/${d.id}/ortho.jpg`, x0: Math.min(...px) - 15, x1: Math.max(...px) + 15, y0: Math.min(...py) - 15, y1: Math.max(...py) + 15 };
    }
    return { buildings, others, stories, floorHeight, route: routePath, assembly: assemblyPt, ground, total: now, real };
  }, [status, parcel, assembly, d, hour, stories, heightM]);

  // Which building the fire is in follows where it was placed.
  const fireBldg = useMemo(() => {
    if (!base || !fireAt) return 0;
    const inside = base.buildings.findIndex(b => pointInRing(fireAt, b.ring));
    return inside >= 0 ? inside : 0;
  }, [base, fireAt]);

  // The hazard plan and the flow depend on where the fire is, so they re-run when it moves.
  const baseScene = useMemo<(SceneData & { finish: number; total: number; perDot: number; real: boolean }) | null>(() => {
    if (!base) return null;
    const est = estimateEvacuation(d, hour, scenario);
    const premove: [number, number] = est ? est.premove : [1, 3];
    const fb = base.buildings[fireBldg];
    const fire: V2 = fireAt ?? [fb.stairs[0][0] * 0.55 + centroid(fb.ring)[0] * 0.45, fb.stairs[0][1] * 0.55 + centroid(fb.ring)[1] * 0.45];
    const totalPeople = base.buildings.reduce((t, b) => t + b.peoplePerFloor.reduce((u, n) => u + n, 0), 0) || 1;
    let offset = 0;
    const agents: Agent[] = [];
    const bldgs: SceneBuilding[] = [];
    let finish = 0;
    base.buildings.forEach((b, bi) => {
      const isFire = bi === fireBldg;
      const plan = scenario === "fire" && !isFire
        ? planNeighbor(stories, b.stairs, premove, base.buildings[fireBldg].label)
        : planHazard({ scenario, stories, stairs: b.stairs, fireFloor, fire, premove, highrise: d.flags.includes("highrise"), belowGrade: d.flags.includes("belowgrade"), refugeFloor: refugeLevel });
      const people = b.peoplePerFloor.reduce((t, n) => t + n, 0);
      const sim = simulate({ ring: b.ring, floorHeight: base.floorHeight, peoplePerFloor: b.peoplePerFloor, stairs: b.stairs, doors: b.doors, outside: b.outside, plan,
        maxDots: Math.max(12, Math.round(420 * people / totalPeople)), seed: d.id + bi * 7919 });
      for (const a of sim.agents) agents.push({ ...a, stair: a.stair >= 0 ? a.stair + offset : -1, bldg: bi });
      finish = Math.max(finish, sim.finish);
      bldgs.push({ ring: b.ring, stairs: b.stairs, doors: b.doors, peoplePerFloor: b.peoplePerFloor, plan, stairOffset: offset, isFire: scenario === "fire" ? isFire : bi === 0, label: b.label });
      offset += b.stairs.length;
    });
    const peoplePerFloor = Array.from({ length: stories }, (_, i) => bldgs.reduce((t, b) => t + b.peoplePerFloor[i], 0));
    // Multi-story flood: nobody walks out to the lot, so the outdoor route is not drawn.
    const verticalRefuge = scenario === "flood" && stories >= 2;
    const main = bldgs[scenario === "fire" ? fireBldg : 0];
    return { buildings: bldgs, ring: main.ring, plan: main.plan, others: base.others, stories, floorHeight: base.floorHeight, peoplePerFloor,
      stairs: bldgs.flatMap(b => b.stairs), doors: bldgs.flatMap(b => b.doors),
      route: verticalRefuge ? [] : base.route, assembly: verticalRefuge ? null : base.assembly, agents, ground: base.ground,
      accent: meta.accent, scenario, finish, total: base.total, perDot: base.total / Math.max(1, agents.length), real: base.real };
  }, [base, d, hour, scenario, stories, fireFloor, fireAt, fireBldg, meta.accent, refugeLevel]);
  // Live complications: a stair lost mid-evacuation. Applied on top of the base run without restarting the clock.
  const [complications, setComplications] = useState<{ stair: number; at: number; label: string }[]>([]);
  useEffect(() => { setComplications([]); }, [baseScene]);
  const scene = useMemo(() => {
    if (!baseScene || !complications.length) return baseScene;
    let agents = baseScene.agents;
    const buildings = baseScene.buildings.map(b => ({ ...b, plan: { ...b.plan, floors: b.plan.floors.map(f => ({ ...f, open: [...f.open] })) } }));
    const owner = (g: number) => buildings.findIndex(b => g >= b.stairOffset && g < b.stairOffset + b.stairs.length);
    for (const c of complications) {
      const bi = owner(c.stair);
      if (bi < 0) continue;
      const local = c.stair - buildings[bi].stairOffset;
      const closedHere = new Set(complications.filter(x => owner(x.stair) === bi).map(x => x.stair - buildings[bi].stairOffset));
      // If the lost stair was a floor's last one, occupants fall back to the firefighters' attack stair (shared).
      let fellBack = false;
      buildings[bi].plan.floors.forEach(f => { f.open[local] = false; if (!f.open.some(Boolean)) { f.open = f.open.map((_, k) => !closedHere.has(k)); fellBack = true; } });
      const attack = buildings[bi].plan.attack;
      const shared = new Set<number>(fellBack && attack != null ? [attack + buildings[bi].stairOffset] : []);
      const outside = baseScene.stairs.map((_, g) => { const b = buildings[owner(g)]; return b ? (baseScene.route.length > 1 ? baseScene.route : [[b.doors[g - b.stairOffset][0] * 1.6, b.doors[g - b.stairOffset][1] * 1.6] as V2]) : []; });
      agents = rerouteAround({ agents, t: c.at, closed: c.stair, stairs: baseScene.stairs, doors: baseScene.doors, outside,
        floorHeight: baseScene.floorHeight, perDot: baseScene.perDot, refugeFloor: buildings[bi].plan.refugeFloor, shared,
        candidates: a => { const b = buildings[a.bldg ?? 0]; return b.stairs.map((_, li) => li).filter(li => b.plan.floors[a.floor]?.open[li]).map(li => li + b.stairOffset); } });
    }
    const finish = agents.reduce((m, a) => Math.max(m, a.times[a.times.length - 1]), 0);
    const main = buildings.find(b => b.isFire) ?? buildings[0];
    return { ...baseScene, buildings, plan: main.plan, agents, finish };
  }, [baseScene, complications]);

  // Clicking a floor in 3D (or in the floor picker) flies in; clicking it again goes back out.
  const pick = useCallback((i: number) => setView(v => v.mode === "floor" && v.floor === i ? { mode: "building", floor: null, key: v.key + 1 } : { mode: "floor", floor: i, key: v.key + 1 }), []);

  // Playback: the whole evacuation in about 30 seconds.
  const speed = baseScene ? Math.max(4, baseScene.finish / 30) : 10;
  useEffect(() => { clock.current = 0; }, [baseScene?.agents]);
  useEffect(() => {
    if (!scene) return;
    let last = performance.now(), frame = 0, tick = 0;
    const loop = (t: number) => {
      const dt = (t - last) / 1000; last = t;
      if (playing) clock.current = Math.min(scene.finish + 2, clock.current + dt * speed);
      if (++tick % 8 === 0) {
        let out = 0, safe = 0, queued = 0, stairs = 0, refuge = 0, shelter = 0;
        const tt = clock.current;
        for (const a of scene.agents) {
          const { state } = positionAt(a, tt);
          if (state === "out") out++;
          if (a.kind === "out" && tt >= a.times[a.times.length - 1]) safe++;
          if (state === "queued") queued++;
          if (state === "stairs") stairs++;
          if (state === "refuge") refuge++;
          if (state === "shelter") shelter++;
        }
        setStats({ t: tt, out, safe, queued, stairs, refuge, shelter });
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [scene, playing, speed]);

  const n = scene?.agents.length ?? 0;
  const pct = (k: number) => n ? Math.round(100 * k / n) : 0;
  const picked = view.mode === "floor" ? view.floor : null;
  const floorName = (i: number) => i === 0 ? "Ground floor" : `Floor ${i + 1}`;
  // Keep the selected floor (or the fire floor) visible in the floor list.
  const floorList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = picked ?? (scenario === "fire" ? fireFloor : null);
    if (target == null) return;
    floorList.current?.querySelector<HTMLElement>(`[data-floor="${target}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked, fireFloor, scenario, scene != null]);
  const floorInfo = picked != null && scene ? { people: scene.peoplePerFloor[picked], name: floorName(picked) } : null;
  const mainB = scene ? scene.buildings.findIndex(b => b.isFire) : 0;
  const floorDots = (i: number) => scene ? scene.agents.filter(a => a.floor === i && a.kind !== "shelter" && a.bldg === mainB) : [];
  const placeFire = useCallback((p: V2) => setFireAt(p), []);
  const ROLE_TONE: Record<string, string> = { fire: "fire", above: "warn", below: "warn", flooded: "flood", refuge: "refuge", shelter: "shelter" };
  // When a floor's last evacuee steps onto a stair (or reaches the exit on the ground floor).
  const clearBy = (i: number) => { const dots = floorDots(i); return dots.length ? Math.max(...dots.map(a => a.times[a.kind === "refuge" || i > 0 ? 2 : 1] ?? 0)) : null; };

  return <div className="twin" role="region" aria-label={`3D evacuation model of ${d.name}`} style={{ ["--acc" as string]: meta.accent }}>
    <div className="twinStage">
      {scene ? <TwinScene d={scene} clock={clock} view={view} fireFloor={fireFloor} onPick={pick} onPlaceFire={placeFire} /> : <div className="twinLoading">Loading footprint and route…</div>}
    </div>

    <header className="twinTop">
      <div>
        <div className="eyebrow"><i className="dot" style={{ background: meta.accent }} /> Training simulation · {meta.label} · {hourLabel(hour)}</div>
        {onScenarioChange && <div className="twinScenario" role="group" aria-label="Training scenario">
          {(Object.keys(SCENARIOS) as Scenario[]).map(value => (
            <button key={value} aria-pressed={scenario === value} onClick={() => onScenarioChange(value)}>
              <i aria-hidden="true" style={{background: SCENARIOS[value].accent}} />{SCENARIOS[value].label}
            </button>
          ))}
        </div>}
        <h2>{d.name}</h2>
        <p className="muted">{scene && scene.buildings.length > 1 ? `${scene.buildings.length} buildings · ` : ""}{stories} stor{stories > 1 ? "ies" : "y"} · {Math.round(heightM)} m · {scene ? `${Math.round(scene.buildings.reduce((t, b) => t + area(b.ring), 0) * 10.764).toLocaleString()} sq ft of footprint` : "…"} {scene && !scene.real && "(approximate)"}</p>
      </div>
      <div className="chips">
        <button aria-pressed={view.mode === "building"} onClick={() => go("building")}>Whole building</button>
        <button aria-pressed={view.mode === "route"} onClick={() => go("route")} disabled={!scene?.route.length}>Route to assembly</button>
        <button disabled={!scene} aria-expanded={showDetails} aria-controls="simulation-details" onClick={()=>setShowDetails(!showDetails)}>Details</button>
        <button onClick={onClose} aria-label="Close 3D model">← Building views</button>
      </div>
    </header>

    {scene && <nav className="twinFloors" aria-label="Floors">
      <span className="eyebrow">Floors</span>
      <div className="twinFloorList" ref={floorList} onWheel={e => e.stopPropagation()}>
        {Array.from({ length: stories }, (_, k) => stories - 1 - k).map(i => <button key={i} aria-pressed={picked === i} onClick={() => pick(i)}
          className={(ROLE_TONE[scene.plan.floors[i]?.role] ?? "") + (picked === i ? " on" : "")} data-floor={i} title={`${scene.plan.floors[i]?.label} · ${scene.peoplePerFloor[i] ? `about ${scene.peoplePerFloor[i].toLocaleString()} people` : "no one estimated on this floor at this hour"}`}>
          <b>{i === 0 ? "G" : i + 1}</b><span>{scene.peoplePerFloor[i].toLocaleString()}</span>
        </button>)}
      </div>
      <button className="twinAll" onClick={() => go("building")} aria-pressed={picked == null}>All</button>
    </nav>}

    <p className="twinHint">Drag to rotate · Scroll to zoom toward the cursor · Right-drag to pan · Click a floor to step inside</p>

    {scene && showDetails && <aside id="simulation-details" className="twinPanel">
      <div className="twinClock"><b>{fmtClock(stats.t)}</b><span>simulated time · 1 s = {Math.round(speed)} s</span></div>
      <div className="twinBar" aria-hidden="true"><i style={{ width: pct(stats.out) + "%" }} /><em style={{ width: pct(stats.safe) + "%" }} /></div>
      <dl className="twinStats">
        <div><dt>Out of the building</dt><dd>{Math.round(stats.out * scene.perDot).toLocaleString()} <small>/ {scene.total.toLocaleString()}</small></dd></div>
        <div><dt>At assembly area</dt><dd>{Math.round(stats.safe * scene.perDot).toLocaleString()}</dd></div>
        <div className="q"><dt>Queued at stairs</dt><dd>{Math.round(stats.queued * scene.perDot).toLocaleString()}</dd></div>
        <div className="s"><dt>On the stairs</dt><dd>{Math.round(stats.stairs * scene.perDot).toLocaleString()}</dd></div>
        {scenario === "flood" && <>
          <div className="r"><dt>Moved up to refuge</dt><dd>{Math.round(stats.refuge * scene.perDot).toLocaleString()}</dd></div>
          <div className="h"><dt>Sheltering in place</dt><dd>{Math.round(stats.shelter * scene.perDot).toLocaleString()}</dd></div>
        </>}
      </dl>
      <ul className="twinNotes">
        {scene.buildings.length > 1 && <li className="info">{scene.buildings.length} residential buildings on this property{scenario === "fire" ? `. The fire is in ${scene.buildings[mainB].label}; the floor plan below is for that building, and the others leave a few minutes later.` : "; the floor plan below is for Building 1."}</li>}
        {scene.plan.notes.map(n => <li key={n}>{n}</li>)}
      </ul>
      <div className="chips twinCtl">
        <button className="primary" onClick={() => setPlaying(p => !p)}>{playing ? "Pause" : "Play"}</button>
        <button onClick={() => { clock.current = 0; setPlaying(true); }}>Restart</button>
      </div>
      {(() => {
        // Inject a complication: the chosen stair is lost now; people re-route mid-evacuation.
        const mb = scene.buildings[mainB];
        const options = mb.stairs.map((_, li) => li).filter(li => mb.plan.attack !== li && !complications.some(c => c.stair === li + mb.stairOffset));
        // Flood: nobody leaves; the measure is when everyone moving up has reached the refuge floor.
        const atRefuge = (ag: Agent[]) => ag.reduce((m, a) => a.kind === "refuge" ? Math.max(m, a.times[a.times.length - 1]) : m, 0);
        // On a multi-building property only the affected building changes, so measure that one.
        const multi = scene.buildings.length > 1;
        const own = (ag: Agent[]) => multi ? ag.filter(a => (a.bldg ?? 0) === mainB) : ag;
        const metric = (ag: Agent[]) => scenario === "flood" ? atRefuge(own(ag)) : buildingClear(own(ag));
        const before = baseScene ? metric(baseScene.agents) : 0, after = metric(scene.agents);
        const sfpe0 = estimateEvacuation(d, hour, scenario), sfpe1 = estimateEvacuation(d, hour, scenario, { closedStairs: complications.length });
        const mm = (r: [number, number]) => `${Math.max(1, Math.round(r[0]))}–${Math.ceil(r[1])} min`;
        return <div className="twinCompl">
          <span className="eyebrow">Inject a complication</span>
          <div className="chips">
            {options.slice(0, 4).map(li => { const L = String.fromCharCode(65 + li), at = fmtClock(clock.current);
              // Is there another occupant stair left, or only the firefighters' attack stair?
              const left = mb.stairs.map((_, k) => k).filter(k => k !== li && k !== mb.plan.attack && !complications.some(c => c.stair === k + mb.stairOffset));
              const shared = !left.length && mb.plan.attack != null ? String.fromCharCode(65 + mb.plan.attack) : null;
              const label = scenario === "fire" ? (shared ? `Stair ${L} filled with smoke at ${at}: it was the last occupant stair, so everyone not yet in it must share Stair ${shared} with firefighters going up, at about half its normal flow.` : `Stair ${L} filled with smoke at ${at}: everyone not yet in it turns around for the next stair.`)
                : scenario === "flood" ? `Stair ${L}'s ground-floor entrance flooded at ${at}: people not yet in it head to the next stair up.`
                : `Stair ${L}'s emergency lighting failed at ${at}: crews redirect everyone not yet in it to a lit stair.`;
              return <button key={li} onClick={() => setComplications(c => [...c, { stair: li + mb.stairOffset, at: clock.current, label }])}>
                {scenario === "fire" ? `Smoke in Stair ${L}` : scenario === "flood" ? `Stair ${L} entrance flooded` : `Stair ${L} lights out`}</button>; })}
            {scenario === "flood" && stories >= 3 && refugeLevel < stories - 1 && <button onClick={() => setRefugeLevel(r => r + 1)}>Water rising: refuge to Floor {refugeLevel + 2}</button>}
            {(complications.length > 0 || refugeLevel !== 1) && <button className="ghost" onClick={() => { setComplications([]); setRefugeLevel(1); }}>Clear</button>}
          </div>
          {scenario === "flood" && refugeLevel !== 1 && <p className="twinComplNote">Water is still rising: the refuge moved to Floor {refugeLevel + 1}. Floors below it now move up; the model restarted with the new plan.</p>}
          {complications.length > 0 && <>
            <ul className="twinComplList">{complications.map(c => <li key={c.stair}>{c.label}</li>)}</ul>
            {before === 0 && after === 0 ? <p className="twinComplNote">{scenario === "flood" ? "No one is estimated on the floors that move up at this hour, so the stair loss changes nothing here." : "No one is estimated to be leaving at this hour, so the stair loss changes nothing here."}</p> :
            <dl className="twinDelta">
              <div><dt>{scenario === "flood" ? "Everyone at refuge by" : multi ? `${scene.buildings[mainB].label} clear (simulated)` : "Building clear (simulated)"}</dt><dd>{fmtClock(before)} → <b>{fmtClock(after)}</b> <small>{after >= before ? "+" : "−"}{fmtClock(Math.abs(after - before))}</small></dd></div>
              {sfpe0 && sfpe1 && <div><dt>SFPE estimate</dt><dd>{mm(sfpe0.total)} → <b>{mm(sfpe1.total)}</b></dd></div>}
            </dl>}
          </>}
        </div>;
      })()}
      {scenario === "fire" && <div className="twinFireCtl">
        <label className="twinFire">Fire floor
          <select value={fireFloor} onChange={e => setFireFloor(Number(e.target.value))}>{Array.from({ length: stories }, (_, i) => <option key={i} value={i}>{i === 0 ? "Ground" : `Floor ${i + 1}`}</option>)}</select>
        </label>
        <button onClick={() => pick(fireFloor)} disabled={picked === fireFloor}>Go to fire floor</button>
        {picked === fireFloor && <p className="muted">Click anywhere on this floor to move the fire. Routes and the attack stair update.</p>}
      </div>}
      {floorInfo && picked != null && <div className="twinFloor">
        <p><b>{scene.plan.floors[picked].label}</b></p>
        <p className="muted">About {floorInfo.people.toLocaleString()} people at {hourLabel(hour)} · starts moving after {scene.plan.floors[picked].premove[0]}–{scene.plan.floors[picked].premove[1]} min</p>
        <ul className="twinAdvice">{scene.plan.floors[picked].advice.map(a => <li key={a}>{a}</li>)}</ul>
        {(() => {
          const dots = floorDots(picked);
          const mb = scene.buildings[mainB];
          const byStair = mb.stairs.map((_, si) => dots.filter(a => a.stair === si + mb.stairOffset).length);
          const outBy = clearBy(picked);
          return <ul className="twinStairSplit">{byStair.map((n, si) => n > 0 && <li key={si}>Stair {String.fromCharCode(65 + si)}*<b>{Math.round(n * scene.perDot)}</b></li>)}
            {scene.plan.floors[picked].open.map((o, si) => !o && <li key={"x" + si} className="closed">Stair {String.fromCharCode(65 + si)}*<b>closed</b></li>)}
            {outBy != null && <li>Floor clear by<b>{fmtClock(outBy)}</b></li>}</ul>;
        })()}
        <div className="chips"><button onClick={() => picked > 0 && pick(picked - 1)} disabled={picked === 0}>↓ Floor below</button><button onClick={() => picked < stories - 1 && pick(picked + 1)} disabled={picked === stories - 1}>↑ Floor above</button></div>
      </div>}
      <details className="twinPlan" open={picked == null}>
        <summary>Floor-by-floor plan</summary>
        <ol>{Array.from({ length: stories }, (_, k) => stories - 1 - k).map(i => { const fp = scene.plan.floors[i]; const cb = clearBy(i); return <li key={i}>
          <button className={ROLE_TONE[fp.role] ?? ""} onClick={() => pick(i)}>
            <b>{i === 0 ? "G" : i + 1}</b><span>{fp.label.split(" · ")[1]}</span>
            <em>{fp.action === "shelter" ? "Stay" : fp.action === "refuge" ? "Up" : `P${fp.priority}`}{cb != null && fp.action !== "shelter" ? ` · ${fmtClock(cb)}` : ""}</em>
          </button>
        </li>; })}</ol>
        <p className="muted">P1 leaves first. Times show when each floor is clear.</p>
      </details>
      <ul className="twinLegend">
        <li><i style={{ background: "#fff" }} />Walking to a stair</li>
        <li><i style={{ background: "#ffb23e" }} />Waiting at a stair</li>
        <li><i style={{ background: "#58c4a6" }} />On the stairs</li>
        <li><i style={{ background: "#8fe3cb" }} />Outside, heading to assembly</li>
        {scenario === "flood" && <><li><i style={{ background: "#7fb4ff" }} />Moving up to refuge</li><li><i style={{ background: "#c9a6ff" }} />Sheltering in place</li></>}
        {scenario === "fire" && <li><i style={{ background: "#ff5a3c" }} />Fire and attack stair</li>}
      </ul>
      <p className="fine">
        {scene.real ? "Footprint traced by Vexcel from aerial imagery." : "Footprint approximated from CoStar floor area (no Vexcel trace)."} Height and stories from CoStar. People per floor estimated for this hour{scene.perDot > 1.05 ? `; each dot is about ${Math.round(scene.perDot)} people` : ""}.
        <b> *Stair positions are assumed</b>: {scene.stairs.length} code-minimum stairs, spread to the far ends of the floor plate so no one is more than {d.sprinklers ? "250" : "200"} ft from a stair (IBC exit separation and travel-distance rules), each passing about {FLOW.stairCapacity} people per second. {scene.route.length ? "Outdoor route from OpenStreetMap." : "No assembly route found."} {scenario === "flood" && "Water shown at 4 ft. "}{scenario === "blackout" && "No elevators in this scenario. "}Floor roles follow common high-rise practice (fire floor first, then the floors above and below; the stair nearest the fire is left to firefighters). No floor plans exist in the data, so the fire position and stair layout are inferred. Illustrative flow for planning, not a validated egress model.
      </p>
    </aside>}
  </div>;
}
