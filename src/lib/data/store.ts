// 웹 서버용 저장소: SQLite에 쌓인 실데이터와 샘플 데이터를 합친 메모리 스냅샷(배치가 DB를 바꾸면 자동 갱신)

import { createHash } from "node:crypto";
import type { CollectedComplex, Complex, ImportResult, ListingUnit, RealTrade } from "@/lib/types";
import type { LeaseHint } from "@/lib/seango/classifier";
import { dataVersion, getDb } from "@/lib/db/client";
import {
  clearListings,
  collectedComplexes,
  complexesMissingHouseholds,
  counts,
  findRents,
  loadListings,
  pruneUnseenInRegions,
  recordPayload,
  upsertComplexInfo,
  upsertListings,
  type RegionName,
} from "@/lib/db/repo";
import { generateDemoData } from "./demo";
import { parseNaverPayloads } from "./naver-import";

// 스냅샷 필드 구성이 바뀌면 올린다. globalThis 캐시는 dev 핫리로드 뒤에도 남아 예전 구조를 계속 쓰기 때문
const STORE_REVISION = 2;

interface StoreState {
  revision: number;
  version: number;
  complexes: Map<string, Complex>;
  units: ListingUnit[];
  demoTrades: Map<string, RealTrade[]>;
  leases: Map<string, LeaseHint[]>;
  demoEnabled: boolean;
  importedComplexes: number;
  realUnits: number;
}

const g = globalThis as unknown as { __silipjuStore?: StoreState; __silipjuDemo?: ReturnType<typeof generateDemoData> };

function demoData() {
  g.__silipjuDemo ??= generateDemoData();
  return g.__silipjuDemo;
}

function build(): StoreState {
  const db = getDb();
  const version = dataVersion(db);
  const real = loadListings(db);
  const demoEnabled = process.env.SILIPJU_DEMO !== "off";
  const complexes = new Map<string, Complex>();
  const units: ListingUnit[] = [];
  if (demoEnabled) {
    for (const c of demoData().complexes) complexes.set(c.id, c);
    units.push(...demoData().units);
  }
  for (const c of real.complexes) complexes.set(c.id, c);
  units.push(...real.units);

  const leases = new Map<string, LeaseHint[]>();
  for (const c of real.complexes) {
    if (!c.region.lawdCd) continue;
    const rows = findRents(db, c.region.lawdCd, c.name);
    if (rows.length > 0) leases.set(c.id, rows);
  }
  return {
    revision: STORE_REVISION,
    version,
    complexes,
    units,
    demoTrades: demoData().trades,
    leases,
    demoEnabled,
    importedComplexes: real.complexes.length,
    realUnits: real.units.length,
  };
}

export function getStore(): StoreState {
  const current = g.__silipjuStore;
  if (!current || current.revision !== STORE_REVISION || current.version !== dataVersion(getDb())) g.__silipjuStore = build();
  return g.__silipjuStore!;
}

function invalidate(): void {
  g.__silipjuStore = undefined;
}

export interface ImportOutcome {
  accepted: boolean;
  result: ImportResult;
}

/** 목록·상세·HAR 어느 것이든 받아 DB에 누적한다. result는 DB 전체 기준 집계 */
export function importPayload(payload: unknown, source: string, rawText: string): ImportOutcome {
  const db = getDb();
  const parsed = parseNaverPayloads([payload]);
  const accepted = parsed.units.length > 0 || parsed.details.length > 0 || parsed.complexInfos.length > 0;
  if (accepted) {
    if (parsed.complexInfos.length > 0) upsertComplexInfo(db, parsed.complexInfos);
    if (parsed.units.length > 0 || parsed.details.length > 0) {
      upsertListings(db, parsed.complexes, parsed.units, parsed.details);
      const sha = createHash("sha256").update(rawText).digest("hex");
      recordPayload(db, sha, source, Buffer.byteLength(rawText), parsed.units.length, parsed.details.length);
    }
    invalidate();
  } else {
    parsed.warnings.push("매매(A1) 매물 그룹이나 매물 상세를 찾지 못했습니다. complex/article/list 응답, 상세 페이지, HAR 파일인지 확인하세요.");
  }
  const c = counts(db);
  return {
    accepted,
    result: { complexes: c.complexes, units: c.units, ads: c.ads, enrichedAds: c.adDetails, warnings: parsed.warnings },
  };
}

export function clearImported(): void {
  clearListings(getDb());
  invalidate();
}

export function pruneUnseen(since: string, regions: RegionName[]) {
  const removed = pruneUnseenInRegions(getDb(), since, regions);
  invalidate();
  return removed;
}

export function missingHouseholds(regions: RegionName[]) {
  return complexesMissingHouseholds(getDb(), regions);
}

export function importedComplexCount(): number {
  return getStore().importedComplexes;
}

export function realDataSummary(): { complexes: number; units: number } {
  const s = getStore();
  return { complexes: s.importedComplexes, units: s.realUnits };
}

export function listCollected(): CollectedComplex[] {
  return collectedComplexes(getDb());
}
