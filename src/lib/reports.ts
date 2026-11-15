"use client";

import { useEffect, useState } from "react";
import type { BuildingRow, Factor } from "./dossier";

// Field verification reports (from /verify), kept next to the CoStar record and labelled as unverified.
export type FieldReport = { sprinklers?: { value: boolean; yes: number; no: number; at: string } };
export type Reports = Record<number, FieldReport>;

const applied = new WeakMap<object, Map<string, unknown>>();

/**
 * The building as HavenLens should score it given a field report. With no report the original object is returned,
 * so cached scores stay valid. A report replaces the "sprinklers unknown" (+10) or "no sprinklers" (+20) fire points.
 */
export function applyReport<T extends BuildingRow & { factors?: Factor[] }>(row: T, report?: FieldReport): T {
  const s = report?.sprinklers;
  if (!s) return row;
  let byKey = applied.get(row);
  if (!byKey) { byKey = new Map(); applied.set(row, byKey); }
  const key = `${s.value}:${s.at}`;
  const hit = byKey.get(key) as T | undefined;
  if (hit) return hit;
  const before = row.sprinklers === null ? 10 : row.sprinklers === false ? 20 : 0;
  const after = s.value ? 0 : 20;
  const factors = row.factors?.filter(f => f.label !== "Sprinkler status unknown" && f.label !== "No sprinklers recorded");
  if (factors && !s.value) factors.push({ points: 20, label: "No sprinklers (field report)", detail: `Reported on site ${new Date(s.at).toLocaleString()}; not yet verified`, kind: "risk" });
  const next = { ...row, sprinklers: s.value, score: Math.max(0, Math.min(100, row.score - before + after)), factors,
    flags: s.value ? row.flags.filter(f => f !== "nosprinklers") : row.flags.includes("nosprinklers") ? row.flags : [...row.flags, "nosprinklers"],
    fieldReport: s } as T;
  byKey.set(key, next);
  return next;
}

/** Field reports, polled so a phone's report shows up on the big screen within a few seconds. */
export function useReports(intervalMs = 3000) {
  const [reports, setReports] = useState<Reports>({});
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/reports", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).then(d => { if (alive) setReports(prev => JSON.stringify(prev) === JSON.stringify(d) ? prev : d); }).catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return reports;
}

export async function postReport(id: number, field: "sprinklers", value: boolean) {
  const r = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, field, value }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || "Could not save the report.");
  return body;
}

/** Origin a phone can reach (LAN address) when the app is opened on localhost. */
export function useShareOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    const here = window.location;
    setOrigin(here.origin);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(here.hostname)) return;
    fetch("/api/host").then(r => r.ok ? r.json() : null).then(h => { if (h?.lan) setOrigin(`${here.protocol}//${h.lan}${here.port ? ":" + here.port : ""}`); }).catch(() => {});
  }, []);
  return origin;
}
