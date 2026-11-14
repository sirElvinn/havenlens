"use client";

import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import { Component, type ReactNode } from "react";

export const levels = [6, 5, 4, 3, 2, 1];
type SceneProps = { selected: number; select: (level: number) => void; overlays?: ReactNode };

function Structure({ selected, select, overlays }: SceneProps) {
  return <>
    <ambientLight intensity={1.8}/>
    <directionalLight position={[5, 12, 9]} intensity={2.1}/>
    <gridHelper args={[80, 80, "#364842", "#283630"]} position={[0,-0.2,0]}/>
    {levels.map(level => {
      const active = level === selected;
      return <group key={level} position={[0,(level-1)*1.22,0]} onClick={e => { if(e.delta < 5) { e.stopPropagation(); select(level); } }}>
        <mesh>
          <boxGeometry args={[6,.16,3.6]}/>
          <meshStandardMaterial color={active ? "#b5dc7c" : "#778e83"}/>
          <Edges color={active ? "#deff9c" : "#a1b0a7"}/>
        </mesh>
        {[-2.8,-1.4,0,1.4,2.8].flatMap(x => [-1.6,1.6].map(z =>
          <mesh key={x+","+z} position={[x,.53,z]}>
            <boxGeometry args={[.09,.94,.09]}/><meshStandardMaterial color="#9aaea1"/>
          </mesh>))}
        <mesh position={[0,.53,0]}>
          <boxGeometry args={[5.7,.94,3.28]}/>
          <meshStandardMaterial color={active ? "#a3c880" : "#86b6ae"} transparent opacity={active ? .23 : .10} depthWrite={false}/>
          <Edges color={active ? "#bed995" : "#849e91"}/>
        </mesh>
      </group>;
    })}
    {overlays}
    <OrbitControls makeDefault target={[0,3.3,0]} minDistance={6} maxDistance={36} maxPolarAngle={Math.PI*.48}/>
  </>;
}

class RenderBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed ? <p className="fallback">3D rendering unavailable. Use the floor selector and timeline below.</p> : this.props.children; }
}

export default function Building(props: SceneProps & {view:number}) {
  return <RenderBoundary><Canvas key={props.view} dpr={[1,1.6]} camera={{position:[11,10,14],fov:38}} fallback={<p>WebGL is unavailable.</p>}>
    <Structure {...props}/>
  </Canvas></RenderBoundary>;
}
