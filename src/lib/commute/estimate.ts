// API 키 없이 역 좌표·노선 테이블로 대중교통·자가용 통근시간을 근사 추정

import type { CommuteLeg, CommuteMode, CommuteRoute, GeoPoint, Workplace } from "@/lib/types";
import { buildRouteLinks } from "./links";
import { LINE_COLOR, LINE_SPEED, STATIONS, type Station } from "./stations";

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const WALK_KMH = 4.5;
const WALK_DETOUR = 1.3;
const FEEDER_BUS_KMH = 18;
const RAIL_DETOUR = 1.25;
const TRANSFER_MIN = 6;
const PLATFORM_WAIT_MIN = 4;
const WALK_LIMIT_KM = 1.0;

interface Access {
  minutes: number;
  leg: CommuteLeg;
}

function accessLeg(from: GeoPoint, fromName: string, st: Station, toStation: boolean): Access {
  const km = haversineKm(from, st);
  if (km <= WALK_LIMIT_KM) {
    const minutes = Math.max(2, (km * WALK_DETOUR * 60) / WALK_KMH);
    return {
      minutes,
      leg: {
        mode: "WALK",
        label: `도보 ${Math.round(minutes)}분`,
        minutes,
        from: toStation ? fromName : `${st.name}역`,
        to: toStation ? `${st.name}역` : fromName,
        color: null,
      },
    };
  }
  const minutes = 5 + Math.max(4, (km * 1.4 * 60) / FEEDER_BUS_KMH);
  return {
    minutes,
    leg: {
      mode: "BUS",
      label: `마을·시내버스 약 ${Math.round(minutes)}분(대기 포함)`,
      minutes,
      from: toStation ? fromName : `${st.name}역`,
      to: toStation ? `${st.name}역` : fromName,
      color: "#3cc344",
    },
  };
}

