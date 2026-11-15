"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { peopleAt, TIER_COLOR, type BuildingRow } from "../lib/dossier";
import { distanceMeters, type Incident } from "../lib/incident";
import { scenarioScore, SCENARIOS, type Scenario } from "../lib/scenario";

type Props = {
  browse?: boolean;
  buildings: BuildingRow[];
  hour: number;
  focus: { lat: number; lon: number; zoom: number };
  onSelect: (b: BuildingRow) => void;
  highlight?: number | null;
  incident?: Incident | null;
  incidentMode?: boolean;
  onPlaceIncident?: (lat: number, lon: number) => void;
  scenario?: Scenario;
};

// Circle area tracks how many people are inside at the selected hour.
const radius = (n: number) => Math.max(2.5, Math.min(16, Math.sqrt(n) * 0.3));

export default function BuildingMap({ buildings, hour, focus, onSelect, highlight, incident = null, incidentMode = false, onPlaceIncident, scenario = "fire", browse = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<number, Leaflet.CircleMarker>());
  const L = useRef<typeof Leaflet | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  // Latest props for draws that run after async map setup.
  const latest = useRef({ buildings, hour, incident, incidentMode, onPlaceIncident, scenario });
  latest.current = { buildings, hour, incident, incidentMode, onPlaceIncident, scenario };
  const incidentLayer = useRef<Leaflet.LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then(mod => {
      if (cancelled || !host.current || map.current) return;
      L.current = mod;
      map.current = mod.map(host.current, { preferCanvas: !browse, zoomControl: true, attributionControl: true })
        .setView([focus.lat, focus.lon], focus.zoom);
      mod.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, className: "darkTiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map.current);
      layer.current = mod.layerGroup().addTo(map.current);
      incidentLayer.current = mod.layerGroup().addTo(map.current);
      map.current.on("click", e => {
        const { incidentMode, onPlaceIncident } = latest.current;
        if (incidentMode) onPlaceIncident?.(e.latlng.lat, e.latlng.lng);
      });
      // The canvas renderer sizes itself from the container, so wait for layout before drawing
      // and resize the map whenever its card changes size.
      const m = map.current;
      requestAnimationFrame(() => { if (map.current === m) { m.invalidateSize(); draw(); } });
      observer = new ResizeObserver(() => map.current?.invalidateSize());
      observer.observe(host.current);
    });
    let observer: ResizeObserver | undefined;
    return () => { cancelled = true; observer?.disconnect(); map.current?.remove(); map.current = null; markers.current.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const mod = L.current, group = layer.current;
    if (!mod || !group) return;
    const { buildings, hour, scenario } = latest.current;
    const tierFor = (b: BuildingRow) => scenarioScore(b, scenario, hour).tier;
    group.clearLayers();
    markers.current.clear();
    // Draw low-priority first so high-priority buildings sit on top.
    for (const b of [...buildings].sort((a, z) => scenarioScore(a, scenario, hour).score - scenarioScore(z, scenario, hour).score)) {
      const m = mod.circleMarker([b.lat, b.lon], {
        radius: radius(peopleAt(b, hour)) * (browse ? 1.35 : 1), color: TIER_COLOR[tierFor(b)], weight: browse ? 1.3 : 1,
        fillColor: TIER_COLOR[tierFor(b)], fillOpacity: 0.38, opacity: 0.85, bubblingMouseEvents: false,
      });
      m.bindTooltip(browse ? `<b>${escape(b.name)}</b><br>${tierFor(b)} ${scenario} priority` : tip(b, hour, scenario), { direction: "top", className: "mapTip" });
      m.on("click", () => {
        const { incidentMode, onPlaceIncident } = latest.current;
        if (incidentMode) onPlaceIncident?.(b.lat, b.lon); else select.current(b);
      });
      m.addTo(group);
      markers.current.set(b.id, m);
    }
    drawIncident();
    // Leaflet's canvas renderer can skip its first paint; a moveend makes it repaint every path.
    requestAnimationFrame(() => map.current?.fire("moveend"));
  }

  // Incident pin, search radius, and dimming of buildings outside it.
  function drawIncident() {
    const mod = L.current, group = incidentLayer.current;
    if (!mod || !group) return;
    const { buildings, incident, scenario } = latest.current;
    const accent = SCENARIOS[scenario].accent;
    group.clearLayers();
    for (const b of buildings) {
      const m = markers.current.get(b.id);
      if (!m) continue;
      const inside = !incident || distanceMeters(incident.lat, incident.lon, b.lat, b.lon) <= incident.radius;
      m.setStyle(inside ? { fillOpacity: incident ? 0.6 : 0.38, opacity: 0.9 } : { fillOpacity: 0.06, opacity: 0.15 });
    }
    if (!incident) return;
    mod.circle([incident.lat, incident.lon], {
      radius: incident.radius, color: accent, weight: 2, dashArray: "6 6", fillColor: accent, fillOpacity: 0.07, interactive: false,
    }).addTo(group);
    mod.marker([incident.lat, incident.lon], {
      icon: mod.divIcon({ className: "incidentPin", html: `<i style="border-color:${accent}"></i><b style="background:${accent}"></b>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false, keyboard: false,
    }).addTo(group);
  }

  useEffect(draw, [buildings, scenario]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(drawIncident, [incident, buildings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { host.current?.classList.toggle("placing", incidentMode); }, [incidentMode]);

  useEffect(() => {
    for (const b of buildings) {
      const m = markers.current.get(b.id);
      m?.setRadius(radius(peopleAt(b, hour)) * (browse ? 1.35 : 1));
      // Sleeping occupancy changes with the hour, so tiers (and colors) can too.
      const c = TIER_COLOR[scenarioScore(b, latest.current.scenario, hour).tier];
      m?.setStyle({ color: c, fillColor: c });
      m?.setTooltipContent(browse ? `<b>${escape(b.name)}</b><br>${scenarioScore(b,scenario,hour).tier} ${scenario} priority` : tip(b, hour, scenario));
    }
  }, [hour, buildings, scenario, browse]);

  useEffect(() => { map.current?.flyTo([focus.lat, focus.lon], focus.zoom, { duration: 0.8 }); }, [focus]);

  useEffect(() => {
    if (highlight == null) return;
    const m = markers.current.get(highlight);
    if (m) { m.setStyle({ weight: 3, color: "#ffffff" }); m.bringToFront(); }
    return () => { const b = buildings.find(x => x.id === highlight); if (m && b) m.setStyle({ weight: 1, color: TIER_COLOR[scenarioScore(b, scenario, latest.current.hour).tier] }); };
  }, [highlight, buildings, scenario]);

  return <div ref={host} className="mapHost" role="application" aria-label={browse ? "Choose a building on the map" : "Map of buildings sized by estimated people inside"} />;
}

function tip(b: BuildingRow, hour: number, scenario: Scenario) {
  const s = scenarioScore(b, scenario, hour);
  return `<b>${escape(b.name)}</b><br>${b.type} · ${s.tier} ${SCENARIOS[scenario].verb} priority (${s.score})<br>${peopleAt(b, hour).toLocaleString()} people at this hour (est.)`;
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
