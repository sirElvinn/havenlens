export const duration = 30;
export function phaseAt(seconds: number) {
  if (seconds >= duration) return "Playback complete";
  if (seconds >= 18) return "Responder marker";
  if (seconds >= 10) return "Occupant markers";
  if (seconds >= 4) return "Fire marker on floor 6";
  return "Building overview";
}

export function ScenarioMarkers({seconds}: {seconds:number}) {
  return <>
    {seconds >= 4 && <group position={[1.55,6.9,1.4]} scale={1+.12*Math.sin(seconds*4)}>
      <mesh><octahedronGeometry args={[.48]}/><meshBasicMaterial color="#ff8959"/></mesh>
      <mesh position={[0,.08,0]}><coneGeometry args={[.21,.95,6]}/><meshBasicMaterial color="#ffe1a1"/></mesh>
    </group>}
    {seconds >= 10 && [-1,0].map(x=><mesh key={x} position={[x,6.5,1.6]}>
      <sphereGeometry args={[.19,12,12]}/><meshBasicMaterial color="#85c9ff"/>
    </mesh>)}
    {seconds >= 18 && <mesh position={[1,.45,1.8]}><boxGeometry args={[.32,.32,.32]}/><meshBasicMaterial color="#dfacff"/></mesh>}
  </>;
}
