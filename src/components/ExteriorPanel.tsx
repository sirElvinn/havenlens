"use client";

import { useEffect, useState } from "react";

type Parcel = {
  found: boolean; isFallbackArea: boolean; directions: string[]; obliqueCaptured: string | null;
  collection: string | null; structureCount: number | null; footprintSqft: number | null;
  roofMaterial: string | null; roofShape: string | null; roofCondition: number | null;
  roofObjects: Record<string, number>; treeCoverPercent: number | null; pool: boolean | null;
  buildingType: string | null; retrieved: string;
};
type Staging = { query: string; candidates: { lat: number; lon: number; dist: number; dir: string; score: number; image: string | null }[]; retrieved: string };
// What each detected object means to a responder. A pool is mainly a water source, not a hazard.
const KIND: Record<string, { group: "Hazards" | "Resources" | "Obstacles"; why: string }> = {
  "solar panel": { group: "Hazards", why: "Stays energized when grid power is cut: shock risk; don't cut through" },
  "construction scaffolding": { group: "Hazards", why: "Collapse and climbing risk; may block access" },
  "rooftop hvac unit": { group: "Hazards", why: "Heavy roof load and trip hazard for roof crews" },
  "fire hydrant": { group: "Resources", why: "Water supply for engines" },
  "swimming pool": { group: "Resources", why: "Static water source engines can draft from; drowning risk in dark or smoke" },
  "parked car": { group: "Obstacles", why: "Can block apparatus placement and ladder positions" },
};
const GROUP_TONE = { Hazards: "bad", Resources: "ok", Obstacles: "warn" } as const;

type Detect = { labels: string[]; found: { label: string; color: string; count: number; best: number }[]; overlay: string | null; model: string; retrieved: string };

const VIEWS = [["ortho", "Top-down"], ["oblique-north", "From south"], ["oblique-east", "From west"], ["oblique-south", "From north"], ["oblique-west", "From east"]] as const;

