"use client";

import { useEffect, useState } from "react";
import SiteHeader from "./SiteHeader";
import { hourLabel, loadIndex, PROFILES, type BuildingRow, type OccupancyClass } from "../lib/dossier";
import { MOBILITY_RATE, SCENARIOS } from "../lib/scenario";
import "./dossier.css";

const CLASS_LABEL: Record<OccupancyClass, string> = {
  residential: "Residential", hotel: "Hotel", office: "Office", retail: "Retail", industrial: "Industrial", healthcare: "Healthcare",
};

const SCORING: { scenario: keyof typeof SCENARIOS; rows: [string, string][] }[] = [
  { scenario: "fire", rows: [
    ["High-rise (7+ stories or 75+ ft)", "+25"], ["Mid-rise (4–6 stories)", "+12"], ["No sprinklers recorded", "+20"], ["Sprinkler status unknown", "+10 (gap)"],
    ["Wood-frame construction", "+12"], ["Construction unknown", "+4 (gap)"], ["Built before 1975", "+10"], ["Year built unknown", "+3 (gap)"],
    ["Sleeping occupancy (apartments, hotels): scaled by share asleep at the hour and by size", "up to +15"], ["Senior housing", "+15"], ["Healthcare", "+15"],
    ["1,000+ people at busiest hour", "+12"], ["250+ people", "+6"], ["Walk-up, 3+ stories", "+5"],
  ] },
  { scenario: "flood", rows: [
    ["Below-grade levels on record (basement, lower level, concourse)", "+25"], ["Ground-floor residents (garden, low-rise, townhome, ≤3 stories)", "+20"],
    ["Senior housing or healthcare", "+20"], ["No upper-floor refuge (≤2 stories)", "+12"], ["Structured parking on record", "+10"],
    ["Sleeping occupancy, by hour and size", "up to +10"], ["Story count unknown", "+4 (gap)"], ["1,000+ / 250+ people", "+12 / +6"],
  ] },
  { scenario: "blackout", rows: [
    ["High-rise: elevators stop, stairs only", "+30"], ["Senior housing or healthcare (powered medical devices)", "+25"],
    ["Mid-rise (4–6 stories)", "+15"], ["Sleeping occupancy, by hour and size", "up to +8"], ["Built before 1975 (emergency power may predate code)", "+5 (gap)"],
    ["1,000+ / 250+ people", "+12 / +6"],
  ] },
];

