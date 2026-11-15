import { hourLabel, peopleAt, type Dossier } from "../lib/dossier";

function DayDial({hour}: {hour: number}) {
  const night = hour < 6 || hour >= 18;
  return <svg className="dayDial" viewBox="0 0 160 160" aria-hidden="true">
    <circle cx="80" cy="80" r="67" fill="none" stroke="currentColor" opacity=".2"/>
    {Array.from({length:24}, (_,i) => <line key={i} x1="80" y1="14" x2="80" y2={i%6===0?25:19} transform={`rotate(${i*15} 80 80)`} stroke="currentColor"/>)}
    <g transform={`rotate(${hour*15} 80 80)`}><circle cx="80" cy="13" r="5" fill="var(--scenario)"/></g>
    {night ? <path d="M91 47a17 17 0 1 0 8 24 18 18 0 0 1-8-24Z" fill="currentColor"/> :
      <g stroke="currentColor"><circle cx="80" cy="59" r="9" fill="none"/>{Array.from({length:8},(_,i)=><path key={i} d="M80 43v4" transform={`rotate(${45*i} 80 59)`}/>)}</g>}
    <text x="80" y="97" textAnchor="middle" fill="currentColor" fontSize="16">{hourLabel(hour)}</text>
  </svg>;
}

export default function PeopleByHour({d,hour,setHour}:{d:Dossier;hour:number;setHour:(hour:number)=>void}) {
  const estimates = Array.from({length:24},(_,i)=>peopleAt(d,i));
  const peak = Math.max(1,...estimates);
  const points = estimates.map((count,i)=>[i*1000/23,143-count/peak*132]);
  const line = points.map(point=>point.join(",")).join(" ");
  const [x,y] = points[hour];
  return <article className="hourEdition">
    <div className="hourSheet">
      <header className="hourHeadline"><div><small>A day at {d.name}</small><h2>Who’s inside?</h2></div><DayDial hour={hour}/></header>
      <div className="hourReading"><b>{estimates[hour].toLocaleString()}</b><span>people estimated inside<br/>at {hourLabel(hour)}</span></div>
      <div className="hourPlot">
        <svg viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true">
          <defs><pattern id="hour-hatch" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M1 0v7" stroke="currentColor" opacity=".24"/></pattern></defs>
          {[12,55,99,143].map(level=><line key={level} x2="1000" y1={level} y2={level} stroke="currentColor" opacity=".13" strokeDasharray="2 6"/>)}
          <polygon points={`0,143 ${line} 1000,143`} fill="url(#hour-hatch)"/>
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          <line x1={x} x2={x} y1="0" y2="150" stroke="var(--scenario)" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
        </svg>
        <i style={{left:x/10+"%",top:y/1.5+"%"}}/>
        <input type="range" aria-label="Choose an hour" min="0" max="23" value={hour} aria-valuetext={hourLabel(hour)} onChange={e=>setHour(Number(e.target.value))}/>
      </div>
      <div className="hourScale">{[0,6,12,18,23].map(i=><button key={i} style={{left:(100*i/23)+"%"}} onClick={()=>setHour(i)}>{["Midnight","6 am","Noon","6 pm","11 pm"][[0,6,12,18,23].indexOf(i)]}</button>)}</div>
      <footer>Drag across the day <span>Typical day · Estimated counts</span></footer>
    </div>
  </article>;
}
