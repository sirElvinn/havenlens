"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, Line, OrbitControls } from "@react-three/drei";
import { memo, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { FLOW, positionAt, world, type Agent, type HazardPlan, type V2, type V3 } from "../lib/twin";

export type SceneBuilding = { ring: V2[]; stairs: V2[]; doors: V2[]; peoplePerFloor: number[]; plan: HazardPlan; stairOffset: number; isFire: boolean; label: string };

export type SceneData = {
  buildings: SceneBuilding[];
  ring: V2[];
  others: V2[][];
  stories: number;
  floorHeight: number;
  peoplePerFloor: number[];
  stairs: V2[];
  doors: V2[];
  route: V2[];
  assembly: V2 | null;
  agents: Agent[];
  ground: { url: string; x0: number; x1: number; y0: number; y1: number } | null;
  accent: string;
  scenario: "fire" | "flood" | "blackout";
  plan: HazardPlan;
};

export type View = { mode: "building" | "route" | "floor"; floor: number | null; key: number };

const STAIR = "#58c4a6", QUEUE = "#ffb23e", OUT = "#8fe3cb", FIRE = "#ff5a3c", REFUGE = "#7fb4ff", SHELTER = "#c9a6ff";

function shapeOf(ring: V2[]) {
  const s = new THREE.Shape();
  ring.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  return s;
}

/** A camera-facing text label drawn into the scene (no DOM, so no React roots to mount or unmount). */
function Label({ position, text, color = "#bff3e3", bg = "#0b0e11e6", border = "#58c4a6", scale = 1 }: { position: V3; text: string; color?: string; bg?: string; border?: string; scale?: number }) {
  const { texture, aspect } = useMemo(() => {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = "600 44px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 56, h = 76;
    c.width = w; c.height = h;
    ctx.font = font;
    ctx.fillStyle = bg; ctx.strokeStyle = border; ctx.lineWidth = 4;
    const r = h / 2 - 2;
    ctx.beginPath(); ctx.roundRect(2, 2, w - 4, h - 4, r); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    ctx.fillText(text, w / 2, h / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { texture: t, aspect: w / h };
  }, [text, color, bg, border]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={position} scale={[2.6 * aspect * scale, 2.6 * scale, 1]} renderOrder={10}>
    <spriteMaterial map={texture} depthTest={false} transparent />
  </sprite>;
}

function Floors({ d, b, focus, fireFloor, onPick, onPlaceFire }: { d: SceneData; b: SceneBuilding; focus: number | null; fireFloor: number; onPick: (i: number) => void; onPlaceFire: (p: V2) => void }) {
  const shape = useMemo(() => shapeOf(b.ring), [b.ring]);
  const slab = useMemo(() => new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }), [shape]);
  const wall = useMemo(() => new THREE.ExtrudeGeometry(shape, { depth: d.floorHeight - 0.35, bevelEnabled: false }), [shape, d.floorHeight]);
  const max = Math.max(1, ...d.buildings.flatMap(x => x.peoplePerFloor));
  const fireMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => { if (fireMat.current) fireMat.current.emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 4) * 0.35; });
  return <group rotation={[-Math.PI / 2, 0, 0]}>
    {Array.from({ length: d.stories }, (_, i) => {
      const above = focus != null && i > focus;          // cut away floors above the one being inspected
      const isFocus = focus === i;
      const isFire = d.scenario === "fire" && b.isFire && i === fireFloor;
      const density = b.peoplePerFloor[i] / max;
      const color = new THREE.Color("#2a3139").lerp(new THREE.Color(d.scenario === "fire" ? "#c9d4df" : d.accent), 0.12 + density * 0.6);
      const pick = (e: { stopPropagation: () => void; delta: number; point: THREE.Vector3 }) => {
        if (e.delta > 4) return;
        e.stopPropagation();
        // Inspecting the fire floor: a click on any building moves the fire there instead of leaving the floor.
        if (d.scenario === "fire" && isFocus && i === fireFloor) onPlaceFire([e.point.x, -e.point.z]); else onPick(i);
      };
      const role = b.plan.floors[i]?.role;
      const smoky = d.scenario === "fire" && (role === "above");
      // Floors above the inspected one are removed, not just hidden: hidden meshes still catch clicks.
      if (above) return null;
      return <group key={i} position={[0, 0, i * d.floorHeight]}>
        <mesh geometry={slab} onClick={pick}>
          {isFire && !isFocus
            ? <meshStandardMaterial ref={fireMat} color="#ff5a3c" emissive="#ff3b1a" emissiveIntensity={0.8} />
            : isFire
            ? <meshStandardMaterial color="#c9b8b3" emissive="#ff3b1a" emissiveIntensity={0.06} roughness={0.85} />
            : <meshStandardMaterial color={isFocus ? "#dfe7ee" : smoky ? color.clone().lerp(new THREE.Color("#5b5f66"), 0.55) : role === "flooded" ? "#2f7fd1" : role === "refuge" ? "#3a5f8f" : color} emissive={isFocus ? "#58c4a6" : "#000"} emissiveIntensity={isFocus ? 0.18 : 0} roughness={0.85} />}
          <Edges color={isFire ? "#ffb4a0" : isFocus ? "#ffffff" : "#5a646e"} />
        </mesh>
        {/* The inspected floor shows no walls, so its routes and people are visible from any angle. */}
        {!isFocus && <mesh geometry={wall} position={[0, 0, 0.35]} onClick={pick}>
          <meshStandardMaterial color={isFire ? "#ff5a3c" : "#9fb4c8"} transparent opacity={isFire ? 0.16 : focus != null ? 0.035 : 0.06} depthWrite={false} side={THREE.DoubleSide} />
          <Edges color={isFire ? "#ff8a70" : "#3d4650"} />
        </mesh>}
      </group>;
    })}
  </group>;
}

