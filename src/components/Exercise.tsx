"use client";

import { useEffect, useState } from "react";

import type { Brief } from "./Briefing";

const baseEvents = [
  { title: "The initial report", report: "A caller reports a smell of smoke somewhere in the space. The exact location is unknown.", prompt: "What did the caller report, and what can you actually see in the scan?" },
  { title: "A second account", report: "A second caller remembers a haze earlier in the day. Neither caller can confirm when the first report was made.", prompt: "Which details agree? What would you ask to clarify the timing?" },
  { title: "The handoff", report: "A colleague joins the exercise and asks for a short briefing on what your team knows.", prompt: "Summarize one observation, one reported detail and one unresolved question." }
];

type Session = { step: number; notes: string[] };
const fresh = (): Session => ({step:-1, notes:baseEvents.map(() => "")});
function readSession(key: string): Session {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "null");
    if (data && Number.isInteger(data.step) && data.step >= -1 && data.step <= baseEvents.length &&
      Array.isArray(data.notes) && data.notes.length === baseEvents.length && data.notes.every((n: unknown) => typeof n === "string")) return data;
  } catch {}
  return fresh();
}

export default function Exercise({ id, title, brief }: {id:string; title:string; brief?:Brief}) {
  const events = baseEvents.map((event,i) => i === 2 && brief ? {...event, prompt: brief.question+" Include one open question in your handoff."} : event);
  const storageKey = "havenlens.tabletop.v1."+id;
  const [session, setSession] = useState<Session>(fresh);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
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
  return <aside className="drill" aria-label="Tabletop exercise">
    <div className="drillCap"><span className="pip"/> TABLETOP EXERCISE</div>
    <h2>Smoke report</h2>
    <p className="drillSub">Facilitated discussion · 3 events</p>
    <div className="progressLine" aria-label={step<0?"Exercise ready":step===3?"Exercise complete":"Event "+(step+1)+" of 3"}>{events.map((event,i)=><i key={event.title} className={step>=i?"filled":""}/>)}</div>
    {step===-1 ? <>
      <h3>Before you begin</h3>
      <p>Explore the captured space together. One person reads each fictional report aloud. The other records observations and open questions.</p>
      <ol className="agenda">{events.map((event,i)=><li key={event.title}><span>0{i+1}</span>{event.title}</li>)}</ol>
      <button className="action" disabled={!ready} onClick={()=>advance(0)}>Begin exercise <span>→</span></button>
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
