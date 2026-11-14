"use client";

import { useEffect, useState } from "react";

import type { Brief } from "./Briefing";

import { scenario } from "./discussion";
import TeamRoom from "./TeamRoom";

type Session = { step: number; notes: string[] };
const fresh = (): Session => ({step:-1, notes:["","",""]});
function readSession(key: string): Session {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "null");
    if (data && Number.isInteger(data.step) && data.step >= -1 && data.step <= 3 &&
      Array.isArray(data.notes) && data.notes.length === 3 && data.notes.every((n: unknown) => typeof n === "string")) return data;
  } catch {}
  return fresh();
}

export default function Exercise({ id, title, brief, coverage }: {id:string; title:string; brief?:Brief; coverage?:string}) {
  const events = scenario(title,brief,coverage);
  const [team,setTeam] = useState(false);
  const storageKey = "havenlens.tabletop.v1."+id;
  const [session, setSession] = useState<Session>(fresh);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    setTeam(window.location.hash.startsWith("#room="));
    const saved = readSession(storageKey);
    const match = /^#event-([1-3])$/.exec(window.location.hash);
    if (match) saved.step = Number(match[1])-1;
    setSession(saved);
    setReady(true);
  }, [storageKey]);

  function update(next: Session) {
    setSession(next);
    setShareUrl("");
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setMessage(""); }
    catch { setMessage("Browser storage is unavailable. Export your debrief before leaving."); }
  }
  function advance(step: number) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    update({...session, step});
  }
  async function share() {
    const link = new URL(window.location.href);
    link.searchParams.set("tour", id);
    link.hash = "event-"+(session.step+1);
    try { await navigator.clipboard.writeText(link.href); setMessage("Event link copied. Each participant keeps their own notes."); }
    catch { setShareUrl(link.href); }
  }
  function download() {
    const body = ["HavenLens · Tabletop debrief",title,...Object.entries(brief?.facts ?? {}).map(([name,value]) => name+" (CoStar): "+value),"Fictional exercise · Not operational guidance","",
      ...events.flatMap((e,i)=>[e.title,e.report,e.prompt,session.notes[i] || "(No observation recorded)",""])].join("\n");
    const url = URL.createObjectURL(new Blob([body],{type:"text/plain;charset=utf-8"}));
    const a = document.createElement("a"); a.href=url; a.download="havenlens-debrief.txt"; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const {step,notes} = session;
  const e = events[step];
  if (team) return <TeamRoom tour={id} title={title} events={events} leave={()=>setTeam(false)}/>;
  return <aside className="drill" aria-label="Tabletop exercise">
    <div className="drillCap"><span className="pip"/> TABLETOP EXERCISE</div>
    <h2>Smoke report</h2>
    <p className="drillSub">Facilitated discussion · 3 events</p>
    <div className="progressLine" aria-label={step<0?"Exercise ready":step===3?"Exercise complete":"Event "+(step+1)+" of 3"}>{events.map((event,i)=><i key={event.title} className={step>=i?"filled":""}/>)}</div>
    {step===-1 ? <>
      <h3>Before you begin</h3>
      <p>Explore the captured space together. One person reads each fictional report aloud. The other records observations and open questions.</p>
      <ol className="agenda">{events.map((event,i)=><li key={event.title}><span>0{i+1}</span>{event.title}</li>)}</ol>
      <button className="action" disabled={!ready} onClick={()=>advance(0)}>Begin solo exercise <span>→</span></button>
      <button className="action teamStart" onClick={()=>setTeam(true)}>Start a team session <span>↗</span></button>
    </> : e ? <>
      <div className="mono">EVENT 0{step+1} / 03</div><h3>{e.title}</h3><p>{e.report}</p>
      <label className="question">{e.prompt}<textarea maxLength={4000} value={notes[step]} placeholder="Record your discussion…" onChange={ev=>update({...session,notes:notes.map((n,i)=>i===step?ev.target.value:n)})}/></label>
      <button className="action" onClick={()=>advance(step+1)}>{step===2?"Review debrief":"Next event"} <span>→</span></button>
      <div className="drillLinks"><button onClick={()=>advance(step-1)}>Back</button><button onClick={share}>Share this event ↗</button></div>
    </> : <>
      <div className="mono">AFTER THE EXERCISE</div><h3>Team debrief</h3>
      <ol className="review">{events.map((ev,i)=><li key={ev.title}><strong>{ev.title}</strong><p>{notes[i]||"No observation recorded."}</p></li>)}</ol>
      <button className="action" onClick={download}>Download debrief <span>↓</span></button><div className="drillLinks"><button onClick={()=>advance(2)}>Edit responses</button></div>
    </>}
    {shareUrl && <label>Copy event link<input readOnly value={shareUrl} onFocus={ev=>ev.target.select()}/></label>}
    <div role="status">{message}</div>
    <footer>Fictional scenario · Not operational guidance<br/>Notes stay in this browser.</footer>
  </aside>;
}