function Others({ rings }: { rings: V2[][] }) {
  const geos = useMemo(() => rings.map(r => new THREE.ExtrudeGeometry(shapeOf(r), { depth: 3.2, bevelEnabled: false })), [rings]);
  return <group rotation={[-Math.PI / 2, 0, 0]}>{geos.map((g, i) => <mesh key={i} geometry={g}>
    <meshStandardMaterial color="#20262c" transparent opacity={0.7} /><Edges color="#3a434c" />
  </mesh>)}</group>;
}

function Stairs({ d, focus, labelScale }: { d: SceneData; focus: number | null; labelScale: number }) {
  const top = (focus != null ? focus + 1 : d.stories) * d.floorHeight;
  return <>{d.buildings.flatMap((b, bi) => b.stairs.map((s, i) => {
    const fp = focus != null ? b.plan.floors[focus] : null;
    const labelled = b.isFire || d.buildings.length === 1;   // label only the main building's stairs to keep a complex readable
    const [x, , z] = world(s, 0);
    const door = world(b.doors[i], 0.05);
    const attack = b.plan.attack === i;
    const closedHere = fp != null && !fp.open[i];
    const col = attack ? FIRE : STAIR;
    return <group key={`${bi}-${i}`}>
      <mesh position={[x, top / 2, z]}>
        <boxGeometry args={[3.2, top + 0.4, 5]} />
        <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.35} transparent opacity={0.55} />
        <Edges color={attack ? "#ffb4a0" : "#bff3e3"} />
      </mesh>
      {closedHere && focus != null && <Label position={[x, focus * d.floorHeight + 2.6 * labelScale, z]} text="CLOSED" color="#ffb4a0" border={FIRE} scale={labelScale * 0.8} />}
      <mesh position={[door[0], 1.2, door[2]]}><boxGeometry args={[2.2, 2.4, 2.2]} /><meshStandardMaterial color="#8fe3cb" emissive="#58c4a6" emissiveIntensity={0.8} /></mesh>
      {labelled && <Label position={[x, top + 3 * labelScale, z]} text={attack ? `STAIR ${String.fromCharCode(65 + i)}* · FIRE DEPT` : `STAIR ${String.fromCharCode(65 + i)}*`} color={attack ? "#ffb4a0" : "#bff3e3"} border={attack ? FIRE : STAIR} scale={labelScale} />}
      {labelled && <Label position={[door[0], 4 * labelScale, door[2]]} text="EXIT" color="#8fe3cb" border="#8fe3cb" scale={labelScale * 0.85} />}
    </group>;
  }))}
  {d.buildings.length > 1 && d.buildings.map((b, bi) => <Label key={"b" + bi} position={world(centroidOf(b.ring), top + 7 * labelScale)} text={b.isFire && d.scenario === "fire" ? `${b.label.toUpperCase()} · FIRE` : b.label.toUpperCase()} color={b.isFire && d.scenario === "fire" ? "#fff2e8" : "#dfe7ee"} bg={b.isFire && d.scenario === "fire" ? "#ff5a3ccc" : "#0b0e11d9"} border={b.isFire && d.scenario === "fire" ? FIRE : "#5a646e"} scale={labelScale * 0.9} />)}
  </>;
}

