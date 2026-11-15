"use client";
import HavenMark from "./HavenMark";
import {useEffect,useMemo,useRef,useState} from "react";
import Explorer from "./Explorer";
import CityClock from "./CityClock";
import BuildingMap from "./BuildingMap";
import {SCENARIOS,type Scenario} from "../lib/scenario";
import {hourLabel,loadIndex,TIER_COLOR,type BuildingRow,type Tier} from "../lib/dossier";
import "./dossier.css";

const centers = {Houston:{lat:29.76,lon:-95.42,zoom:11},"Los Angeles":{lat:34.05,lon:-118.33,zoom:11}};
type City = keyof typeof centers;
export default function MapHome(){
  const [city,setCity]=useState<City>("Houston"),[rows,setRows]=useState<BuildingRow[]>([]);
  const [hour,setHour]=useState(3),[scenario,setScenario]=useState<Scenario>("fire");
  const [mode,setMode]=useState<"3am"|"call"|null>(null);
  const launcher=useRef<HTMLButtonElement|null>(null);
  function launch(which:"3am"|"call",button:HTMLButtonElement){
    launcher.current=button;
    const url=new URL(window.location.href);
    url.hash=which;
    history.pushState({demoEntry:true},"",url);
    setMode(which);
  }
  function exitDemo(){
    if(history.state?.demoEntry){history.back();return;}
    history.replaceState(null,"",city==="Houston"?"/":"/?city="+encodeURIComponent(city));
    setMode(null);
  }
  const [query,setQuery]=useState(""),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const url=new URL(location.href);
    const readMode=()=>{
      const hash=location.hash;
      setMode(hash==="#3am"?"3am":hash==="#call"?"call":null);
      if(hash!=="#3am"&&hash!=="#call")requestAnimationFrame(()=>launcher.current?.focus());
    };
    readMode();
    if(!["#3am","#call"].includes(url.hash) && (url.searchParams.has("incident") || ["#population","#directory"].includes(url.hash))){location.replace("/city"+url.search+url.hash);return}
    if(url.searchParams.get("city")==="Los Angeles")setCity("Los Angeles");
    window.addEventListener("popstate",readMode);
    loadIndex().then(d=>setRows(d.buildings)).catch(()=>setFailed(true));
    return ()=>window.removeEventListener("popstate",readMode);
  },[]);
  const buildings=useMemo(()=>rows.filter(b=>b.city===city),[city,rows]);
  const matches=query.trim()?buildings.filter(b=>(b.name+" "+b.street).toLowerCase().includes(query.trim().toLowerCase())).slice(0,6):[];
  const href=(b:BuildingRow)=>`/building?id=${b.id}&s=${scenario}&h=${hour}#records`;
  return <><main hidden={Boolean(mode)} className="hl mapHome"><h1 className="mapWordmark"><HavenMark/>HavenLens</h1>
    <BuildingMap buildings={buildings} hour={hour} scenario={scenario} focus={centers[city]} onSelect={b=>location.assign(href(b))} browse/>
    <nav className="mapDemos" aria-label="Training demos"><button className="mapDemo" onClick={e=>launch("3am",e.currentTarget)}>3 AM Houston demo</button><button className="mapCall" onClick={e=>launch("call",e.currentTarget)}><i aria-hidden="true"/>Play incoming 911 call</button></nav>
    <div className="mapFinder"><div className="mapControls"><select aria-label="Choose a city" value={city} onChange={e=>{const next=e.target.value as City;setCity(next);setQuery("");history.replaceState(null,"","/?city="+encodeURIComponent(next))}}>{Object.keys(centers).map(c=><option key={c}>{c}</option>)}</select>
    <input aria-label="Find a building" type="search" placeholder="Find a building…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    {query.trim() && <div className="mapResults">{matches.length?matches.map(b=><a href={href(b)} key={b.id}><strong>{b.name}</strong><small>{b.street}</small></a>):<p>{rows.length?"No matches in this city.":"Loading buildings…"}</p>}</div>}</div>
    <div className="mapDock"><CityClock suspended={Boolean(mode)} hour={hour} setHour={setHour} scenario={scenario} setScenario={setScenario} city={city} buildings={buildings}/><div className="mapCaption"><div className="homeTierLegend" aria-label={`Estimated ${scenario} priority at ${hourLabel(hour)}`}><b>Map dots · {SCENARIOS[scenario].label} at {hourLabel(hour)}</b><div>{(["High","Elevated","Standard"] as Tier[]).map(t=><span key={t}><i style={{background:TIER_COLOR[t]}} aria-hidden="true"/>{t}</span>)}</div></div><span role="status">{failed?"Building records couldn’t load.":buildings.length?"Bigger circles mean more people estimated inside.":"Loading buildings…"}</span><a href="/city">City tools ↗</a></div></div>
  </main>{mode&&<Explorer key={mode} mode={mode} onExit={exitDemo}/>}</>;
}
