"use client";
import {useEffect,useRef,useState} from "react";
type Event={title:string;report:string;prompt:string};
type Room={tour:string;step:number;revision:number;notes:{id:string;step:number;text:string}[]};
async function api(path:string,body?:unknown,host?:string) {
  const response=await fetch("/api/rooms"+path,{method:body?"POST":"GET",cache:"no-store",headers:{"Content-Type":"application/json",...(host?{Authorization:"Bearer "+host}:{})},body:body?JSON.stringify(body):undefined});
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Shared sessions require the hosted workspace.");
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || "Session request failed.");
  return data;
}
export default function TeamRoom({tour,title,events,leave}:{tour:string;title:string;events:Event[];leave:()=>void}) {
  const [id,setId]=useState(()=>new URLSearchParams(location.hash.slice(1)).get("room") || "");
  const [host,setHost]=useState(()=>sessionStorage.getItem("havenlens.host."+id) || "");
  const [state,setState]=useState<Room|null>(null);
  const [draft,setDraft]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const noteId=useRef("");
  function accept(next:Room){setState(prev=>prev && prev.revision>next.revision?prev:next);}
  useEffect(()=>{
    if(!id) return;
    let alive=true;
    async function poll(){
      try{const next=await api("/"+id); if(next.tour!==tour) throw new Error("Open the original invitation for this capture."); if(alive) accept(next);}
      catch(e){if(alive)setError((e as Error).message);}
    }
    poll();const timer=setInterval(poll,2000);
    return ()=>{alive=false;clearInterval(timer);};
  },[id,tour]);
  async function run(fn:()=>Promise<void>){
    setBusy(true); setError("");
    try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function create(){
    const data=await api("",{tour});
    sessionStorage.setItem("havenlens.host."+data.room,data.host);
    setHost(data.host);
    const url=new URL(location.href);url.searchParams.set("tour",tour);url.hash="room="+data.room;
    history.replaceState(history.state,"",url);
    setId(data.room);
  }
  async function submit(){
    if(!state) return;
    noteId.current ||= crypto.randomUUID();
    accept(await api("/"+id,{action:"note",id:noteId.current,step:state.step,text:draft}));
    setDraft("");noteId.current="";
  }
  function download(){
    if(!state)return;
    const text=["HavenLens team debrief",title,"Fictional tabletop exercise · Not operational guidance","",...events.flatMap((e,i)=>[e.title,e.report,e.prompt,...state.notes.filter(n=>n.step===i).map(n=>"• "+n.text),""])].join("\n");
    const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="havenlens-team-debrief.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const current=state && events[state.step];
  return <aside className="drill"><div className="drillCap">SHARED TABLETOP</div><h2>{state?.step===3?"Team debrief":"Team session"}</h2>
    {!id ? <><p>Create a room for this capture. Everyone with site access and the invitation can read and contribute exercise notes.</p><button disabled={busy} className="action" onClick={()=>run(create)}>Create room</button></> : <>
      <details><summary>Participant invitation</summary><label>Share this link<input readOnly value={location.href} onFocus={e=>e.target.select()}/></label></details>
      {!state && <p>Connecting to the room…</p>}
      {state && current && <><div className="mono">EVENT {state.step+1} / 3 · {host?"FACILITATOR":"PARTICIPANT"}</div>
        <h3>{current.title}</h3><p>{current.report}</p>
        <label className="question">{current.prompt}<textarea maxLength={2000} value={draft} onChange={e=>{noteId.current="";setDraft(e.target.value);}}/></label>
        <button className="action" disabled={busy || !draft.trim()} onClick={()=>run(submit)}>Add shared observation</button>
        {host && <button className="action teamStart" disabled={busy} onClick={()=>run(async()=>accept(await api("/"+id,{action:"advance",step:state.step},host)))}>{state.step===2?"Finish exercise":"Advance team"}</button>}
      </>}
      {state && <section className="teamNotes">{events.map((e,i)=> (state.step===i || state.step===3) && <div key={e.title}><h3>{state.step===3?e.title:"Shared observations"}</h3>{state.notes.some(n=>n.step===i)?<ul>{state.notes.filter(n=>n.step===i).map(n=><li key={n.id}>{n.text}</li>)}</ul>:<p>No observations recorded.</p>}</div>)}</section>}
      {state?.step===3 && <button className="action" onClick={download}>Download shared debrief ↓</button>}
    </>}
    <p role="status">{error}</p><div className="drillLinks"><button onClick={()=>{history.replaceState(history.state,"",location.pathname+location.search);leave();}}>Return to solo exercise</button></div>
    <footer>Fictional scenario · Not operational guidance</footer></aside>;
}