function centroidOf(ring: V2[]): V2 {
  return ring.reduce<V2>((t, p) => [t[0] + p[0] / ring.length, t[1] + p[1] / ring.length], [0, 0]);
}

function Routes({ d, floor, labelScale }: { d: SceneData; floor: number; labelScale: number }) {
  const fp = d.plan.floors[floor];   // the main building's plan, for the shelter label
  const dashed = useRef<THREE.Object3D[]>([]);
  useFrame((_, dt) => { for (const l of dashed.current) { const m = (l as unknown as { material?: { dashOffset: number } }).material; if (m) m.dashOffset -= dt * 6; } });
  const y = floor * d.floorHeight + 0.7;
  const lines = useMemo(() => {
    const out: { pts: V3[]; color: string; width: number }[] = [];
    // Each building follows its own plan; routes start where that floor's people who use each stair are.
    d.buildings.forEach(b => {
      const bfp = b.plan.floors[floor];
      if (!bfp || bfp.action === "shelter") return;
      b.stairs.forEach((s, li) => {
        const gi = b.stairOffset + li;
        const users = d.agents.filter(a => a.floor === floor && a.stair === gi);
        if (!users.length) return;
        const sx = users.reduce((t, a) => t + a.pts[0][0], 0) / users.length, sz = users.reduce((t, a) => t + a.pts[0][2], 0) / users.length;
        const from: V2 = [sx, -sz];
        out.push({ pts: [world(from, y), world(s, y)], color: d.scenario === "fire" && bfp.role === "fire" ? "#ffd166" : d.accent, width: 4 });   // across the floor
        if (bfp.action === "refuge" && b.plan.refugeFloor != null) {
          const ry = b.plan.refugeFloor * d.floorHeight + 0.7;
          out.push({ pts: [world(s, y), world(s, ry)], color: REFUGE, width: 4 });                        // up to the refuge floor
        } else {
          if (floor > 0) out.push({ pts: [world(s, y), world(s, 0.7)], color: STAIR, width: 4 });       // down the stair
          out.push({ pts: [world(s, 0.7), world(b.doors[li], 0.7)], color: OUT, width: 4 });            // to the exit door
        }
      });
    });
    return out;
  }, [d, floor, y, fp]);
  dashed.current.length = 0;
  return <>
    {lines.map((l, i) => <Line key={`${floor}-${i}`} ref={el => { if (el) dashed.current[i] = el; }} points={l.pts} color={l.color} lineWidth={l.width} dashed dashSize={2} gapSize={1.2} />)}
    {d.route.length > 1 && <>
      <Line points={d.route.map(p => world(p, 0.25))} color="#000000" lineWidth={9} transparent opacity={0.55} />
      <Line ref={el => { if (el) dashed.current[lines.length] = el; }} points={d.route.map(p => world(p, 0.3))} color={OUT} lineWidth={5} dashed dashSize={4} gapSize={2.5} />
    </>}
    {fp?.action === "shelter" && <Label position={world(d.ring.reduce<V2>((t, p) => [t[0] + p[0] / d.ring.length, t[1] + p[1] / d.ring.length], [0, 0]), y + 2.5 * labelScale)} text={fp.role === "refuge" ? "REFUGE FLOOR · SHELTER HERE" : "SHELTER IN PLACE"} color="#e6dcff" border={SHELTER} scale={labelScale} />}
    {d.assembly && <group position={world(d.assembly, 0.3)}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[9, 12, 48]} /><meshBasicMaterial color={OUT} transparent opacity={0.9} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[9, 48]} /><meshBasicMaterial color={OUT} transparent opacity={0.18} /></mesh>
      <Label position={[0, 7 * labelScale, 0]} text="ASSEMBLY AREA" color="#0b0e11" bg="#8fe3cbee" border="#8fe3cb" scale={labelScale} />
    </group>}
  </>;
}

function People({ agents, clock, focus, floorHeight }: { agents: Agent[]; clock: MutableRefObject<number>; focus: number | null; floorHeight: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => ({ moving: new THREE.Color("#ffffff"), queued: new THREE.Color(QUEUE), stairs: new THREE.Color(STAIR), out: new THREE.Color(OUT), waiting: new THREE.Color("#9aa4ad"), refuge: new THREE.Color(REFUGE), shelter: new THREE.Color(SHELTER) }), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.current;
    const ceiling = focus != null ? (focus + 1) * floorHeight : Infinity;
    agents.forEach((a, i) => {
      const { p, state } = positionAt(a, t);
      tmp.position.set(p[0], p[1] + 0.5, p[2]);
      tmp.scale.setScalar(p[1] >= ceiling ? 0 : 1);   // hide people on cut-away floors
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, colors[state]);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, agents.length)]} frustumCulled={false}>
    <sphereGeometry args={[0.55, 10, 10]} />
    <meshBasicMaterial toneMapped={false} />
  </instancedMesh>;
}

