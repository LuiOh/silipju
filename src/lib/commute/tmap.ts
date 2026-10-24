// TMAP 대중교통·자동차 경로 API 어댑터(서버 전용, 결과는 약관에 따라 24시간 이내만 캐시)

import type { CommuteLeg, CommuteLegMode, CommuteMode, CommuteRoute, GeoPoint, Workplace } from "@/lib/types";
import { getApiKey } from "@/lib/settings";
import { buildRouteLinks } from "./links";

const TRANSIT_URL = "https://apis.openapi.sk.com/transit/routes";
const CAR_URL = "https://apis.openapi.sk.com/tmap/routes?version=1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; route: CommuteRoute }>();

export function tmapAvailable(): boolean {
  return !!getApiKey("tmap");
}

interface TransitLeg {
  mode: string;
  route?: string;
  routeColor?: string;
  sectionTime: number;
  start?: { name?: string };
  end?: { name?: string };
}

interface TransitItinerary {
  totalTime: number;
  transferCount: number;
  totalWalkTime: number;
  totalDistance: number;
  fare?: { regular?: { totalFare?: number } };
  legs: TransitLeg[];
}

const LEG_MODE: Record<string, CommuteLegMode> = {
  WALK: "WALK",
  BUS: "BUS",
  SUBWAY: "SUBWAY",
  EXPRESSBUS: "BUS",
  TRAIN: "TRAIN",
};

export class TmapError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

async function postJson(url: string, body: unknown, appKey = getApiKey("tmap") ?? ""): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { appKey, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json as { result?: { message?: string }; error?: { message?: string; code?: string } } | null;
    const msg = err?.result?.message ?? err?.error?.message ?? `HTTP ${res.status}`;
    throw new TmapError(`TMAP 오류: ${msg}`, res.status, err?.error?.code ?? null);
  }
  return json;
}

type CarProps = { totalTime?: number; totalDistance?: number; taxiFare?: number; totalFare?: number };

export async function tmapCarRoute(origin: GeoPoint, dest: GeoPoint, appKey?: string): Promise<CarProps> {
  const json = (await postJson(
    CAR_URL,
    {
      startX: origin.lng,
      startY: origin.lat,
      endX: dest.lng,
      endY: dest.lat,
      reqCoordType: "WGS84GEO",
      resCoordType: "WGS84GEO",
      searchOption: "0",
      trafficInfo: "Y",
      totalValue: 2,
    },
    appKey,
  )) as { features?: { properties?: CarProps }[] };
  const props = json.features?.[0]?.properties;
  if (!props?.totalTime) throw new TmapError("자동차 경로 없음", 404);
  return props;
}

function legLabel(l: TransitLeg): string {
  if (l.mode === "WALK") return `도보 ${Math.round(l.sectionTime / 60)}분`;
  return l.route ?? l.mode;
}

export async function tmapRoute(
  origin: GeoPoint,
  originName: string,
  w: Workplace,
  mode: CommuteMode,
  appUrl: string,
): Promise<CommuteRoute> {
  const key = `${mode}:${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}:${w.location.lat.toFixed(5)},${w.location.lng.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.route, workplaceId: w.id, workplaceLabel: w.label };

  const links = buildRouteLinks(origin, originName, w.location, w.label, mode, appUrl);
  let route: CommuteRoute;
  if (mode === "transit") {
    const json = (await postJson(TRANSIT_URL, {
      startX: String(origin.lng),
      startY: String(origin.lat),
      endX: String(w.location.lng),
      endY: String(w.location.lat),
      count: 5,
      lang: 0,
      format: "json",
    })) as { metaData?: { plan?: { itineraries?: TransitItinerary[] } }; result?: { message?: string } };
    const its = json.metaData?.plan?.itineraries ?? [];
    if (its.length === 0) throw new TmapError(json.result?.message ?? "대중교통 경로 없음", 404);
    const it = its.reduce((a, b) => (b.totalTime < a.totalTime ? b : a));
    const legs: CommuteLeg[] = it.legs.map((l) => ({
      mode: LEG_MODE[l.mode] ?? "BUS",
      label: legLabel(l),
      minutes: Math.round(l.sectionTime / 60),
      from: l.start?.name ?? null,
      to: l.end?.name ?? null,
      color: l.routeColor ? `#${l.routeColor.replace(/^#/, "")}` : null,
    }));
    route = {
      workplaceId: w.id,
      workplaceLabel: w.label,
      mode,
      minutes: Math.round(it.totalTime / 60),
      transfers: it.transferCount,
      walkMinutes: Math.round(it.totalWalkTime / 60),
      fare: it.fare?.regular?.totalFare ?? null,
      distanceKm: Math.round(it.totalDistance / 100) / 10,
      legs,
      summary: legs.filter((l) => l.mode !== "WALK").map((l) => l.label).join(" → ") || "도보",
      source: "tmap",
      links,
    };
  } else {
    const props = await tmapCarRoute(origin, w.location);
    const minutes = Math.round((props.totalTime ?? 0) / 60);
    route = {
      workplaceId: w.id,
      workplaceLabel: w.label,
      mode,
      minutes,
      transfers: null,
      walkMinutes: null,
      fare: props.totalFare ?? null,
      distanceKm: Math.round((props.totalDistance ?? 0) / 100) / 10,
      legs: [{ mode: "CAR", label: `자가용 ${Math.round((props.totalDistance ?? 0) / 1000)}km`, minutes, from: originName, to: w.label, color: "#555" }],
      summary: `자가용(실시간 교통 반영)${props.taxiFare ? ` · 택시 약 ${props.taxiFare.toLocaleString()}원` : ""}`,
      source: "tmap",
      links,
    };
  }
  cache.set(key, { at: Date.now(), route });
  return route;
}
