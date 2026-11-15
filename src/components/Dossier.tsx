"use client";

import HavenMark from "./HavenMark";
import { useCallback, useEffect, useRef, useState } from "react";
import BuildingStory from "./BuildingStory";
import SiteHeader from "./SiteHeader";
import ExteriorPanel from "./ExteriorPanel";
import Placard from "./Placard";
import EvacuationTwin from "./EvacuationTwin";
import Num from "./Num";
import EvacuationPanel from "./EvacuationPanel";
import { EXPOSED_LABEL, exposedAt, mobilityAt, mobilityRate, parseScenario, scenarioScore, SCENARIOS, type Scenario } from "../lib/scenario";
import { fmt, hourLabel, loadDossier, peopleAt, PROFILES, SLEEPING, writeBrief, type Dossier as D } from "../lib/dossier";
import { applyReport, useReports } from "../lib/reports";
import "./dossier.css";

export default function Dossier() {
  const [raw, setD] = useState<D | null | undefined>(undefined);
  const reports = useReports();
  const [fireFloorParam, setFireFloorParam] = useState<number | null>(null);
  const [hour, setHour] = useState(() => new Date().getHours());
  const [model,setModel] = useState(0);
  const [readFile,setReadFile]=useState(false);
  const [autoTour,setAutoTour] = useState(false);
  const [recordsDock,setRecordsDock] = useState<HTMLDivElement|null>(null);
  const [scenario, setScenario] = useState<Scenario>("fire");

  const [placard, setPlacard] = useState(false);
  const [twin, setTwin] = useState(false);

  const openModel = useCallback(() => setTwin(true), []);

  const fileClose = useRef<HTMLAnchorElement>(null);
  const fileLauncher = useRef<HTMLElement | null>(null);
  function openFile() {
    fileLauncher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReadFile(true);
  }
  useEffect(() => {
    if (!readFile || !raw || placard || twin) return;
    fileClose.current?.focus();
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") setReadFile(false);
    }
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [readFile, raw, placard, twin]);
  useEffect(() => {
    if (!readFile) fileLauncher.current?.focus();
  }, [readFile]);

  function pickScenario(s: Scenario) {
    setScenario(s);
    const url = new URL(window.location.href);
    if (s === "fire") url.searchParams.delete("s"); else url.searchParams.set("s", s);
    window.history.replaceState(window.history.state, "", url);
  }

  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    setScenario(parseScenario(params.get("s")));
    if (!location.hash || location.hash === "#records") setReadFile(true);
    const h = Number(params.get("h"));
    if (params.has("h") && Number.isInteger(h) && h >= 0 && h < 24) setHour(h);
    if(params.get("twin")==="1" || params.get("placard")==="1") setReadFile(true);
    const id = Number(params.get("id"));
    // Deep links from the Incident Commander: open the placard or the 3D model at the reported floor.
    if (params.get("placard") === "1") setPlacard(true);
    if (params.get("twin") === "1") setTwin(true);
    const ff = Number(params.get("ff"));
    if (Number.isInteger(ff) && ff > 0) setFireFloorParam(ff);
    if (!Number.isInteger(id) || id <= 0) { setD(null); return; }
    loadDossier(id).then(x => { setD(x); if (x) document.title = `${x.name} · HavenLens dossier`; }).catch(() => setD(null));
  }, []);

  if (raw === undefined) return <main className="hl" aria-busy="true"><SiteHeader active="building" />
    <div className="skel" aria-label="Loading dossier"><i style={{ ["--w" as string]: "180px", ["--h" as string]: "12px" }} /><i style={{ ["--w" as string]: "min(520px,80%)", ["--h" as string]: "46px" }} /><i style={{ ["--w" as string]: "300px" }} />
      <div className="grid2"><i style={{ ["--h" as string]: "260px" }} /><i style={{ ["--h" as string]: "260px" }} /></div><i style={{ ["--h" as string]: "120px" }} /></div></main>;
  if (raw === null) return <main className="hl"><SiteHeader active="building" /><p className="errorBox">That building is not in the dossier set. <a href="/">Back to the map</a></p></main>;

  // A field report (sprinklers confirmed or not) replaces the unknown, live, without touching the CoStar record.
  const d = applyReport(raw, reports[raw.id]);
  const fieldReport = reports[raw.id]?.sprinklers;
  const brief = writeBrief(d);
  const sc = scenarioScore(d, scenario, hour);
  const meta = SCENARIOS[scenario];
  const color = `var(--signal-${scenario})`;
  const mobility = mobilityAt(d, hour), mobilityPeak = Math.round((d.people ?? 0) * mobilityRate(d));
  const exposed = exposedAt(d, scenario, hour);
  if (d.people) brief.estimated.push(`About ${mobilityPeak.toLocaleString()} people at the busiest hour may need help to evacuate (${Math.round(mobilityRate(d) * 100)}% planning rate${d.flags.includes("senior") ? " for senior housing" : d.flags.includes("healthcare") ? " for healthcare" : ""}).`);
  if (exposed) brief.estimated.push(`${meta.label}: about ${exposed.toLocaleString()} people ${EXPOSED_LABEL[scenario]} at ${hourLabel(hour)}.`);
  const factors = sc.factors ?? [];
  const maxFloor = Math.max(1, ...d.floors.map(f => f.sqft || f.occupiedSqft || 0));
  const curve = PROFILES[d.class];

  return <main className="hl dossierPage" style={{["--scenario" as string]:color}}>
    <div inert={readFile && !twin}><BuildingStory recordsDock={readFile && !twin ? recordsDock : null} scenario={scenario} d={d} hour={hour} setHour={setHour} openModel={openModel} openFile={()=>{setTwin(false);openFile();}} modelOpen={twin} leaveModel={()=>{setTwin(false);setReadFile(false);}}>
      {twin && <EvacuationTwin key={scenario} onScenarioChange={pickScenario} d={d} scenario={scenario} hour={hour} initialFireFloor={fireFloorParam} onClose={() => setTwin(false)} />}
    </BuildingStory></div>
    {placard && <Placard d={d} scenario={scenario} score={sc.score} tier={sc.tier} factors={factors} mobility={mobilityPeak} onClose={() => setPlacard(false)} />}
    {readFile && <div className="fileBackdrop" aria-hidden="true" onClick={()=>setReadFile(false)}/>}
    <div hidden={!readFile} inert={placard || twin} className="fullRecord" role="dialog" aria-modal="true" aria-label="Building file">
    {readFile && <div className="originalScroll"><div className="originalDossier">
      <header className="siteHead"><a className="brandLink" href="/"><HavenMark/>HavenLens</a>
        <nav aria-label="Dossier navigation"><a ref={fileClose} href="/">Map</a><a href="/method">How we estimate</a></nav></header>
    <div className="crumbs"><a href={scenario === "fire" ? "/" : `/?s=${scenario}`}>← All buildings</a>
      <div className="chips"><button className="primary" onClick={() => setTwin(true)}>3D evacuation model</button><button onClick={() => setPlacard(true)}>Door placard</button><a className="btnLink" href={`/verify?id=${d.id}&s=${scenario}`} target="_blank" rel="noreferrer">Field verification ↗</a><button onClick={() => window.print()}>Print pre-plan sheet</button></div></div>
    <div className="scenarioPick dScenario" role="radiogroup" aria-label="Hazard scenario">
      {(Object.keys(SCENARIOS) as Scenario[]).map(k => <button key={k} role="radio" aria-checked={scenario === k} className={scenario === k ? "on" : ""} style={{ ["--c" as string]: `var(--signal-${k})` }} onClick={() => pickScenario(k)}><i />{SCENARIOS[k].label}</button>)}
    </div>

    <section className="dHead">
      <div className="dTitle">
        <div className="eyebrow">{d.type.toUpperCase()}{d.subtype ? " · " + d.subtype.toUpperCase() : ""} · COSTAR #{d.id}</div>
        <h1>{d.name}</h1>
        <p className="addr">{d.street}, {d.city}, {d.state} {d.zip}</p>
      </div>
      <div className="gauge" style={{ ["--c" as string]: "var(--scenario)", ["--p" as string]: sc.score }}>
        <div><b><Num value={sc.score} /></b><span>{sc.tier} {meta.verb} priority</span></div>
      </div>
      <div className="confidence">
        <span>Data confidence</span>
        <div className="confBar"><i style={{ width: d.confidence + "%" }} /></div>
        <small>{d.confidence}% of six key life-safety fields are on record</small>
      </div>
    </section>

    <section className="grid2">
      <article className="card brief">
        <h2>Responder brief <span className="tag">auto-generated from records</span></h2>
        <h3 className="k rec">Recorded</h3><ul>{brief.recorded.map(s => <li key={s}>{s}</li>)}</ul>
        <h3 className="k est">Estimated</h3><ul>{brief.estimated.map(s => <li key={s}>{s}</li>)}</ul>
        <h3 className="k unk">Unknown: verify on site</h3><ul className="unknowns">{brief.unknown.map(s => <li key={s}>{s}</li>)}</ul>
      </article>
      <article className="card">
        <h2>Why it scores {sc.score} for {meta.verb}</h2>
        {factors.length ? <ul className="factors">{factors.map(f => <li key={f.label} className={f.kind}>
          <b>+{f.points}</b><div><strong>{f.label}</strong><small>{f.detail}</small></div></li>)}</ul> : <p className="muted">No elevated factors on record.</p>}
        <p className="fine">Transparent triage points for pre-incident planning. Gaps (dashed) add points because unknowns need a site visit. This is not a code inspection or a risk rating. <a href="/method">How we score</a>.</p>
      </article>
    </section>

    <dl className="facts card">
      {[
        ["Stories", fmt(d.stories)], ["Height", fmt(d.heightFeet, " ft")], ["Construction", d.material],
        ["Sprinklers", d.sprinklers === null ? null : (d.sprinklers ? "Yes" + (d.sprinklerType ? ` · ${d.sprinklerType}` : "") : "None recorded") + (fieldReport ? " · field report" : "")],
        ["Built", d.built ? String(d.built) : null], ["Renovated", d.renovated ? String(d.renovated) : null],
        ["Gross area", fmt(d.grossSqft, " sq ft")], ["Typical floor", fmt(d.typicalFloorSqft, " sq ft")],
        ["Elevators", fmt(d.elevators)], ["Parking spaces", fmt(d.parkingSpaces)], ["Lot", d.lotAcres ? d.lotAcres + " acres" : null],
        ["Class", d.buildingClass],
      ].map(([k, v]) => <div key={k as string} className={v ? "" : "missing"}><dt>{k}</dt><dd>{v ?? "Not on record"}</dd></div>)}
    </dl>

    <section className="grid2">
      <article className="card">
        <h2>Who&apos;s inside, hour by hour</h2>
        <p className="big"><Num value={peopleAt(d, hour)} /> <span>people at {hourLabel(hour)} (est.)</span></p>
        <div className="mobRow">
          <div><b>~<Num value={mobility} /></b><span>may need help evacuating</span></div>
          {exposed > 0 && <div style={{ ["--acc" as string]: "var(--scenario)" }}><b>{exposed.toLocaleString()}</b><span>{EXPOSED_LABEL[scenario]}</span></div>}
        </div>
        <div className="spark" role="group" aria-label="Estimated occupancy by hour. Choose an hour.">
          {curve.map((v, h) => <button key={h} className={h === hour ? "on" : ""} style={{ height: Math.max(4, v * 100) + "%" }} onClick={() => setHour(h)} aria-label={`${hourLabel(h)}: ${peopleAt(d, h)} people`} title={`${hourLabel(h)} · ${peopleAt(d, h).toLocaleString()}`} />)}
        </div>
        <div className="ticks"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
        <p className="fine">Busiest hour: {fmt(d.people) ?? "unknown"} people{d.peopleBasis ? ` (${d.peopleBasis})` : ""}. Hourly shape: typical {d.class} profile.{d.designLoad ? ` Code design occupant load is ${d.designLoad.toLocaleString()}.` : ""}{SLEEPING.includes(d.class) ? " Sleeping occupancy: expect delayed self-evacuation at night." : ""}</p>
      </article>
      {d.apartment ? <article className="card">
        <h2>Residents</h2>
        <dl className="mini">
          <div><dt>Units</dt><dd>{fmt(d.apartment.units) ?? "—"}</dd></div>
          <div><dt>Buildings</dt><dd>{fmt(d.apartment.buildings) ?? "—"}</dd></div>
          <div><dt>Style</dt><dd>{d.apartment.style ?? "—"}</dd></div>
          <div><dt>Vacancy</dt><dd>{d.apartment.vacancyPercent != null ? d.apartment.vacancyPercent + "%" : "—"}</dd></div>
          <div className={d.apartment.lifestyle === "Senior" ? "alert" : ""}><dt>Community</dt><dd>{d.apartment.lifestyle ?? "—"}</dd></div>
          <div className={d.apartment.walkup ? "alert" : ""}><dt>Walk-up</dt><dd>{d.apartment.walkup == null ? "—" : d.apartment.walkup ? "Yes, no elevator" : "No"}</dd></div>
          <div><dt>Affordable units</dt><dd>{fmt(d.apartment.affordableUnits) ?? "—"}</dd></div>
          <div><dt>Pets allowed</dt><dd>{d.apartment.pets.length ? d.apartment.pets.join(", ") : "—"}</dd></div>
        </dl>
      </article> : d.hotel ? <article className="card"><h2>Guests</h2><dl className="mini">
        <div><dt>Rooms</dt><dd>{fmt(d.hotel.rooms) ?? "—"}</dd></div><div><dt>Brand</dt><dd>{d.hotel.brand ?? "—"}</dd></div><div><dt>Pools</dt><dd>{fmt(d.hotel.pools) ?? "—"}</dd></div>
      </dl></article> : <article className="card">
        <h2>Tenants on file</h2>
        <p className="big">{d.tenantCount} <span>current tenancies · {fmt(d.headcount) ?? "no"} recorded employees</span></p>
        <ul className="tenants">{d.tenants.slice(0, 8).map((t, i) => <li key={i}><b>{t.name}</b><small>{[t.industry, t.employees ? t.employees + " staff" : null, t.sqft ? t.sqft.toLocaleString() + " sq ft" : null, t.floors.join(", ")].filter(Boolean).join(" · ")}</small></li>)}</ul>
      </article>}
    </section>

    {d.floors.length > 0 && <section className="card">
      <h2>Floor stack <span className="tag">{d.floors.length} floor records</span></h2>
      <div className="stack">{d.floors.map(f => <div key={f.name} className="floor">
        <span className="fname">{f.name}</span>
        <span className="fbar"><i style={{ width: ((f.sqft || f.occupiedSqft) / maxFloor) * 100 + "%" }} /><em style={{ width: (f.occupiedSqft / maxFloor) * 100 + "%" }} /></span>
        <span className="fmeta">{f.sqft ? f.sqft.toLocaleString() + " sq ft" : "size n/a"}{f.tenants ? ` · ${f.tenants} tenant${f.tenants > 1 ? "s" : ""}` : ""}{f.employees ? ` · ${f.employees} staff` : ""}</span>
      </div>)}</div>
      <p className="fine">Bright segment = space occupied by current tenants. {d.floorRecordsNote}</p>
    </section>}

    <EvacuationPanel d={d} hour={hour} scenario={scenario} onOpen3D={() => setTwin(true)} />

    <ExteriorPanel id={d.id} />

    {d.models.length > 0 && <section className="card tour">
      <h2>Matterport walkthrough <span className="tag">{d.modelCount} scan{d.modelCount > 1 ? "s" : ""} linked</span></h2>
      <div className="cardHead tourBar">
        {d.models.length > 1 ? <div className="chips">{d.models.map((m, i) => <button key={m} aria-pressed={i === model} onClick={() => setModel(i)}>Scan {i + 1}</button>)}</div> : <span />}
        <div className="chips" role="group" aria-label="Tour mode">
          <button aria-pressed={!autoTour} onClick={() => setAutoTour(false)}>Explore</button>
          <button aria-pressed={autoTour} onClick={() => setAutoTour(true)}>Auto tour</button>
        </div>
      </div>
      <iframe key={d.models[model] + autoTour} title={`${d.name} Matterport tour`} src={`https://my.matterport.com/show/?m=${d.models[model]}&play=1&qs=1${autoTour ? "&ts=1&lp=1&hr=1" : ""}`} allow="fullscreen; xr-spatial-tracking" allowFullScreen />
      <p className="fine">Auto tour plays the scan's guided highlights on a loop, where the owner set them up. Use the dollhouse button in the viewer to see the whole capture in 3D. A linked scan may cover one suite or unit, not the whole building.</p>
    </section>}

    {d.photos.length > 0 && <section className="card">
      <h2>Photos <span className="tag">CoStar</span></h2>
      <div className="photos">{d.photos.map(p => <a key={p} href={p.replace("/113/", "/116/")} target="_blank" rel="noreferrer"><img src={p} alt={`${d.name} photo`} loading="lazy" /></a>)}</div>
    </section>}

    <section className="card market">
      <h2>Property context</h2>
      <dl className="mini">
        <div><dt>Last sale</dt><dd>{d.sales[0]?.date ? `${d.sales[0].date}${d.sales[0].price ? " · $" + d.sales[0].price.toLocaleString() : ""}` : "None on file"}</dd></div>
        <div><dt>Sales on file</dt><dd>{d.saleCount}</dd></div>
        <div><dt>Active listings</dt><dd>{d.listings ? `${d.listings.active}${d.listings.availableSqft ? " · " + d.listings.availableSqft.toLocaleString() + " sq ft available" : ""}` : "0"}</dd></div>
        <div><dt>Tenancy records</dt><dd>{d.tenancyHistory} total · {d.tenantCount} current</dd></div>
      </dl>
      <p className="fine">Vacant or for-lease space can mean unoccupied floors, ongoing build-outs or construction hazards.</p>
    </section>

    <footer className="foot">Sources: CoStar offline data kit (records as supplied) · Vexcel API 2.0 (live, server-side) · Matterport. Estimates and scores are planning aids, not live data. Verify everything on site before you rely on it.</footer>

    </div></div>}<div className="recordDock" ref={setRecordsDock}/></div>
  </main>;
}