function Ground({ ground }: { ground: SceneData["ground"] }) {
  const tex = useMemo(() => {
    if (!ground) return null;
    const t = new THREE.TextureLoader().load(ground.url);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [ground]);
  useEffect(() => () => tex?.dispose(), [tex]);
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}><planeGeometry args={[4000, 4000]} /><meshStandardMaterial color="#0d1013" /></mesh>
    <gridHelper args={[1200, 120, "#1d242b", "#161b20"]} position={[0, -0.02, 0]} />
    {tex && ground && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(ground.x0 + ground.x1) / 2, 0, -(ground.y0 + ground.y1) / 2]}>
      <planeGeometry args={[ground.x1 - ground.x0, ground.y1 - ground.y0]} />
      <meshBasicMaterial map={tex} transparent opacity={0.85} toneMapped={false} />
    </mesh>}
  </>;
}

/** Fire origin: flickering core, light, the no-go radius, and a smoke column rising through the floors above. */
function Fire({ d, fireFloor, focus, labelScale }: { d: SceneData; fireFloor: number; focus: number | null; labelScale: number }) {
  const core = useRef<THREE.Mesh>(null), light = useRef<THREE.PointLight>(null), smoke = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
    if (core.current) core.current.scale.setScalar(f);
    if (light.current) light.current.intensity = 60 * f;
    if (smoke.current) (smoke.current.material as THREE.MeshStandardMaterial).opacity = 0.18 + Math.sin(t * 1.7) * 0.04;
  });
  if (d.scenario !== "fire" || !d.plan.fire) return null;
  const y = fireFloor * d.floorHeight + 1.4;
  const [x, , z] = world(d.plan.fire, 0);
  const top = (focus != null ? focus + 1 : d.stories) * d.floorHeight;
  const smokeH = Math.max(0, top - (fireFloor + 1) * d.floorHeight);
  return <group>
    <mesh ref={core} position={[x, y, z]}><sphereGeometry args={[1.6, 20, 20]} /><meshBasicMaterial color="#ffb347" toneMapped={false} /></mesh>
    <mesh position={[x, y, z]}><sphereGeometry args={[3.2, 20, 20]} /><meshBasicMaterial color={FIRE} transparent opacity={0.35} toneMapped={false} depthWrite={false} /></mesh>
    <pointLight ref={light} position={[x, y + 1, z]} color="#ff7a3c" distance={40} decay={1.6} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, fireFloor * d.floorHeight + 0.45, z]}>
      <ringGeometry args={[FLOW.fireRadius - 0.6, FLOW.fireRadius, 64]} /><meshBasicMaterial color={FIRE} transparent opacity={0.85} toneMapped={false} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, fireFloor * d.floorHeight + 0.42, z]}>
      <circleGeometry args={[FLOW.fireRadius, 64]} /><meshBasicMaterial color={FIRE} transparent opacity={0.12} depthWrite={false} />
    </mesh>
    {smokeH > 0 && <mesh ref={smoke} position={[x, (fireFloor + 1) * d.floorHeight + smokeH / 2, z]}>
      <cylinderGeometry args={[5, 3, smokeH, 24, 1, true]} /><meshStandardMaterial color="#8a8f96" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>}
    <Label position={[x, y + 4 * labelScale, z]} text="FIRE" color="#fff2e8" bg="#ff5a3ce6" border="#ffb347" scale={labelScale} />
  </group>;
}

function Water({ show }: { show: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = 1.22 + Math.sin(clock.elapsedTime * 1.3) * 0.05; });
  if (!show) return null;
  return <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 1.22, 0]}>
    <planeGeometry args={[900, 900]} />
    <meshStandardMaterial color="#2f7fd1" transparent opacity={0.35} roughness={0.1} metalness={0.2} depthWrite={false} />
  </mesh>;
}

