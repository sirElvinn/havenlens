"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { hourLabel, peopleAt, type Dossier } from "../lib/dossier";
import { accessChecks, EGRESS, estimateEvacuation } from "../lib/evacuation";
import { SCENARIOS, type Scenario } from "../lib/scenario";

type Assembly = {
  minDist: number;
  candidate: { lat: number; lon: number; dist: number; dir: string; areaM2: number | null; image: string | null } | null;
  route: { source: "osm" | "straight"; distanceM: number; path: [number, number][] } | null;
};

const mins = (seconds: number) => seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;

export default function EvacuationPanel({ d, hour, scenario, onOpen3D }: { d: Dossier; hour: number; scenario: Scenario; onOpen3D?: () => void }) {
  const est = estimateEvacuation(d, hour, scenario);
  const checks = accessChecks(d, scenario);
  const meta = SCENARIOS[scenario];
  const [live, setLive] = useState<boolean | null>(null);
  const [assembly, setAssembly] = useState<Assembly | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Collapse zone: stay at least 1.5 × the building height away (3.5 m per story when height is unknown).
  const heightM = d.heightFeet ? d.heightFeet * 0.3048 : (d.stories ?? 1) * 3.5;
  const minDist = Math.max(30, Math.round(heightM * 1.5));

  useEffect(() => {
    fetch("/api/vexcel/status").then(r => r.ok ? r.json() : { configured: false }).then(s => setLive(Boolean(s.configured))).catch(() => setLive(false));
  }, []);

  async function find() {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/vexcel/${d.id}/assembly?min=${minDist}`);
      const body = await r.json();
      if (r.ok) setAssembly(body); else setError(body.error || "The assembly search failed.");
    } catch { setError("The assembly search failed."); } finally { setBusy(false); }
  }

  // Look it up as soon as the panel opens (cached per building after the first search).
  const wantsAssembly = !(scenario === "flood" && (d.stories ?? 1) >= 2);
  useEffect(() => {
    if (live && wantsAssembly && !assembly && !busy) find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, wantsAssembly, d.id, minDist]);

  const cand = assembly?.candidate, route = assembly?.route;
  const capacity = cand?.areaM2 ? Math.round(cand.areaM2 * EGRESS.usableShare / EGRESS.areaPerPerson) : null;
  const total = est ? est.total : null;
  const moveShare = est ? est.movement / (est.movement + (est.premove[0] + est.premove[1]) / 2) : 0;

  return <section className="card evac" style={{ ["--acc" as string]: meta.accent }}>
    <div className="cardHead"><h2>Evacuation estimate <span className="tag">{meta.label} · {hourLabel(hour)} · planning estimate</span></h2>
      {onOpen3D && <button className="primary" onClick={onOpen3D}>Watch it in 3D</button>}</div>
    <div className="evacGrid">
      <div>
        {est && total ? <>
          <p className="evacTime"><b>{Math.max(1, Math.round(total[0]))}–{Math.ceil(total[1])}</b> <span>{est.method === "up" ? `minutes to move ${est.people.toLocaleString()} ground-floor people up to Floor 2 (est.)` : `minutes to get ${est.people.toLocaleString()} people out (est.)`}</span></p>
          <div className="evacBar" aria-hidden="true"><i style={{ width: `${(1 - moveShare) * 100}%` }} /><em style={{ width: `${moveShare * 100}%` }} /></div>
          <div className="evacLegend"><span><i className="pre" />Noticing and reacting: {est.premove[0]}–{est.premove[1]} min</span><span><i className="mov" />Moving {est.method === "stairs" ? "down the stairs" : est.method === "up" ? "up the stairs" : "through the exits"}: about {Math.max(1, Math.round(est.movement))} min</span></div>
          <ul className="evacNotes">
            <li>{est.method === "up"
              ? `${est.people.toLocaleString()} ground-floor people climb ${est.exits} code-minimum stairs to Floor 2. Everyone above stays put.`
              : est.method === "stairs"
              ? `${est.upper.toLocaleString()} people above the ground floor share ${est.exits} code-minimum stairs (44 in wide). Movement uses Pauls' high-rise evacuation formula.`
              : `${est.people.toLocaleString()} people leave through ${est.exits} code-minimum exit doors (36 in).`}</li>
            {est.notes.map(n => <li key={n}>{n}</li>)}
            {est.assisted > 0 && <li className="hot">About {est.assisted.toLocaleString()} people may need help to evacuate. Assisted evacuation is not included in this range and typically takes much longer.</li>}
          </ul>
        </> : <p className="muted">There is no occupancy estimate for this building, so no evacuation time can be estimated.</p>}

        <h3 className="subhead">Accessibility readiness</h3>
        <ul className="access">{checks.map(c => <li key={c.label} className={c.state}><b>{c.state === "ok" ? "✓" : c.state === "warn" ? "!" : "?"}</b><div><strong>{c.label}</strong><small>{c.detail}</small></div></li>)}</ul>
        <p className="fine">Built from what CoStar records. This is not an ADA compliance check: stair widths, ramps and refuge areas are not in any supplied dataset.</p>
      </div>

      {scenario === "flood" && (d.stories ?? 1) >= 2 ? <FloodRefuge d={d} hour={hour} /> : <div>
        <h3 className="subhead">Assembly area</h3>
        {scenario === "flood" && <p className="fit bad">Single-story building: there is no upper floor to shelter on. Leave early, before water arrives. The lot below is the nearest open space found in imagery; its elevation is not verified, and parking lots are often low-lying.</p>}
        {!assembly ? <>
          {live === false ? <p className="offline">Needs the Vexcel connection. Run <code>npm run api</code> with the key set.</p>
            : error ? <><p className="errorBox">{error}</p><button onClick={find} disabled={busy}>{busy ? "Searching…" : "Try again"}</button></>
            : <p className="muted assemblyLoading"><i aria-hidden="true" />Finding the best open lot and a walking route…</p>}
        </> : !cand ? <p className="muted">No open lot was found outside the {minDist} m collapse zone within about 350 m. Choose an assembly area on site.</p> : <>
          <RouteMap from={[d.lat, d.lon]} to={[cand.lat, cand.lon]} path={route?.path ?? []} accent={meta.accent} />
          <dl className="mini evacStats">
            <div><dt>Distance</dt><dd>{route ? route.distanceM.toLocaleString() : cand.dist} m {route?.source === "straight" ? "(est.)" : "walk"}</dd></div>
            <div><dt>Walking</dt><dd>{route ? mins(route.distanceM / EGRESS.walkSpeed) : "—"}</dd></div>
            <div><dt>Wheelchair / assisted</dt><dd>{route ? mins(route.distanceM / EGRESS.assistedSpeed) : "—"}</dd></div>
            <div className={capacity != null && est && capacity < est.people ? "alert" : ""}><dt>Capacity (est.)</dt><dd>{capacity ? `~${capacity.toLocaleString()} people` : "Unknown"}</dd></div>
          </dl>
          {capacity != null && est && <p className={"fit " + (capacity >= est.people ? "ok" : "bad")}>{capacity >= est.people
            ? `Fits everyone inside at ${hourLabel(hour)} (${est.people.toLocaleString()} people).`
            : `Too small for everyone inside at ${hourLabel(hour)} (${est.people.toLocaleString()} people). Plan a second area.`}</p>}
          <p className="fine">{cand.dist} m {cand.dir} of the building in a straight line. Chosen by Vexcel aerial image search as the best-matching open paved lot outside the collapse zone (at least {minDist} m away, 1.5 × the building&apos;s height). Route: {route?.source === "osm" ? "OpenStreetMap walking route (FOSSGIS router)" : "straight line × 1.3, router unavailable"}. Capacity assumes {Math.round(EGRESS.usableShare * 100)}% of a {cand.areaM2?.toLocaleString() ?? "?"} m² lot is usable at {EGRESS.areaPerPerson} m² per person. A candidate only: confirm access, ownership and hazards on site.</p>
        </>}
      </div>}
    </div>
  </section>;
}