export default function Method() {
  const [rows, setRows] = useState<BuildingRow[]>([]);
  useEffect(() => { loadIndex().then(d => setRows(d.buildings)).catch(() => {}); }, []);
  const n = rows.length || 1;
  const pct = (k: number) => rows.length ? Math.round(100 * k / n) + "%" : "…";
  const coverage: [string, string][] = [
    ["Story count", pct(rows.filter(b => b.stories != null).length)],
    ["Sprinkler status", pct(rows.filter(b => b.sprinklers != null).length)],
    ["Building height", pct(rows.filter(b => b.heightFt != null).length)],
    ["Elevator count", pct(rows.filter(b => b.elev != null).length)],
    ["People estimate", pct(rows.filter(b => b.people != null).length)],
  ];

  return <main className="hl method">
    <SiteHeader active="method" />
    <section className="hero">
      <div>
        <div className="eyebrow"><i className="dot" /> Methodology</div>
        <h1>How we estimate</h1>
        <p className="lede">Every number in HavenLens is either a CoStar record, a Vexcel measurement, or an estimate built from one with a stated assumption. This page lists the assumptions so anyone can check them.</p>
      </div>
    </section>

    <section className="card">
      <h2>Where the data comes from</h2>
      <dl className="mini">
        <div><dt>CoStar data kit</dt><dd>3,339 buildings, 74k tenancies, 49k companies, apartment and hotel records. Offline, as supplied.</dd></div>
        <div><dt>Vexcel API 2.0</dt><dd>Live: parcels, roof attributes, aerial and oblique imagery, object detection, semantic search.</dd></div>
        <div><dt>Matterport</dt><dd>Interior scans linked by CoStar model IDs.</dd></div>
        <div><dt>Never used</dt><dd>Contact names, emails or phone numbers. Nothing is invented to fill a gap.</dd></div>
      </dl>
    </section>

    <section className="card">
      <h2>What CoStar records cover <span className="tag">share of {rows.length.toLocaleString() || "3,339"} buildings</span></h2>
      <div className="coverage">{coverage.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span><i style={{ width: v.endsWith("%") ? v : "0%" }} /></div>)}</div>
      <p className="fine">Missing values are shown as unknown and add &ldquo;gap&rdquo; points, because an unknown needs a site visit. Sprinkler status is the biggest gap, and the most valuable one for fire departments.</p>
    </section>

    <section className="grid2">
      <article className="card">
        <h2>People at the busiest hour</h2>
        <ul className="formula">
          <li><b>Apartments</b><span>units × 2.5 residents (US average household) × (1 − recorded vacancy, or 7%)</span></li>
          <li><b>Hotels</b><span>rooms × 2 guests × 70% occupancy</span></li>
          <li><b>Offices and other commercial</b><span>sum of recorded employee counts of current tenants; if none, 35% of the code design load (floor area ÷ IBC occupant-load factor)</span></li>
        </ul>
      </article>
      <article className="card">
        <h2>People who may need help to evacuate</h2>
        <ul className="formula">
          <li><b>{Math.round(MOBILITY_RATE.general * 100)}%</b><span>of people inside: national share of adults with serious difficulty walking or climbing stairs (CDC disability survey)</span></li>
          <li><b>{Math.round(MOBILITY_RATE.senior * 100)}%</b><span>in senior housing (planning assumption, higher mobility-disability rates among older adults)</span></li>
          <li><b>{Math.round(MOBILITY_RATE.healthcare * 100)}%</b><span>in healthcare buildings (planning assumption: patients may be non-ambulatory)</span></li>
        </ul>
        <p className="fine">These are planning rates applied to estimated occupancy. They are not counts of real people.</p>
      </article>
    </section>

    <section className="card">
      <h2>Who is inside, hour by hour</h2>
      <p className="muted">The busiest-hour estimate is scaled by a typical occupancy profile for each building class.</p>
      <div className="profiles">{(Object.keys(PROFILES) as OccupancyClass[]).map(k => <figure key={k}>
        <div className="spark small" role="img" aria-label={`${CLASS_LABEL[k]} occupancy profile`}>{PROFILES[k].map((v, h) => <i key={h} style={{ height: Math.max(3, v * 100) + "%" }} title={`${hourLabel(h)} · ${Math.round(v * 100)}%`} />)}</div>
        <figcaption>{CLASS_LABEL[k]}</figcaption>
      </figure>)}</div>
      <div className="ticks"><span>12 AM</span><span>12 PM</span><span>11 PM</span></div>
    </section>

    <section className="card">
      <h2>Priority scores by hazard</h2>
      <p className="muted">Points add up to a 0–100 score. 55 and above is High, 35–54 Elevated, below 35 Standard. Every dossier lists the factors behind its score.</p>
      <div className="scoring">{SCORING.map(({ scenario, rows }) => <div key={scenario} style={{ ["--c" as string]: SCENARIOS[scenario].accent }}>
        <h3><i />{SCENARIOS[scenario].label}</h3>
        <table><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
      </div>)}</div>
    </section>

    <section className="grid2">
      <article className="card">
        <h2>Sleeping occupancy changes with the hour</h2>
        <p className="muted">Residents are counted as likely asleep at 90% from 11 PM to 5 AM, 60% at 10 PM and 6 AM, 30% at 7 AM and 8% during the day. Points scale with that share and with building size (full points at 1,000+ people, at least a third for small buildings). A large apartment tower gets the full +15 fire points at 3 AM and about +1 at 2 PM, so the map&apos;s priorities change as you move the clock.</p>
      </article>
      <article className="card">
        <h2>Where people go</h2>
        <ul className="limits">
          <li><b>Fire and blackout:</b> the best-matching open paved lot within about 350 m, outside the collapse zone (1.5 × building height), found with Vexcel semantic image search; walking route from OpenStreetMap.</li>
          <li><b>Flood, 2+ stories:</b> no outdoor assembly. Nearby lots are usually low and flood first, so the ground floor moves up to Floor 2 and upper floors shelter in place.</li>
          <li><b>Flood, single story:</b> leave early; the nearest open lot is shown with a warning that its elevation is not verified.</li>
          <li><b>Multi-building properties:</b> every sizeable structure Vexcel traced on the parcel, up to the number of buildings CoStar records, is modelled at full height with its own stairs and residents (split by footprint).</li>
        </ul>
      </article>
    </section>

    <section className="card">
      <h2>Exterior scan: hazards, resources, obstacles</h2>
      <p className="muted">Vexcel&apos;s open-vocabulary detector looks for six objects. They are grouped by what they mean to a crew: <b>hazards</b> (solar panels stay energized when the grid is cut; scaffolding; heavy rooftop equipment), <b>resources</b> (hydrants; pools as a static water source engines can draft from) and <b>obstacles</b> (parked cars blocking apparatus and ladder positions).</p>
    </section>

    <section className="card">
      <h2>What HavenLens does not know</h2>
      <ul className="limits">
        <li>Stair, exit, standpipe and corridor locations. No supplied dataset includes them, so HavenLens never draws evacuation routes.</li>
        <li>Who is actually inside right now. All occupancy is estimated, never tracked.</li>
        <li>Current flood depth or fire behavior. Scenarios re-weight building facts. They do not simulate the hazard.</li>
        <li>Whether a Matterport scan covers the whole building. Many cover one suite or unit.</li>
      </ul>
    </section>
    <footer className="foot">HavenLens is a pre-planning aid. It does not replace a site walk, the building&apos;s fire plan or a qualified inspection.</footer>
  </main>;
}