function nearestStations(p: GeoPoint, maxKm: number, count: number): Station[] {
  return STATIONS.map((s) => ({ s, d: haversineKm(p, s) }))
    .filter((x) => x.d <= maxKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((x) => x.s);
}

function fastestCommonLine(a: Station, b: Station): string | null {
  const common = a.lines.filter((l) => b.lines.includes(l));
  if (common.length === 0) return null;
  return common.sort((x, y) => (LINE_SPEED[y] ?? 30) - (LINE_SPEED[x] ?? 30))[0];
}

function railMinutes(a: GeoPoint, b: GeoPoint, line: string): number {
  return (haversineKm(a, b) * RAIL_DETOUR * 60) / (LINE_SPEED[line] ?? 30) + 1.5;
}

interface RailPlan {
  minutes: number;
  transfers: number;
  legs: CommuteLeg[];
}

function railPlan(o: Station, d: Station): RailPlan | null {
  const direct = fastestCommonLine(o, d);
  if (direct) {
    const m = railMinutes(o, d, direct);
    return {
      minutes: m,
      transfers: 0,
      legs: [{ mode: "SUBWAY", label: direct, minutes: m, from: `${o.name}역`, to: `${d.name}역`, color: LINE_COLOR[direct] ?? null }],
    };
  }
  let best: RailPlan | null = null;
  for (const t of STATIONS) {
    if (t === o || t === d) continue;
    const l1 = fastestCommonLine(o, t);
    const l2 = fastestCommonLine(t, d);
    if (!l1 || !l2) continue;
    const m1 = railMinutes(o, t, l1);
    const m2 = railMinutes(t, d, l2);
    const total = m1 + m2 + TRANSFER_MIN;
    if (!best || total < best.minutes) {
      best = {
        minutes: total,
        transfers: 1,
        legs: [
          { mode: "SUBWAY", label: l1, minutes: m1, from: `${o.name}역`, to: `${t.name}역`, color: LINE_COLOR[l1] ?? null },
          { mode: "TRANSFER", label: `${t.name}역 환승`, minutes: TRANSFER_MIN, from: null, to: null, color: null },
          { mode: "SUBWAY", label: l2, minutes: m2, from: `${t.name}역`, to: `${d.name}역`, color: LINE_COLOR[l2] ?? null },
        ],
      };
    }
  }
  if (best) return best;
  const m = (haversineKm(o, d) * 1.45 * 60) / 30 + 2 * TRANSFER_MIN + 2;
  return {
    minutes: m,
    transfers: 2,
    legs: [{ mode: "SUBWAY", label: "지하철(2회 이상 환승)", minutes: m, from: `${o.name}역`, to: `${d.name}역`, color: null }],
  };
}

function summarizeLegs(legs: CommuteLeg[]): string {
  return legs
    .filter((l) => l.mode !== "TRANSFER")
    .map((l) => (l.mode === "WALK" ? "도보" : l.mode === "BUS" ? "버스" : l.mode === "CAR" ? "자가용" : l.label))
    .join(" → ");
}

export function estimateTransit(origin: GeoPoint, originName: string, w: Workplace): Omit<CommuteRoute, "links"> {
  const directKm = haversineKm(origin, w.location);
  const base = { workplaceId: w.id, workplaceLabel: w.label, mode: "transit" as const, source: "estimate" as const, fare: null };
  if (directKm <= 1.2) {
    const minutes = (directKm * WALK_DETOUR * 60) / WALK_KMH;
    const legs: CommuteLeg[] = [{ mode: "WALK", label: `도보 ${Math.round(minutes)}분`, minutes, from: originName, to: w.label, color: null }];
    return { ...base, minutes: Math.round(minutes), transfers: 0, walkMinutes: Math.round(minutes), distanceKm: directKm, legs, summary: "도보" };
  }

  let best: { minutes: number; transfers: number; walk: number; legs: CommuteLeg[] } | null = null;
  for (const so of nearestStations(origin, 4, 3)) {
    for (const sd of nearestStations(w.location, 3, 3)) {
      if (so === sd) continue;
      const plan = railPlan(so, sd);
      if (!plan) continue;
      const a = accessLeg(origin, originName, so, true);
      const e = accessLeg(w.location, w.label, sd, false);
      const total = a.minutes + PLATFORM_WAIT_MIN + plan.minutes + e.minutes;
      if (!best || total < best.minutes) {
        const walk = (a.leg.mode === "WALK" ? a.minutes : 0) + (e.leg.mode === "WALK" ? e.minutes : 0);
        best = { minutes: total, transfers: plan.transfers, walk, legs: [a.leg, ...plan.legs, e.leg] };
      }
    }
  }

  const busOnly = (directKm * 1.4 * 60) / 20 + 10;
  if (!best || busOnly < best.minutes * 0.85) {
    const legs: CommuteLeg[] = [
      { mode: "BUS", label: `버스 약 ${Math.round(busOnly)}분(추정)`, minutes: busOnly, from: originName, to: w.label, color: "#386de8" },
    ];
    return { ...base, minutes: Math.round(busOnly), transfers: null, walkMinutes: null, distanceKm: directKm, legs, summary: "버스" };
  }
  return {
    ...base,
    minutes: Math.round(best.minutes),
    transfers: best.transfers,
    walkMinutes: Math.round(best.walk),
    distanceKm: directKm,
    legs: best.legs.map((l) => ({ ...l, minutes: Math.round(l.minutes) })),
    summary: summarizeLegs(best.legs),
  };
}

export function estimateCar(origin: GeoPoint, originName: string, w: Workplace): Omit<CommuteRoute, "links"> {
  const km = haversineKm(origin, w.location) * 1.3;
  const speed = km < 10 ? 26 : km < 25 ? 34 : 45;
  const minutes = Math.round((km / speed) * 60 + 5);
  return {
    workplaceId: w.id,
    workplaceLabel: w.label,
    mode: "car",
    minutes,
    transfers: null,
    walkMinutes: null,
    fare: null,
    distanceKm: Math.round(km * 10) / 10,
    legs: [{ mode: "CAR", label: `자가용 약 ${Math.round(km)}km`, minutes, from: originName, to: w.label, color: "#555" }],
    summary: "자가용(출근 시간대 평균속도 추정)",
    source: "estimate",
  };
}

export function estimateCommute(
  origin: GeoPoint,
  originName: string,
  w: Workplace,
  mode: CommuteMode,
  appUrl: string,
): CommuteRoute {
  const r = mode === "car" ? estimateCar(origin, originName, w) : estimateTransit(origin, originName, w);
  return { ...r, links: buildRouteLinks(origin, originName, w.location, w.label, mode, appUrl) };
}