export function AssemblyPanel({ d, hour, scenario, visible }: { d: Dossier; hour: number; scenario: Scenario; visible: boolean }) {
  const est = estimateEvacuation(d, hour, scenario);
  const meta = SCENARIOS[scenario];
  const [assembly, setAssembly] = useState<Assembly | null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const refuge = scenario==="flood" && (d.stories ?? 1)>=2;
  const heightM = d.heightFeet ? d.heightFeet * 0.3048 : (d.stories ?? 1) * 3.5;
  const minDist = Math.max(30, Math.round(heightM * 1.5));
  useEffect(()=>{
    if (!visible || refuge || assembly) return;
    const request = new AbortController();
    setError(false);
    fetch(`/api/vexcel/${d.id}/assembly?min=${minDist}`,{signal:request.signal})
      .then(r=>{if(!r.ok) throw new Error(); return r.json();})
      .then(result=>{if(!request.signal.aborted) setAssembly(result);})
      .catch(()=>{if(!request.signal.aborted) setError(true);});
    return ()=>request.abort();
  },[visible,refuge,assembly,attempt,d.id,minDist]);

  const cand = assembly?.candidate, route = assembly?.route;
  const capacity = cand?.areaM2 ? Math.round(cand.areaM2 * EGRESS.usableShare / EGRESS.areaPerPerson) : null;
  return <section className={cand && !refuge ? "assemblyCanvas" : "card evac"} style={{ ["--acc" as string]: `var(--signal-${scenario})` }}>
      {scenario === "flood" && (d.stories ?? 1) >= 2 ? <FloodRefuge d={d} hour={hour} /> : <div>
        {!assembly ? <div className="assemblyStatus" role="status">{error ? <>Assembly map unavailable. <button onClick={()=>setAttempt(n=>n+1)}>Try again</button></> : "Looking for a gathering place…"}</div>
         : !cand ? <p className="muted">No open lot was found outside the {minDist} m collapse zone within about 350 m. Choose an assembly area on site.</p> : <>
          {visible && <RouteMap from={[d.lat, d.lon]} to={[cand.lat, cand.lon]} path={route?.path ?? []} accent={meta.accent} />}
          <aside className="assemblyCaption"><b>Possible gathering place</b><p>{cand.dist} m {cand.dir} of the building · Confirm access on site.</p>
          {scenario==="flood" && <p>Flood conditions and lot elevation are unverified.</p>}
          <details><summary>Map details</summary>
          <dl className="mini evacStats">
            <div><dt>Distance</dt><dd>{route ? route.distanceM.toLocaleString() : cand.dist} m {route?.source === "straight" ? "(est.)" : "walk"}</dd></div>
            <div><dt>Walking</dt><dd>{route ? mins(route.distanceM / EGRESS.walkSpeed) : "—"}</dd></div>
            <div><dt>Wheelchair / assisted</dt><dd>{route ? mins(route.distanceM / EGRESS.assistedSpeed) : "—"}</dd></div>
            <div className={capacity != null && est && capacity < est.people ? "alert" : ""}><dt>Capacity (est.)</dt><dd>{capacity ? `~${capacity.toLocaleString()} people` : "Unknown"}</dd></div>
          </dl>
          {capacity != null && est && <p className={"fit " + (capacity >= est.people ? "ok" : "bad")}>{capacity >= est.people
            ? `Fits everyone inside at ${hourLabel(hour)} (${est.people.toLocaleString()} people).`
            : `Too small for everyone inside at ${hourLabel(hour)} (${est.people.toLocaleString()} people). Plan a second area.`}</p>}
          <p className="fine">{cand.dist} m {cand.dir} of the building in a straight line. Chosen as the best-matching open paved lot outside the collapse zone (Vexcel image search). Route: {route?.source === "osm" ? "OpenStreetMap walking route (FOSSGIS router)" : "straight line × 1.3, router unavailable"}. Capacity assumes {Math.round(EGRESS.usableShare * 100)}% of a {cand.areaM2?.toLocaleString() ?? "?"} m² lot is usable at {EGRESS.areaPerPerson} m² per person. A candidate only: confirm access, ownership and hazards on site.</p>
          </details></aside>
        </>}
      </div>}
  </section>;
}

