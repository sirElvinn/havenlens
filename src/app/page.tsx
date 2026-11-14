"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Building = dynamic(() => import("../components/Building"), {
  ssr:false, loading: () => <p className="fallback">Preparing model…</p>
});
const floors = [6,5,4,3,2,1];

export default function Home() {
  const [floor, setFloor] = useState(6);
  const [view, setView] = useState(0);
  return <main>
    <header><strong><span aria-hidden="true" className="logo">◈</span> HavenLens</strong><span>Scenario studio</span></header>
    <section className="intro"><small>TRAINING WORKSPACE</small><h1>Building explorer</h1><p>Synthetic training model · Not operational guidance</p></section>
    <div className="workspace"><section className="panel" aria-label="Building viewer">
      <div className="bar"><h2>Building model</h2><button onClick={()=>setView(v=>v+1)}>Reset camera</button></div>
      <div className="stage"><Building selected={floor} select={setFloor} view={view}/><span className="location">LEVEL 0{floor} SELECTED</span></div>
      <div className="hint">Drag to orbit · Scroll or pinch to zoom · Right-drag to pan</div>
    </section><aside className="panel">
      <div className="bar"><h2>Floor inspector</h2></div>
      <div className="inside"><small>SELECT A LEVEL</small><div className="floors">{floors.map(n=><button key={n} aria-pressed={floor===n} onClick={()=>setFloor(n)}><b>0{n}</b> Floor {n}<span aria-hidden="true">{n===floor?"●":"○"}</span></button>)}</div></div>
    </aside></div>
  </main>;
}
