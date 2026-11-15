export type Tier = "High" | "Elevated" | "Standard";
export type OccupancyClass = "residential" | "hotel" | "office" | "retail" | "industrial" | "healthcare";

export type BuildingRow = {
  id: number; name: string; street: string; city: string | null; state: string | null; zip: string | null;
  lat: number; lon: number; type: string; stories: number | null; score: number; tier: Tier;
  people: number | null; class: OccupancyClass; sprinklers: boolean | null; tour: boolean;
  flags: Flag[];
  elev: number | null; heightFt: number | null; style: string | null;
};

export type Flag = "highrise" | "nosprinklers" | "woodframe" | "senior" | "healthcare" | "walkup" | "old" | "belowgrade" | "parking";

export type Factor = { points: number; label: string; detail: string; kind: "risk" | "gap" };
export type Tenant = { name: string; industry: string | null; employees: number | null; sqft: number | null; floors: string[]; since: string | null };
export type Floor = { name: string; sqft: number | null; tenants: number; occupiedSqft: number; employees: number };

export type Dossier = BuildingRow & {
  subtype: string | null; heightFeet: number | null; grossSqft: number | null; typicalFloorSqft: number | null;
  lotAcres: number | null; material: string | null; sprinklerType: string | null; built: number | null;
  renovated: number | null; buildingClass: string | null; elevators: number | null; parkingSpaces: number | null;
  peopleBasis: string | null; designLoad: number | null; factors: Factor[]; confidence: number;
  floors: Floor[]; floorRecordsNote: string; tenants: Tenant[]; tenantCount: number; tenancyHistory: number;
  headcount: number | null;
  apartment: { units: number | null; buildings: number | null; style: string | null; lifestyle: string | null;
    vacancyPercent: number | null; walkup: boolean | null; affordableUnits: number | null; pets: string[]; unitsAvailable: number | null } | null;
  hotel: { rooms: number | null; brand: string | null; pools: number | null } | null;
  sales: { date: string | null; price: number | null; portfolio: boolean }[]; saleCount: number;
  listings: { active: number; availableSqft: number } | null;
  photos: string[]; models: string[]; modelCount: number;
};

// Share of a building's busiest-hour population present at each hour of the day.
// These are typical occupancy profiles (assumptions), not observed presence.
export const PROFILES: Record<OccupancyClass, number[]> = {
  residential: [.95,.95,.95,.95,.95,.95,.92,.8,.6,.42,.4,.4,.4,.4,.4,.42,.48,.58,.7,.8,.86,.9,.92,.94],
  hotel:       [.95,.95,.95,.95,.95,.95,.92,.8,.6,.4,.35,.35,.35,.35,.38,.45,.55,.65,.72,.78,.84,.9,.93,.95],
  office:      [.03,.03,.03,.03,.03,.05,.1,.35,.75,.95,.97,.95,.82,.92,.95,.9,.78,.45,.2,.1,.06,.05,.04,.03],
  retail:      [.02,.02,.02,.02,.02,.02,.04,.08,.15,.35,.55,.75,.85,.8,.72,.72,.78,.9,.92,.8,.55,.3,.08,.03],
  industrial:  [.18,.18,.18,.18,.18,.25,.6,.85,.95,.95,.95,.95,.88,.95,.95,.9,.7,.5,.3,.25,.22,.2,.2,.18],
  healthcare:  [.6,.6,.6,.6,.6,.62,.75,.95,1,1,1,1,1,1,1,1,1,.95,.9,.82,.75,.7,.65,.62],
};

export function peopleAt(b: Pick<BuildingRow, "people" | "class">, hour: number) {
  return b.people ? Math.round(b.people * PROFILES[b.class][((Math.floor(hour) % 24) + 24) % 24]) : 0;
}

export const SLEEPING: OccupancyClass[] = ["residential", "hotel"];

export function hourLabel(h: number) {
  const hour = ((Math.floor(h) % 24) + 24) % 24;
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

export const TIER_COLOR: Record<Tier, string> = { High: "#ff5a3c", Elevated: "#ffb23e", Standard: "#58c4a6" };

export const fmt = (n: number | null | undefined, unit = "") =>
  n === null || n === undefined ? null : Math.round(n).toLocaleString("en-US") + unit;

let indexPromise: Promise<{ generated: string; buildings: BuildingRow[] }> | null = null;
export function loadIndex() {
  indexPromise ??= fetch("/dossier-data/index.json").then(r => {
    if (!r.ok) throw new Error("Dossier data is missing. Run `npm run dossiers -- /path/to/kit`.");
    return r.json();
  });
  return indexPromise;
}

export async function loadDossier(id: number): Promise<Dossier | null> {
  const r = await fetch(`/dossier-data/b/${id % 64}.json`);
  if (!r.ok) return null;
  return (await r.json())[id] ?? null;
}

// A plain-language brief that keeps recorded facts, estimates and unknowns apart.
export function writeBrief(d: Dossier) {
  const recorded: string[] = [], estimated: string[] = [], unknown: string[] = [];
  const kind = d.apartment?.style ? `${d.apartment.style.toLowerCase()} apartment community` : d.type.toLowerCase() + " building";
  recorded.push(`${d.name} is a ${d.stories ? d.stories + "-story " : ""}${kind}${d.built ? `, built in ${d.built}` : ""}${d.renovated ? ` and renovated in ${d.renovated}` : ""}.`);
  if (d.material) recorded.push(`Construction is recorded as ${d.material.toLowerCase()}.`); else unknown.push("Construction type");
  if (d.sprinklers === true) recorded.push(`It is recorded as sprinklered${d.sprinklerType ? ` (${d.sprinklerType.toLowerCase()} system)` : ""}.`);
  else if (d.sprinklers === false) recorded.push("The record states it has no sprinklers.");
  else unknown.push("Sprinkler status");
  if (d.heightFeet) recorded.push(`Height is ${Math.round(d.heightFeet)} ft${d.heightFeet >= 75 ? ", above typical aerial-ladder reach" : ""}.`);
  else unknown.push("Building height");
  if (d.elevators) recorded.push(`${d.elevators} passenger/freight elevator${d.elevators > 1 ? "s are" : " is"} recorded.`);
  if (d.apartment?.walkup) recorded.push("It is a walk-up: stairs are the only vertical route.");
  if (d.apartment?.lifestyle === "Senior") recorded.push("It is marketed as senior housing.");
  if (d.apartment?.pets.length) recorded.push(`Pets allowed: ${d.apartment.pets.join(", ").toLowerCase()}.`);
  if (d.tenantCount) recorded.push(`${d.tenantCount} current tenanc${d.tenantCount > 1 ? "ies are" : "y is"} on file${d.tenants[0]?.name !== "Unidentified tenant" ? `; the largest is ${d.tenants[0].name}` : ""}.`);
  if (d.people) {
    const night = peopleAt(d, 3), day = peopleAt(d, 14);
    estimated.push(`About ${d.people.toLocaleString()} people at the busiest hour (${d.peopleBasis}).`);
    estimated.push(`Roughly ${day.toLocaleString()} at 2 PM and ${night.toLocaleString()} at 3 AM${SLEEPING.includes(d.class) ? ", most of them likely asleep at night" : ""}.`);
  } else unknown.push("Occupant numbers");
  if (!d.built) unknown.push("Year built");
  if (!d.stories) unknown.push("Story count");
  unknown.push("Stair, standpipe and exit locations (not in any supplied dataset)");
  return { recorded, estimated, unknown };
}