/** Flood plan for multi-story buildings: move up, don't go out. Capacity of the refuge floor from CoStar floor area. */
function FloodRefuge({ d, hour }: { d: Dossier; hour: number }) {
  const stories = d.stories ?? 2;
  const floorSqft = d.typicalFloorSqft ?? (d.grossSqft ? d.grossSqft / stories : null);
  const capacity = floorSqft ? Math.round(floorSqft * 0.0929 * 0.5 / EGRESS.areaPerPerson) : null;   // half the floor usable, 1 m² each
  const now = peopleAt(d, hour);
  const ground = Math.round(now / stories), onRefuge = Math.round(now / stories);
  const fits = capacity != null ? capacity >= ground + onRefuge : null;
  return <div>
    <h3 className="subhead">Vertical refuge, not an outdoor assembly area</h3>
    <p className="fit bad">In a flood, nearby open lots are usually low, paved and among the first places to go under. Walking out through moving water is more dangerous than staying above it, so HavenLens does not send anyone to a parking lot.</p>
    <dl className="mini evacStats">
      <div><dt>Refuge floor</dt><dd>Floor 2</dd></div>
      <div><dt>Moving up (est.)</dt><dd>{ground.toLocaleString()} people</dd></div>
      <div><dt>Already on Floor 2</dt><dd>{onRefuge.toLocaleString()} people</dd></div>
      <div className={fits === false ? "alert" : ""}><dt>Floor 2 capacity (est.)</dt><dd>{capacity ? `~${capacity.toLocaleString()} people` : "Unknown"}</dd></div>
    </dl>
    {fits != null && <p className={"fit " + (fits ? "ok" : "bad")}>{fits ? `Floor 2 can hold the ground floor plus its own occupants at ${hourLabel(hour)}.` : `Floor 2 is too small for everyone at ${hourLabel(hour)}: open Floor 3 as well.`}</p>}
    <ul className="evacNotes">
      <li>Upper floors shelter in place and keep stairwells clear for people coming up.</li>
      {d.flags.includes("belowgrade") && <li>Clear basements, garages and lower levels first: they flood first.</li>}
      <li>If evacuation is ordered, responders pick the route from current water depth. HavenLens has no live flood data.</li>
    </ul>
    <p className="fine">Capacity: CoStar typical floor area{floorSqft ? ` (${Math.round(floorSqft).toLocaleString()} sq ft${(d.apartment?.buildings ?? 1) > 1 ? ` across ${d.apartment!.buildings} buildings` : ""})` : ""}, half of it usable at {EGRESS.areaPerPerson} m² per person.</p>
  </div>;
}