export default function ExteriorPanel({ id }: { id: number }) {
  const [state, setState] = useState<"loading" | "off" | "error" | "ready">("loading");
  const [message, setMessage] = useState("");
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [view, setView] = useState("ortho");
  const [detect, setDetect] = useState<Detect | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [staging, setStaging] = useState<Staging | null>(null);
  const [searching, setSearching] = useState(false);

  async function findStaging() {
    setSearching(true);
    try {
      const r = await fetch(`/api/vexcel/${id}/staging`);
      const body = await r.json();
      if (r.ok) setStaging(body); else setMessage(body.error || "Staging search failed.");
    } finally { setSearching(false); }
  }

  // Rooftop notes from Vexcel's roof attributes and any hazard scan already run.
  function roofNotes(p: Parcel) {
    const notes: { tone: "ok" | "warn" | "bad"; text: string }[] = [];
    const shape = String(p.roofShape ?? "").toLowerCase();
    if (shape === "flat") notes.push({ tone: "ok", text: "Flat roof: crews can likely work on it. Check for obstructions and access hatches." });
    else if (shape) notes.push({ tone: "warn", text: `${shape[0].toUpperCase() + shape.slice(1)} roof: not suited to crew operations without equipment.` });
    if (p.roofCondition != null && p.roofCondition <= 2) notes.push({ tone: "bad", text: `Roof condition ${p.roofCondition}/5: weakened roofs can fail under crew load.` });
    const objects = Object.values(p.roofObjects).reduce((t, n) => t + n, 0);
    const hvac = detect?.found.find(f => f.label === "rooftop hvac unit")?.count ?? 0;
    const solar = detect?.found.find(f => f.label === "solar panel")?.count ?? 0;
    if (objects || hvac) notes.push({ tone: "warn", text: `${Math.max(objects, hvac)} rooftop object${Math.max(objects, hvac) > 1 ? "s" : ""} detected (HVAC and equipment): obstructions for crews and ladders.` });
    if (solar) notes.push({ tone: "bad", text: `Solar panels detected: they stay energized when grid power is cut. Shock hazard for crews.` });
    if (!detect) notes.push({ tone: "ok", text: "Run the exterior scan to check the roof for solar panels and equipment." });
    return notes;
  }

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const s = await fetch("/api/vexcel/status");
        if (!s.ok || !(await s.json()).configured) { if (live) setState("off"); return; }
        const r = await fetch(`/api/vexcel/${id}/parcel`);
        const body = await r.json();
        if (!live) return;
        if (!r.ok) { setMessage(body.error || "Vexcel lookup failed."); setState("error"); return; }
        setParcel(body); setState("ready");
      } catch { if (live) setState("off"); }
    })();
    return () => { live = false; };
  }, [id]);

  async function runDetect() {
    setDetecting(true);
    try {
      const r = await fetch(`/api/vexcel/${id}/detect`);
      const body = await r.json();
      if (r.ok) { setDetect(body); setView("detect"); } else setMessage(body.error || "Detection failed.");
    } finally { setDetecting(false); }
  }

  const views = VIEWS.filter(([v]) => v === "ortho" || parcel?.directions.includes(v));
  return <section className="card exterior">
    <h2>Exterior intelligence <span className="tag">Vexcel · live</span></h2>
    {state === "loading" && <p className="muted">Checking aerial coverage…</p>}
    {state === "off" && <div className="offline">
      <p><b>Live aerial imagery is not connected.</b> Add a rotated key to <code>.env.local</code> as <code>VEXCEL_API_KEY=…</code>, then run <code>npm run api</code> next to <code>npm run dev</code>. HavenLens then pulls the parcel outline, roof data, oblique views from four sides and open-vocabulary hazard detection for this building.</p>
    </div>}
    {state === "error" && <p className="errorBox">{message}</p>}
    {state === "ready" && parcel && <div className="extGrid">
      <div>
        <div className="chips">{views.map(([v, label]) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>)}
          {detect?.overlay && <button aria-pressed={view === "detect"} onClick={() => setView("detect")}>Scan results</button>}</div>
        <div className="imgFrame">
          <img key={view} src={view === "detect" ? detect!.overlay! : `/api/vexcel/${id}/${view}.jpg`} alt={`Vexcel ${view} image of the parcel`} />
        </div>
        <p className="fine">Gold outline = {parcel.isFallbackArea ? "90 m area around the address (no parcel found)" : "parcel boundary"}. Imagery {parcel.collection ?? "collection unreported"}{parcel.obliqueCaptured ? `, obliques captured ${parcel.obliqueCaptured.slice(0, 10)}` : ""}. Historical imagery, not live conditions.</p>
      </div>
      <div>
        <dl className="mini">
          <div><dt>Structures on parcel</dt><dd>{parcel.structureCount ?? "—"}</dd></div>
          <div><dt>Footprint</dt><dd>{parcel.footprintSqft ? parcel.footprintSqft.toLocaleString() + " sq ft" : "—"}</dd></div>
          <div><dt>Roof</dt><dd>{[parcel.roofMaterial, parcel.roofShape].filter(Boolean).join(" · ") || "—"}</dd></div>
          <div className={parcel.roofCondition != null && parcel.roofCondition <= 2 ? "alert" : ""}><dt>Roof condition</dt><dd>{parcel.roofCondition != null ? parcel.roofCondition + " / 5" : "—"}</dd></div>
          <div><dt>Tree cover</dt><dd>{parcel.treeCoverPercent != null ? parcel.treeCoverPercent + "%" : "—"}</dd></div>
          <div><dt>Pool</dt><dd>{parcel.pool == null ? "—" : parcel.pool ? "Detected" : "None"}</dd></div>
        </dl>
        {Object.keys(parcel.roofObjects).length > 0 && <p className="roofObj"><b>On the roof:</b> {Object.entries(parcel.roofObjects).map(([k, v]) => `${v} ${k}`).join(", ")}</p>}
        <button className="primary" onClick={runDetect} disabled={detecting}>{detecting ? "Scanning imagery…" : detect ? "Re-run exterior scan" : "Scan exterior: hazards and resources"}</button>
        {detect && (detect.found.length ? (["Hazards", "Resources", "Obstacles"] as const).map(g => {
          const items = detect.found.filter(f => (KIND[f.label]?.group ?? "Hazards") === g);
          if (!items.length) return null;
          return <div key={g} className={"scanGroup " + GROUP_TONE[g]}>
            <h4>{g}</h4>
            <ul className="hazards">{items.map(f => <li key={f.label}><i style={{ background: f.color }} /><span><b>{f.count} × {f.label}</b><small className="why">{KIND[f.label]?.why}</small></span><small>best {Math.round(f.best * 100)}%</small></li>)}</ul>
          </div>;
        }) : <p className="muted">None of the listed objects were found.</p>)}
        {detect && <p className="fine">Searched for: {detect.labels.join(", ")}. Model {detect.model}. Confidence is a model score, not confirmation.</p>}
        {message && state === "ready" && <p className="errorBox">{message}</p>}
      </div>
    </div>}
    {state === "ready" && parcel && <div className="extMore">
      <div>
        <h3 className="subhead">Rooftop</h3>
        <ul className="roofNotes">{roofNotes(parcel).map(n => <li key={n.text} className={n.tone}>{n.text}</li>)}</ul>
        <p className="fine">Read from aerial roof attributes. Not a structural assessment.</p>
      </div>
      <div>
        <h3 className="subhead">Staging candidates</h3>
        {!staging ? <>
          <p className="muted">Search the aerial imagery within about 350 m for open paved lots where engines and ambulances could stage.</p>
          <button onClick={findStaging} disabled={searching}>{searching ? "Searching imagery…" : "Find staging areas"}</button>
        </> : <>
          <div className="staging">{staging.candidates.map((c, i) => <figure key={i}>
            {c.image && <img src={c.image} alt={`Candidate staging area ${i + 1}, ${c.dist} m ${c.dir}`} />}
            <figcaption><b>{c.dist} m {c.dir}</b><a href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=19/${c.lat}/${c.lon}`} target="_blank" rel="noreferrer">Map ↗</a></figcaption>
          </figure>)}</div>
          <p className="fine">Found by Vexcel semantic image search for &ldquo;{staging.query}&rdquo;. Candidates only: check ownership, access and current use on site.</p>
        </>}
      </div>
    </div>}
  </section>;
}
