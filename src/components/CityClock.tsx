"use client";
import {useEffect,useMemo,useState, type Dispatch,type SetStateAction,type CSSProperties} from "react";
import {hourLabel,type BuildingRow} from "../lib/dossier";
import {populationTotals,SCENARIOS,type Scenario} from "../lib/scenario";

const exposedLabel={fire:"Likely asleep", flood:"At or below ground level", blackout:"Upstairs, may need help getting down"};
const reasons={
  fire:"The fire estimate weighs building height, sprinklers, building materials and how many people may be asleep.",
  flood:"The flood estimate looks at people on lower floors and whether there is a higher floor.",
  blackout:"The blackout estimate looks at people upstairs who may need help if elevators stop.",
};

export default function CityClock({suspended=false,city,buildings,hour,setHour,scenario,setScenario}:{suspended?:boolean;city:string;buildings:BuildingRow[];hour:number;setHour:Dispatch<SetStateAction<number>>;scenario:Scenario;setScenario:(scenario:Scenario)=>void}) {
  const [open,setOpen]=useState(true),[playing,setPlaying]=useState(false);
  const totals=useMemo(()=>populationTotals(buildings,scenario,hour),[buildings,scenario,hour]);
  useEffect(()=>{
    if(!playing||suspended)return;
    const timer=window.setInterval(()=>setHour(h=>(h+1)%24),1000);
    return ()=>window.clearInterval(timer);
  },[playing,setHour,suspended]);
  function metric(label:string,value:number|null){
    return <div><dt>{label}</dt><dd>{buildings.length && value!=null ? value.toLocaleString("en-US") : "—"}</dd></div>;
  }
  return <section className="cityClock" aria-label="Citywide estimates" style={{"--clock-color":`var(--signal-${scenario})`} as CSSProperties}>
    <header><div><small>Citywide estimates · {city}</small><h2>Who’s inside?</h2></div><button aria-expanded={open} aria-controls="clock-body" onClick={()=>{setOpen(!open);setPlaying(false)}}>{open?"Hide":"Show"} clock</button></header>
    {open && <div id="clock-body"><div className="clockChoices" role="group" aria-label="Citywide scenario">{(Object.keys(SCENARIOS) as Scenario[]).map(s=><button key={s} aria-pressed={s===scenario} onClick={()=>setScenario(s)}><i style={{background:`var(--signal-${s})`}}/>{SCENARIOS[s].label}</button>)}</div>
    <div className="clockScrub"><button aria-label={playing?"Pause the city clock":"Play the city clock"} onClick={()=>setPlaying(!playing)}>{playing?"Ⅱ":"▶"}</button><b>{hourLabel(hour)}</b><span>{hour<6||hour>=20?"Night":"Day"}</span><input type="range" min="0" max="23" value={hour} aria-label="Citywide hour" aria-valuetext={hourLabel(hour)} onChange={e=>{setPlaying(false);setHour(+e.target.value)}}/></div>
    <dl>{metric("People inside",totals.now)}{metric(exposedLabel[scenario],scenario==="fire" && hour>=6 && hour<23 ? null : totals.exposed)}{metric("May need help leaving",totals.mobility)}{metric("High-priority buildings",totals.high)}</dl>
    <details><summary>What do these numbers mean?</summary><p>{reasons[scenario]} {scenario==="fire" && "The sleep estimate covers 11 PM through 5 AM."}</p><p>These are estimates for the buildings in our {city} file. We use homes, hotel rooms, worker counts and floor area, along with typical daily routines and mobility rates. Nobody is counted live. <a href="/method">How we estimate</a></p></details></div>}
  </section>;
}
