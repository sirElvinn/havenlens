"use client";

import dynamic from "next/dynamic";
import { duration, phaseAt, ScenarioMarkers } from "../../components/Scenario";
import { useEffect, useRef, useState } from "react";

const Building = dynamic(() => import("../../components/Building"), {
  ssr:false, loading: () => <p className="fallback">Preparing model…</p>
});
const floors = [6,5,4,3,2,1];

export default function Home() {
  const [floor, setFloor] = useState(6);
  const [view, setView] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const offset = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const time = Math.min(duration, offset.current + (performance.now()-start)/1000);
      setSeconds(time);
      if (time === duration) setPlaying(false);
    }, 60);
    return () => window.clearInterval(timer);
  }, [playing]);

  function togglePlayback() {
    if (!playing) {
      offset.current = seconds === duration ? 0 : seconds;
      setSeconds(offset.current);
    }
    setPlaying(!playing);
  }
  function seek(time: number) {
    setPlaying(false);
    setSeconds(time);
  }

  return <main className="simulation">
    <header><strong><span aria-hidden="true" className="logo">◈</span> HavenLens</strong><a href="/">Building workspace ↗</a></header>
    <section className="intro"><small>TRAINING WORKSPACE</small><h1>Building explorer</h1><p>Synthetic training model · Not operational guidance</p></section>
    <div className="workspace"><section className="panel" aria-label="Building viewer">
      <div className="bar"><h2>Building model</h2><button onClick={()=>setView(v=>v+1)}>Reset camera</button></div>
      <div className="stage"><Building selected={floor} select={setFloor} view={view} overlays={<ScenarioMarkers seconds={seconds}/>}/><span className="location">LEVEL 0{floor} SELECTED</span></div>
      <div className="hint">Drag to orbit · Scroll or pinch to zoom · Right-drag to pan</div>
    </section><aside className="panel">
      <div className="bar"><h2>Floor inspector</h2></div>
      <div className="inside"><small>SELECT A LEVEL</small><div className="floors">{floors.map(n=><button key={n} aria-pressed={floor===n} onClick={()=>setFloor(n)}><b>0{n}</b> Floor {n}<span aria-hidden="true">{n===floor?"●":"○"}</span></button>)}</div></div>
    </aside></div>
    <section className="panel timeline">
      <div className="bar"><div><small>ILLUSTRATIVE SCENARIO</small><h2>Fire on Floor 6</h2></div><output>{Math.floor(seconds)} / {duration} s</output></div>
      <div className="inside">
        <div className="playrow"><strong>{phaseAt(seconds)}</strong><div><button className="primary" onClick={togglePlayback}>{playing?"Pause":seconds===duration?"Replay":"Play"}</button> <button onClick={()=>seek(0)}>Reset</button></div></div>
        <input type="range" aria-label="Scenario time in seconds" min="0" max={duration} step=".1" value={seconds} onChange={e=>seek(Number(e.target.value))}/>
        <p className="legend"><span>◆ Fire · 4 s</span><span>● Occupants · 10 s</span><span>■ Responder · 18 s</span></p>
      </div>
    </section>
  </main>;
}
