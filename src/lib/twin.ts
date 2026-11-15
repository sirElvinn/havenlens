// Geometry and evacuation flow for the per-building 3D model.
// Real inputs: the Vexcel-traced footprint, CoStar story count and height, estimated people per floor,
// and the OpenStreetMap walking route. Assumed: stair positions (IBC 1007.1.1 remoteness: exits placed
// at the far ends of the floor plate) and code-minimum stair capacity.

export type V2 = [number, number];            // local metres: x east, y north
export type V3 = [number, number, number];    // three.js world: x east, y up, z south

export function projector(lon0: number, lat0: number) {
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return (lon: number, lat: number): V2 => [(lon - lon0) * kx, (lat - lat0) * ky];
}

export const world = (p: V2, y: number): V3 => [p[0], y, -p[1]];

export function centroid(ring: V2[]): V2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-6) return [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function area(ring: V2[]) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}

export function inside(p: V2, ring: V2[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Stair positions: farthest-apart footprint corners, pulled inside the plate. Starts from the
 * occupant-load minimum, then adds stairs until no corner of the plate is farther than the
 * maximum travel distance from a stair (IBC 1017.2: 250 ft sprinklered, 200 ft unsprinklered).
 */
export function placeStairs(ring: V2[], count: number, maxTravel = 61): V2[] {
  const c = centroid(ring);
  const pts = ring.slice(0, -1).length > 2 ? ring.slice(0, ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined) : ring;
  let best: [number, number] = [0, 1], bestD = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = dist(pts[i], pts[j]); if (d > bestD) { bestD = d; best = [i, j]; } }
  const chosen = [pts[best[0]], pts[best[1]]];
  const worst = () => Math.max(...pts.map(p => Math.min(...chosen.map(q => dist(p, q)))));
  while (chosen.length < count || (worst() > maxTravel && chosen.length < 8)) {
    let far = pts[0], farD = -1;
    for (const p of pts) { const d = Math.min(...chosen.map(q => dist(p, q))); if (d > farD) { farD = d; far = p; } }
    chosen.push(far);
  }
  return chosen.map(p => {
    const d = dist(p, c), inset = Math.min(6, d * 0.18);
    let q: V2 = [p[0] + (c[0] - p[0]) * inset / d, p[1] + (c[1] - p[1]) * inset / d];
    for (let k = 0; k < 8 && !inside(q, ring); k++) q = [q[0] + (c[0] - q[0]) * 0.2, q[1] + (c[1] - q[1]) * 0.2];
    return q;
  });
}

/** Closest point on the footprint outline: where a stair's exit door meets the outside. */
export function nearestEdgePoint(p: V2, ring: V2[]): V2 {
  let best: V2 = ring[0], bd = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const q: V2 = [a[0] + t * dx, a[1] + t * dy];
    const d = dist(p, q);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

function randomInside(ring: V2[], rand: () => number): V2 {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let k = 0; k < 40; k++) {
    const p: V2 = [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)];
    if (inside(p, ring)) return p;
  }
  return centroid(ring);
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export type AgentKind = "out" | "refuge" | "shelter";
export type Agent = { pts: V3[]; times: number[]; stair: number; floor: number; kind: AgentKind; exitIdx: number; bldg?: number };
export type AgentState = "waiting" | "moving" | "queued" | "stairs" | "out" | "refuge" | "shelter";

export const FLOW = {
  walk: 1.2,            // m/s on the level
  descend: 0.33,        // vertical m/s on stairs, down (about 10 s per floor)
  ascend: 0.25,         // vertical m/s on stairs, up
  stairCapacity: 0.9,   // persons/s per code-minimum stair (1.1 p/s/m × 0.82 m effective width)
  counterflow: 0.5,     // share of a stair's flow left when occupants share it with firefighters climbing up (planning assumption)
  fireRadius: 12,       // m around the fire origin treated as impassable on the fire floor
};

export type FloorRole = "fire" | "above" | "below" | "upper" | "lower" | "refuge" | "shelter" | "flooded" | "normal" | "neighbor";
export type FloorPlan = {
  role: FloorRole; label: string; action: "out" | "refuge" | "shelter";
  open: boolean[];               // which stairs this floor may use
  premove: [number, number];     // minutes before people start moving
  priority: number;              // 1 = goes first
  advice: string[];
};
export type HazardPlan = { floors: FloorPlan[]; attack: number | null; refugeFloor: number | null; fire: V2 | null; notes: string[] };

const stairName = (i: number) => `Stair ${String.fromCharCode(65 + i)}`;
const listStairs = (open: boolean[]) => open.map((o, i) => o ? stairName(i) : null).filter(Boolean).join(", ");

function segDist(p: V2, a: V2, b: V2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/**
 * Per-floor evacuation plan for a hazard, following common high-rise fire-service practice:
 * - Fire: the stair closest to the fire becomes the fire department's attack stair (closed to occupants).
 *   The fire floor leaves first, then the floor above (smoke rises) and the floor below; in a high-rise
 *   the rest follow in phases, otherwise everyone leaves at once.
 * - Flood: below-grade levels leave, the ground floor moves up to a refuge floor, upper floors shelter in place.
 * - Blackout: everyone uses the stairs; elevators are out.
 */
export function planHazard(o: { scenario: "fire" | "flood" | "blackout"; stories: number; stairs: V2[]; fireFloor: number; fire: V2 | null; premove: [number, number]; highrise: boolean; belowGrade: boolean; refugeFloor?: number }): HazardPlan {
  const { scenario, stories, stairs, premove, highrise } = o;
  const all = stairs.map(() => true);
  const floors: FloorPlan[] = [];
  const notes: string[] = [];
  const shift = (p: [number, number], m: number): [number, number] => [p[0] + m, p[1] + m];
  if (scenario === "fire") {
    const ff = Math.min(stories - 1, Math.max(0, o.fireFloor));
    const fire = o.fire ?? [0, 0];
    const attack = stairs.length > 1 ? stairs.reduce((bi, q, i) => dist(fire, q) < dist(fire, stairs[bi]) ? i : bi, 0) : null;
    const others = all.map((_, i) => i !== attack);
    const fireFloorOpen = others.map((ok, i) => ok && dist(fire, stairs[i]) > FLOW.fireRadius * 1.2);
    if (!fireFloorOpen.some(Boolean)) others.forEach((ok, i) => { if (ok) fireFloorOpen[i] = true; });
    notes.push(attack != null ? `${stairName(attack)} is closest to the fire: kept clear for firefighters (attack stair).` : "Only one stair: occupants and firefighters share it.");
    for (let i = 0; i < stories; i++) {
      const name = i === 0 ? "Ground floor" : `Floor ${i + 1}`;
      if (i === ff) floors.push({ role: "fire", label: "Fire floor", action: "out", open: fireFloorOpen, premove: [0.5, 1.5], priority: 1, advice: [
        "Leave immediately. Pull the alarm and close doors behind you to hold back smoke.",
        `Go away from the fire to ${listStairs(fireFloorOpen)}${attack != null ? `; ${stairName(attack)} is near the fire and reserved for firefighters` : ""}.`,
        "Stay low if there is smoke. Never use elevators." ] });
      else if (i === ff + 1 || (highrise && i === ff + 2)) floors.push({ role: "above", label: i === ff + 1 ? "Directly above the fire" : "Two floors above the fire", action: "out", open: others, premove: shift(premove, 0), priority: 2, advice: [
        "Smoke and heat rise: evacuate next.",
        `Use ${listStairs(others)}. Your stair passes the fire floor; the enclosed stairwell protects you if its doors stay closed.`,
        "Do not go up to the roof." ] });
      else if (i === ff - 1) floors.push({ role: "below", label: "Directly below the fire", action: "out", open: others, premove: shift(premove, 0.5), priority: 2, advice: [
        "Evacuate early: fire can spread down and firefighting water comes through the ceiling.",
        `Use ${listStairs(others)}; you will not pass the fire floor.` ] });
      else if (i > ff) floors.push({ role: "upper", label: highrise ? "Upper floor, phased" : "Above the fire", action: "out", open: others, premove: highrise ? shift(premove, 4) : shift(premove, 1), priority: 3, advice: [
        highrise ? "High-rise phased evacuation: get ready and leave when told, or at once if smoke reaches your floor." : "Evacuate now: in a building this size everyone leaves at once.",
        `Use ${listStairs(others)}. Stairwell traffic from the fire floor goes first.` ] });
      else floors.push({ role: "lower", label: highrise ? "Lower floor, phased" : "Below the fire", action: "out", open: others, premove: highrise ? shift(premove, 3) : shift(premove, 1), priority: 3, advice: [
        "You are below the fire and will not pass it on the way down.",
        `Use ${listStairs(others)}${attack != null ? `; keep out of ${stairName(attack)}, where firefighters are going up` : ""}.` ] });
      floors[i].label = `${name} · ${floors[i].label}`;
    }
    return { floors, attack, refugeFloor: null, fire, notes };
  }
  if (scenario === "flood") {
    // Refuge is Floor 2 by default; if water keeps rising, it moves up (never above the top floor).
    const refuge = stories >= 2 ? Math.min(stories - 1, Math.max(1, o.refugeFloor ?? 1)) : null;
    const refugeName = refuge != null ? `Floor ${refuge + 1}` : "";
    notes.push(refuge != null ? `Water at the entrances: ${refuge > 1 ? `floors below ${refugeName} move up to it` : `the ground floor moves up to ${refugeName}`}; floors above shelter in place.` : "Single story: no upper floor to shelter on, so leave early for higher ground.");
    for (let i = 0; i < stories; i++) {
      const name = i === 0 ? "Ground floor" : `Floor ${i + 1}`;
      if (i === 0 && refuge != null) floors.push({ role: "flooded", label: `${name} · Flooding`, action: "refuge", open: all, premove: [0.5, 2], priority: 1, advice: [
        "Move up now. Do not walk or drive through moving water: 6 in can knock you down.",
        `Take ${listStairs(all)} up to ${refugeName} and stay together near the stairs.`,
        o.belowGrade ? "Anyone in the basement or garage leaves first." : "Shut off power at the panel only if it is dry and safe to reach." ] });
      else if (i === 0) floors.push({ role: "flooded", label: `${name} · Flooding`, action: "out", open: all, premove: [0.5, 2], priority: 1, advice: ["No upper floor: leave early toward higher ground, away from moving water."] });
      else if (refuge != null && i < refuge) floors.push({ role: "flooded", label: `${name} · Water rising`, action: "refuge", open: all, premove: [1, 3], priority: 1, advice: [
        `Water is still rising: move up to ${refugeName} by ${listStairs(all)}.`, "Bring phones, medication and warm clothes; leave everything else." ] });
      else if (i === refuge) floors.push({ role: "refuge", label: `${name} · Refuge floor`, action: "shelter", open: all, premove: premove, priority: 2, advice: ["Shelter in place and make room near the stairs for people coming up from the ground floor.", "Stay above the water line; wait for rescue or for the water to drop."] });
      else floors.push({ role: "shelter", label: `${name} · Shelter in place`, action: "shelter", open: all, premove: premove, priority: 3, advice: ["Stay put above the water. Keep phones charged and signal from a window if you need rescue."] });
    }
    return { floors, attack: null, refugeFloor: refuge, fire: null, notes };
  }
  notes.push("Elevators are out: everyone uses the stairs in emergency lighting.");
  for (let i = 0; i < stories; i++) {
    const name = i === 0 ? "Ground floor" : `Floor ${i + 1}`;
    floors.push({ role: "normal", label: `${name} · Stairs only`, action: "out", open: all, premove: shift(premove, Math.min(3, i * 0.3)), priority: i === 0 ? 1 : 2, advice: [
      `Use ${listStairs(all)} with a light; hold the handrail.`,
      i > 0 ? "Help neighbors who can't manage stairs: tell responders which floor they are on." : "Leave by the nearest exit; doors may need to be pushed manually." ] });
  }
  return { floors, attack: null, refugeFloor: null, fire: null, notes };
}

/** A neighbouring building in the same complex during a fire: leave on instruction, a few minutes later. */
export function planNeighbor(stories: number, stairs: V2[], premove: [number, number], fireBuilding: string): HazardPlan {
  const open = stairs.map(() => true);
  const floors: FloorPlan[] = Array.from({ length: stories }, (_, i) => ({
    role: "neighbor", label: `${i === 0 ? "Ground floor" : `Floor ${i + 1}`} · Next to the fire building`, action: "out", open,
    premove: [premove[0] + 3, premove[1] + 6], priority: 3,
    advice: [`The fire is in ${fireBuilding}. Get ready and leave when told, or at once if smoke reaches you.`,
      `Use ${listStairs(open)} and keep clear of the fire building's doors and the fire engines.`],
  }));
  return { floors, attack: null, refugeFloor: null, fire: null, notes: [] };
}

/**
 * One agent per dot. Each follows its floor's plan: walks to the best open stair (avoiding the fire on the
 * fire floor), queues at the stair's capacity, then goes down and out, up to the refuge floor, or stays put.
 */
export function simulate(opts: {
  ring: V2[]; floorHeight: number; peoplePerFloor: number[]; stairs: V2[]; doors: V2[]; outside: V2[][];
  plan: HazardPlan; maxDots: number; seed: number;
}) {
  const { ring, floorHeight, peoplePerFloor, stairs, doors, outside, plan } = opts;
  const total = peoplePerFloor.reduce((t, n) => t + n, 0);
  const perDot = Math.max(1, total / opts.maxDots);
  const rand = rng(opts.seed);
  const queueFree = stairs.map(() => 0);
  const raw: { floor: number; start: V2; t0: number; s: number }[] = [];
  const shelters: Agent[] = [];
  peoplePerFloor.forEach((n, floor) => {
    const fp = plan.floors[floor];
    const dots = Math.round(n / perDot);
    for (let i = 0; i < dots; i++) {
      let start = randomInside(ring, rand);
      if (plan.fire && fp.role === "fire" && dist(start, plan.fire) < FLOW.fireRadius) start = randomInside(ring, rand);
      if (fp.action === "shelter") { const w = world(start, floor * floorHeight + 0.4); shelters.push({ pts: [w], times: [0], stair: -1, floor, kind: "shelter", exitIdx: -1 }); continue; }
      // Best open stair: shortest walk, heavily penalised if the walk passes the fire.
      let best = -1, bestCost = Infinity;
      stairs.forEach((q, si) => {
        if (!fp.open[si]) return;
        let cost = dist(start, q);
        if (plan.fire && fp.role === "fire" && segDist(plan.fire, start, q) < FLOW.fireRadius) cost += 1000;
        if (cost < bestCost) { bestCost = cost; best = si; }
      });
      if (best < 0) best = 0;
      raw.push({ floor, start, t0: (fp.premove[0] + rand() * (fp.premove[1] - fp.premove[0])) * 60, s: best });
    }
  });
  const withArrival = raw.map(r => ({ ...r, arrive: r.t0 + dist(r.start, stairs[r.s]) / FLOW.walk })).sort((a, b) => a.arrive - b.arrive);
  const agents: Agent[] = [];
  const refuge = plan.refugeFloor;
  for (const r of withArrival) {
    const fp = plan.floors[r.floor];
    const y = r.floor * floorHeight + 0.4;
    const stair = stairs[r.s];
    const pts: V3[] = [world(r.start, y), world(stair, y)];
    const times = [r.t0, r.arrive];
    const usesStair = fp.action === "refuge" || r.floor > 0;
    let enter = r.arrive;
    if (usesStair) { enter = Math.max(r.arrive, queueFree[r.s]); queueFree[r.s] = enter + perDot / FLOW.stairCapacity; }
    if (fp.action === "refuge" && refuge != null) {
      // Up the stair to the refuge floor, then a few metres in to wait.
      const ry = refuge * floorHeight + 0.4, c = centroid(ring);
      pts.push(world(stair, y)); times.push(enter);
      pts.push(world(stair, ry)); times.push(enter + (refuge - r.floor) * floorHeight / FLOW.ascend);
      const spot: V2 = [stair[0] + (c[0] - stair[0]) * (0.15 + rand() * 0.2) + (rand() - 0.5) * 6, stair[1] + (c[1] - stair[1]) * (0.15 + rand() * 0.2) + (rand() - 0.5) * 6];
      pts.push(world(spot, ry)); times.push(times[times.length - 1] + dist(stair, spot) / FLOW.walk);
      agents.push({ pts, times, stair: r.s, floor: r.floor, kind: "refuge", exitIdx: -1 });
      continue;
    }
    if (r.floor > 0) { pts.push(world(stair, y)); times.push(enter); pts.push(world(stair, 0.4)); times.push(enter + (r.floor * floorHeight) / FLOW.descend); }
    const exitIdx = pts.length;  // segments from here on are outside the building
    let t = times[times.length - 1], prev = stair;
    for (const p of [doors[r.s], ...(outside[r.s] ?? [])]) { t += dist(prev, p) / FLOW.walk; pts.push(world(p, 0.4)); times.push(t); prev = p; }
    agents.push({ pts, times, stair: r.s, floor: r.floor, kind: "out", exitIdx });
  }
  const all = [...agents, ...shelters];
  const finish = agents.reduce((m, a) => Math.max(m, a.times[a.times.length - 1]), 0);
  return { agents: all, perDot, finish };
}

export function positionAt(a: Agent, t: number): { p: V3; state: AgentState } {
  const { pts, times } = a;
  if (a.kind === "shelter") return { p: pts[0], state: "shelter" };
  if (t <= times[0]) return { p: pts[0], state: "waiting" };
  const last = times.length - 1;
  if (t >= times[last]) return { p: pts[last], state: a.kind === "refuge" ? "refuge" : "out" };
  let i = 0;
  while (i < last && t > times[i + 1]) i++;
  const span = times[i + 1] - times[i] || 1, k = (t - times[i]) / span;
  const a0 = pts[i], a1 = pts[i + 1];
  const p: V3 = [a0[0] + (a1[0] - a0[0]) * k, a0[1] + (a1[1] - a0[1]) * k, a0[2] + (a1[2] - a0[2]) * k];
  const queued = a0[0] === a1[0] && a0[1] === a1[1] && a0[2] === a1[2];
  const onStairs = a0[1] !== a1[1];
  return { p, state: queued ? "queued" : onStairs ? "stairs" : a.exitIdx > 0 && i >= a.exitIdx ? "out" : "moving" };
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
/** "Third floor" → 2 (zero-based story index), or null. */
export function storyIndex(name: string) {
  const w = name.toLowerCase().split(" ")[0];
  const i = ORDINALS.indexOf(w);
  return i >= 0 ? i : null;
}

/**
 * A stair becomes unusable at time t (smoke, collapse). Everyone assigned to it who has not yet entered it
 * turns around from where they are and walks to the nearest open stair in the same building, joining that
 * stair's queue behind the people already using it. People already inside the stairwell keep going.
 */
export function rerouteAround(o: {
  agents: Agent[]; t: number; closed: number; stairs: V2[]; doors: V2[]; outside: V2[][];
  floorHeight: number; perDot: number; refugeFloor: number | null;
  candidates: (a: Agent) => number[];   // usable stairs for this agent (same building, open on its floor)
  shared?: Set<number>;                 // stairs occupants now share with firefighters going up (slower)
}): Agent[] {
  const { agents, t, closed, stairs, doors, outside, floorHeight, perDot } = o;
  const usesStair = (a: Agent) => a.kind === "refuge" || a.floor > 0;
  const entered = (a: Agent) => usesStair(a) ? a.times[2] <= t : a.times[1] <= t;
  const affected = (a: Agent) => a.kind !== "shelter" && a.stair === closed && !entered(a);
  const cap = (s: number) => FLOW.stairCapacity * (o.shared?.has(s) ? FLOW.counterflow : 1);
  const queueFree = stairs.map(() => t);
  for (const a of agents) if (!affected(a) && usesStair(a) && a.stair >= 0 && a.kind !== "shelter")
    queueFree[a.stair] = Math.max(queueFree[a.stair], a.times[2] + perDot / cap(a.stair));
  const moved = agents.filter(affected).map(a => {
    const started = t > a.times[0];
    const { p } = positionAt(a, Math.max(t, a.times[0]));
    const here: V2 = [p[0], -p[2]];
    const options = o.candidates(a).filter(s => s !== closed);
    if (!options.length) return { a, keep: true as const };
    const s = options.reduce((bi, si) => dist(here, stairs[si]) < dist(here, stairs[bi]) ? si : bi, options[0]);
    const t0 = started ? t : a.times[0];
    return { a, keep: false as const, s, here, y: p[1], t0, arrive: t0 + dist(here, stairs[s]) / FLOW.walk };
  });
  const replaced = new Map<Agent, Agent>();
  for (const m of moved.filter(m => !m.keep).sort((x, y) => (x as { arrive: number }).arrive - (y as { arrive: number }).arrive) as { a: Agent; s: number; here: V2; y: number; t0: number; arrive: number }[]) {
    const { a, s, here, y, t0, arrive } = m;
    const stair = stairs[s];
    const pts: V3[] = [[here[0], y, -here[1]], world(stair, y)];
    const times = [t0, arrive];
    let enter = arrive;
    if (usesStair(a)) { enter = Math.max(arrive, queueFree[s]); queueFree[s] = enter + perDot / cap(s); }
    if (a.kind === "refuge" && o.refugeFloor != null) {
      const ry = o.refugeFloor * floorHeight + 0.4;
      pts.push(world(stair, y)); times.push(enter);
      pts.push(world(stair, ry)); times.push(enter + Math.abs(ry - y) / FLOW.ascend);
      replaced.set(a, { ...a, pts, times, stair: s, exitIdx: -1 });
      continue;
    }
    if (a.floor > 0) { pts.push(world(stair, y)); times.push(enter); pts.push(world(stair, 0.4)); times.push(enter + Math.max(0, y - 0.4) / FLOW.descend); }
    const exitIdx = pts.length;
    let tt = times[times.length - 1], prev = stair;
    for (const q of [doors[s], ...(outside[s] ?? [])]) { tt += dist(prev, q) / FLOW.walk; pts.push(world(q, 0.4)); times.push(tt); prev = q; }
    replaced.set(a, { ...a, pts, times, stair: s, exitIdx });
  }
  return agents.map(a => replaced.get(a) ?? a);
}

/** When the last person leaves the building (reaches an exit door), in seconds. */
export function buildingClear(agents: Agent[]) {
  return agents.reduce((m, a) => a.kind === "out" && a.exitIdx > 0 ? Math.max(m, a.times[a.exitIdx] ?? 0) : m, 0);
}
