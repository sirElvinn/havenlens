import { peopleAt, type BuildingRow, type Flag } from "./dossier";
import { exposedAt, mobilityAt, scenarioScore, type Scenario } from "./scenario";

export type Incident = { lat: number; lon: number; radius: number };

export const FLAG_LABEL: Record<Flag, string> = {
  highrise: "High-rise", nosprinklers: "No sprinklers", woodframe: "Wood frame", senior: "Senior housing",
  healthcare: "Healthcare", walkup: "Walk-up", old: "Pre-1975", belowgrade: "Below grade", parking: "Parking deck",
};

// Flags that change how a crew approaches a building, with the weight each adds to triage.
const FLAG_WEIGHT: Partial<Record<Flag, number>> = { senior: 25, healthcare: 25, highrise: 20, nosprinklers: 15, walkup: 10, woodframe: 10 };

export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function bearing(aLat: number, aLon: number, bLat: number, bLon: number) {
  const rad = Math.PI / 180;
  const y = Math.sin((bLon - aLon) * rad) * Math.cos(bLat * rad);
  const x = Math.cos(aLat * rad) * Math.sin(bLat * rad) - Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos((bLon - aLon) * rad);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}

export type Nearby = { b: BuildingRow; dist: number; dir: string; now: number; exposed: number; mobility: number; score: number; triage: number };

export function analyze(all: BuildingRow[], incident: Incident, hour: number, scenario: Scenario = "fire") {
  const nearby: Nearby[] = [];
  for (const b of all) {
    const dist = distanceMeters(incident.lat, incident.lon, b.lat, b.lon);
    if (dist > incident.radius) continue;
    const now = peopleAt(b, hour);
    const exposed = exposedAt(b, scenario, hour);
    const mobility = mobilityAt(b, hour);
    const score = scenarioScore(b, scenario, hour).score;
    // Triage: the building's own priority, how many people are in it right now,
    // special-needs flags, and closeness to the reported location.
    const flagPoints = b.flags.reduce((t, f) => t + (FLAG_WEIGHT[f] ?? 0), 0);
    const triage = score + 18 * Math.log10(1 + now) + 8 * Math.log10(1 + mobility) + flagPoints + (exposed ? 10 : 0) - 20 * (dist / incident.radius);
    nearby.push({ b, dist, dir: bearing(incident.lat, incident.lon, b.lat, b.lon), now, exposed, mobility, score, triage });
  }
  nearby.sort((a, z) => z.triage - a.triage);
  const count = (f: Flag) => nearby.filter(n => n.b.flags.includes(f)).length;
  return {
    nearby,
    people: nearby.reduce((t, n) => t + n.now, 0),
    exposed: nearby.reduce((t, n) => t + n.exposed, 0),
    mobility: nearby.reduce((t, n) => t + n.mobility, 0),
    belowgrade: count("belowgrade"),
    sprinklersUnconfirmed: nearby.filter(n => n.b.sprinklers !== true).length,
    highrise: count("highrise"), senior: count("senior"), healthcare: count("healthcare"),
    walkup: count("walkup"), woodframe: count("woodframe"),
    closest: [...nearby].sort((a, z) => a.dist - z.dist)[0] ?? null,
  };
}

export function parseIncident(value: string | null): Incident | null {
  const parts = (value ?? "").split(",").map(Number);
  if (parts.length < 2 || !parts.slice(0, 2).every(Number.isFinite)) return null;
  const [lat, lon, radius = 250] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, radius: Math.min(1000, Math.max(50, radius)) };
}