/** Flies the camera only when the view changes (view.key), and lets go as soon as the user grabs the mouse. */
function CameraRig({ view, frame }: { view: View; frame: { building: [V3, V3]; route: [V3, V3]; floor: (i: number) => [V3, V3] } }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const goal = useRef<{ pos: THREE.Vector3; tgt: THREE.Vector3 } | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    const f = frameRef.current;
    const [pos, tgt] = view.mode === "route" ? f.route : view.mode === "floor" && view.floor != null ? f.floor(view.floor) : f.building;
    goal.current = { pos: new THREE.Vector3(...pos), tgt: new THREE.Vector3(...tgt) };
  }, [view.key, view.mode, view.floor]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { goal.current = null; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.tgt, k);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.2 && controls.target.distanceTo(g.tgt) < 0.2) goal.current = null;
  });
  return null;
}

type Props = { d: SceneData; clock: MutableRefObject<number>; view: View; fireFloor: number; onPick: (i: number) => void; onPlaceFire: (p: V2) => void };

function TwinScene({ d, clock, view, fireFloor, onPick, onPlaceFire }: Props) {
  const focus = view.mode === "floor" ? view.floor : null;
  const geo = useMemo(() => {
    const h = d.stories * d.floorHeight;
    const allRings = d.buildings.flatMap(b => b.ring);
    const xs = allRings.map(p => p[0]), ys = allRings.map(p => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const radius = Math.max(30, span, h) * 1.25;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = -(Math.max(...ys) + Math.min(...ys)) / 2;
    const all = [...allRings, ...d.route];
    const rx = all.map(p => p[0]), ry = all.map(p => p[1]);
    const rc: V3 = [(Math.max(...rx) + Math.min(...rx)) / 2, 0, -(Math.max(...ry) + Math.min(...ry)) / 2];
    const rr = Math.max(radius, Math.max(Math.max(...rx) - Math.min(...rx), Math.max(...ry) - Math.min(...ry)) * 0.75);
    const frame = {
      building: [[cx + radius * 1.15, radius * 0.95, cz + radius * 1.15], [cx, h / 2.4, cz]] as [V3, V3],
      route: [[rc[0] + rr * 1.1, rr * 1.3, rc[2] + rr * 1.1], rc] as [V3, V3],
      // Look down into the chosen floor from a 45° angle, close enough to read the routes.
      floor: (i: number) => { const y = i * d.floorHeight + 0.5, r = Math.max(22, span * 0.75); return [[cx + r * 0.8, y + r * 0.9, cz + r * 0.8], [cx, y, cz]] as [V3, V3]; },
    };
    return { h, radius, span, frame, labelScale: Math.max(1, Math.min(3, span / 45)) };
  }, [d]);
  const routeFloor = focus ?? (d.scenario === "fire" ? fireFloor : d.stories - 1);
  const labelScale = focus != null ? geo.labelScale * 0.55 : geo.labelScale;
  const dark = d.scenario === "blackout";
  const [pos, tgt] = geo.frame.building;
  return <Canvas dpr={[1, 1.75]} camera={{ position: pos, fov: 40, near: 0.5, far: 6000 }} gl={{ antialias: true }}>
    <color attach="background" args={[dark ? "#07080b" : "#0b0e11"]} />
    <fog attach="fog" args={[dark ? "#07080b" : "#0b0e11", geo.radius * 4, geo.radius * 12]} />
    <ambientLight intensity={dark ? 0.35 : 0.9} />
    <hemisphereLight args={["#cfe3ff", "#0b0e11", dark ? 0.25 : 0.6]} />
    <directionalLight position={[geo.radius, geo.radius * 2, geo.radius * 0.6]} intensity={dark ? 0.35 : 1.4} />
    <Ground ground={d.ground} />
    <Others rings={d.others} />
    {d.buildings.map((b, bi) => <Floors key={bi} d={d} b={b} focus={focus} fireFloor={fireFloor} onPick={onPick} onPlaceFire={onPlaceFire} />)}
    <Fire d={d} fireFloor={fireFloor} focus={focus} labelScale={labelScale} />
    <Stairs d={d} focus={focus} labelScale={labelScale} />
    <Routes d={d} floor={routeFloor} labelScale={labelScale} />
    <People agents={d.agents} clock={clock} focus={focus} floorHeight={d.floorHeight} />
    <Water show={d.scenario === "flood"} />
    <OrbitControls makeDefault target={tgt} enableDamping dampingFactor={0.08} zoomToCursor screenSpacePanning
      maxPolarAngle={Math.PI * 0.49} minDistance={4} maxDistance={geo.radius * 10} rotateSpeed={0.7} zoomSpeed={1.1} panSpeed={0.9} />
    <CameraRig view={view} frame={geo.frame} />
  </Canvas>;
}

export default memo(TwinScene);
