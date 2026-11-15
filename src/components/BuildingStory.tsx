import { useEffect, useState } from "react";
import { AssemblyPanel } from "./EvacuationPanel";
import type { Scenario } from "../lib/scenario";
import {createPortal} from "react-dom";
import PeopleByHour from "./PeopleByHour";
import { type Dossier } from "../lib/dossier";

function firstFact(d:Dossier) {
  if(d.apartment?.units) return [d.apartment.units.toLocaleString()+" apartments","That’s how many homes the property record lists."];
  if(d.hotel?.rooms) return [d.hotel.rooms.toLocaleString()+" hotel rooms","That’s how many guest rooms the property record lists."];
  if(d.stories) return [d.stories+" "+(d.stories===1?"floor":"floors"),"That’s how many floors the property record lists."];
  if(d.built) return ["Built in "+d.built,"That’s the year listed in the property record."];
  return [d.type==="Multifamily"?"Apartments":d.type,"That’s how the property record describes this place."];
}
function clue(d:Dossier) {
  const basis=d.peopleBasis||"";
  if(!d.people) return ["A missing piece","There isn’t enough information here to estimate how many people visit."];
  if(/units? ×/i.test(basis)) return ["Start with homes.","We start with the apartment count, allow for empty homes, then estimate how many people are home at this hour."];
  if(/rooms?/i.test(basis)) return ["Start with rooms.","The room count helps us guess how many guests might be here. The guess changes with the hour."];
  if(/headcount|employees/i.test(basis)) return ["Start with workers.","The file lists how many people work for some businesses here. We use typical work hours to estimate how many are in."];
  if(/sq ft|sqft|floor area|square feet/i.test(basis)) return ["Start with space.","The size of the building helps us guess how many people fit. We adjust that guess for the hour."];
  return ["A pattern over time","We start with an estimate for a busy hour. Then we use a typical day for this kind of place."];
}
const views = [
  {id:"outside",label:"Photos",title:"Meet the building."},
  {id:"aerial",label:"From above",title:"See where it sits."},
  {id:"inside",label:"Inside tour",title:"Step inside."},
  {id:"people",label:"People by hour",title:"Who might be here?"},
  {id:"movement",label:"Floor model",title:"See the floors."},
  {id:"assembly",label:"Find assembly area",title:"Where could people gather?"},
] as const;