function RouteMap({ from, to, path, accent }: { from: [number, number]; to: [number, number]; path: [number, number][]; accent: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: Leaflet.Map | null = null, cancelled = false;
    import("leaflet").then(L => {
      if (cancelled || !host.current) return;
      map = L.map(host.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "darkTiles", attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      const line = path.length > 1 ? path : [from, to];
      L.polyline(line, { color: "#000", weight: 8, opacity: 0.5 }).addTo(map);
      L.polyline(line, { color: accent, weight: 4, dashArray: "8 6" }).addTo(map);
      L.circleMarker(from, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff5a3c", fillOpacity: 1 }).bindTooltip("Building", { permanent: true, direction: "top", className: "mapTip" }).addTo(map);
      L.circleMarker(to, { radius: 10, color: "#fff", weight: 2, fillColor: "#58c4a6", fillOpacity: 1 }).bindTooltip("Possible gathering place", { permanent: true, direction: "top", className: "mapTip" }).addTo(map);
      map.fitBounds(L.latLngBounds(line).pad(0.25));
      requestAnimationFrame(() => map?.invalidateSize());
    });
    return () => { cancelled = true; map?.remove(); };
    // Rebuild only when the route itself changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from[0], from[1], to[0], to[1], path.length, accent]);
  return <div ref={host} className="routeMap" role="img" aria-label="Walking route from the building to the assembly area" />;
}