export default function BuildingStory({recordsDock,d,hour,scenario,setHour,openFile,openModel,modelOpen,leaveModel,children}:{recordsDock:HTMLDivElement|null;d:Dossier;hour:number;scenario:Scenario;setHour:(v:number)=>void;openFile:()=>void;openModel:()=>void;modelOpen:boolean;leaveModel:()=>void;children:React.ReactNode}) {
  const [info,setInfo]=useState(false);
  const [autoTour,setAutoTour]=useState(false);
  const [fit,setFit]=useState(false);
  const [photo,setPhoto]=useState(0),[scan,setScan]=useState(0);
  const [badPhotos,setBadPhotos]=useState<string[]>([]),[noAerial,setNoAerial]=useState(false);
  const photos=d.photos.filter(p=>!badPhotos.includes(p));
  const activePhoto=photos[Math.min(photo,photos.length-1)];
  const [fact,meaning]=firstFact(d), [basis,explanation]=clue(d);
  const back="/?city="+encodeURIComponent(d.city||"Houston");
  const [viewIndex,setViewIndex]=useState(0);
  const view=views[viewIndex];
  useEffect(()=>{
    function restoreView(){
      const index=views.findIndex(v=>"#"+v.id===location.hash);
      if (views[index]?.id === "movement") {
        openModel();
        history.replaceState(history.state, "", "#" + views[0].id);
        setViewIndex(0);
        return;
      }
      setViewIndex(index<0?0:index);
    }
    restoreView();
    window.addEventListener("hashchange",restoreView);
    return ()=>window.removeEventListener("hashchange",restoreView);
  },[openModel]);
  function choose(index:number){
    setInfo(false);
    if(recordsDock) leaveModel();
    if (views[index].id === "movement") {
      openModel();
      return;
    }
    if(modelOpen) leaveModel();
    setViewIndex(index);
    history.replaceState(history.state,"","#"+views[index].id);
  }
  function returnToMap(e:React.MouseEvent<HTMLAnchorElement>){
    if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||!document.referrer)return;
    const from=new URL(document.referrer);
    if(from.origin===location.origin && ["/","/city","/city/"].includes(from.pathname) && history.length>1){e.preventDefault();history.back();}
  }
  const captions=[
    meaning,
    "This aerial photo shows the area around the address when the image was taken.",
    "Drag to look around. A scan may cover one suite or room.",
    d.people?explanation:"The records do not give us a starting count.",
    "",
    "Review the candidate location and check current conditions on site.",
  ];
  const taskbar = <nav className="deskNav buildingTaskbar" aria-label="Building views">
    <button aria-current={recordsDock ? "page" : undefined} className="recordsLink" onClick={openFile}>Records</button>
    {views.map((v,i)=><button key={v.id} onClick={()=>choose(i)} aria-current={!recordsDock && (modelOpen?v.id==="movement":i===viewIndex)?"page":undefined}>{v.label}</button>)}
  </nav>;
  return <section className="buildingDesk" data-model-open={modelOpen}>
    {children}
    <header className="deskMast" inert={modelOpen}><a href={back} onClick={returnToMap}>← Map</a><h1>{d.name}</h1><button aria-expanded={info} aria-controls="view-notes" onClick={()=>setInfo(!info)}>View notes</button></header>
    {recordsDock ? createPortal(taskbar,recordsDock) : taskbar}
    <div className="deskSpread" inert={modelOpen}>
      <section className="deskStage" aria-label={view.label}>
        {view.id==="outside" && <>{activePhoto?<img className="deskPhoto" style={{objectFit:fit?"contain":"cover"}} src={activePhoto} alt={d.name+" property photo"} onError={()=>setBadPhotos(prev=>[...prev,activePhoto])}/>:<p className="emptyView">{d.photos.length?"The photo couldn’t load.":"No photo is on file."} <button onClick={()=>choose(1)}>Try the aerial view →</button></p>}
          <div className="stageCaption"><span>Photo · CoStar</span>{activePhoto&&<button aria-pressed={fit} onClick={()=>setFit(!fit)}>{fit?"Fill screen":"Fit image"}</button>}{photos.length>1&&<span><button aria-label="Previous photo" onClick={()=>setPhoto((photos.indexOf(activePhoto)-1+photos.length)%photos.length)}>←</button> {photos.indexOf(activePhoto)+1} / {photos.length} <button aria-label="Next photo" onClick={()=>setPhoto((photos.indexOf(activePhoto)+1)%photos.length)}>→</button></span>}</div></>}
        {view.id==="aerial" && <>{noAerial?<p className="emptyView">No aerial image available.</p>:<img className="deskPhoto" style={{objectFit:fit?"contain":"cover"}} src={`/api/vexcel/${d.id}/ortho.jpg`} alt={"Aerial image of "+d.name} onError={()=>setNoAerial(true)}/>}<div className="stageCaption">Aerial · Vexcel {!noAerial&&<button aria-pressed={fit} onClick={()=>setFit(!fit)}>{fit?"Fill screen":"Fit image"}</button>}</div></>}
        {view.id==="inside" && (d.models.length>0?<><iframe className="deskTour" key={scan} title={d.name+" Matterport walkthrough"} allowFullScreen src={`https://my.matterport.com/show/?m=${encodeURIComponent(d.models[scan])}&play=${autoTour?"1&qs=1&ts=1&lp=1&hr=1":"0"}`}/><div className="stageCaption"><label>Walkthrough <select aria-label="Select walkthrough" value={scan} onChange={e=>setScan(Number(e.target.value))}>{d.models.map((id,i)=><option key={id} value={i}>Scan {i+1}</option>)}</select></label><a href={`https://my.matterport.com/show/?m=${encodeURIComponent(d.models[scan])}`} target="_blank" rel="noreferrer">Open Matterport ↗</a><button aria-pressed={autoTour} onClick={()=>setAutoTour(!autoTour)}>{autoTour?"Stop auto tour":"Auto tour"}</button></div></>:<p className="emptyView">No indoor scan is linked.</p>)}
        {view.id==="people" && (d.people?<PeopleByHour d={d} hour={hour} setHour={setHour}/>:<p className="emptyView">No estimate is available.</p>)}
        <div className="assemblyView" hidden={view.id!=="assembly"}>
          <AssemblyPanel d={d} hour={hour} scenario={scenario} visible={view.id==="assembly"}/>
        </div>
      </section>
      <aside id="view-notes" className="deskNote" hidden={!info}><p>{[d.street,d.city].filter(Boolean).join(", ")}</p><div aria-live="polite"><small>{view.label}</small><h2>{view.title}</h2>{view.id==="outside"&&<b>{fact}</b>}{view.id==="people"&&d.people!=null&&<b>{basis}</b>}<p>{captions[viewIndex]}</p></div>
      <button className="nextView" onClick={()=>viewIndex<views.length-1?choose(viewIndex+1):openFile()}>{viewIndex<views.length-1?"Next: "+views[viewIndex+1].label:"Explore the full file"} →</button></aside>
    </div>
  </section>;
}
