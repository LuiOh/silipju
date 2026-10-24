// 국토부 매매·전월세 실거래 수집과 세안고 재판별 작업(배치 CLI와 /api/molit/sync가 함께 쓴다)

import type { Db } from "@/lib/db/client";
import { distinctLawdCodes, findRents, finishRun, loadListings, saveClassifications, startRun, upsertRents, upsertTrades } from "@/lib/db/repo";
import { fetchRentMonth, fetchTradeMonth, monthsBack } from "@/lib/molit";
import { classifyAll } from "@/lib/seango/classify-all";
import type { LeaseHint } from "@/lib/seango/classifier";
import type { MolitSyncCounts, MolitSyncResult } from "@/lib/types";

export type JobResult<S extends object = object> = { status: "ok" | "skipped"; stats: S };
export type Logger = (msg: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runJob<R extends JobResult>(db: Db, job: string, fn: () => Promise<R>): Promise<R> {
  const id = startRun(db, job);
  try {
    const r = await fn();
    finishRun(db, id, r.status, r.stats);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    finishRun(db, id, "error", {}, msg);
    throw e;
  }
}

export function lawdTargets(db: Db, raw = ""): string[] {
  if (raw) return raw.split(",").map((s) => s.trim()).filter((s) => /^\d{5}$/.test(s));
  return distinctLawdCodes(db);
}

export type MolitStats = MolitSyncCounts & { lawdCodes: number; months: number };

export async function collectMolit(
  db: Db,
  opts: {
    kind: "trades" | "rents";
    months: number;
    targets: string[];
    serviceKey: string | null;
    log: Logger;
    warn?: Logger;
  },
): Promise<JobResult<MolitStats>> {
  const { kind, months, targets, serviceKey, log } = opts;
  const warn = opts.warn ?? log;
  const stats: MolitStats = { lawdCodes: targets.length, months, requests: 0, fetched: 0, inserted: 0, errors: 0 };
  if (!serviceKey) {
    log("국토부 서비스키가 없어 국토부 수집을 건너뜁니다(앱의 API 설정 또는 .env.local의 MOLIT_SERVICE_KEY).");
    return { status: "skipped", stats };
  }
  if (targets.length === 0) {
    log("수집할 시군구가 없습니다. 먼저 매물을 적재하거나 --lawd 41135처럼 지정하세요.");
    return { status: "skipped", stats };
  }
  for (const lawd of targets) {
    for (const ym of monthsBack(months)) {
      stats.requests++;
      try {
        if (kind === "trades") {
          const rows = await fetchTradeMonth(lawd, ym, serviceKey);
          stats.fetched += rows.length;
          stats.inserted += upsertTrades(db, rows);
        } else {
          const rows = await fetchRentMonth(lawd, ym, serviceKey);
          stats.fetched += rows.length;
          stats.inserted += upsertRents(db, rows);
        }
      } catch (e) {
        stats.errors++;
        warn(`${kind} ${lawd} ${ym} 실패: ${e instanceof Error ? e.message : String(e)}`);
        if (stats.errors >= 3 && stats.errors === stats.requests) throw new Error("연속 실패로 중단합니다. 서비스키와 활용신청 상태를 확인하세요.");
      }
      await sleep(150);
    }
    log(`${kind === "trades" ? "매매" : "전월세"} ${lawd}: 누적 수신 ${stats.fetched.toLocaleString()}건, 신규 ${stats.inserted.toLocaleString()}건`);
  }
  return { status: "ok", stats };
}

export type ClassifyStats = { units: number; seango: number; suspect: number; leasesComplexes: number; gapGroups: number };
export type ComplexSummaryRow = { 단지: string; 매물: number; 세안고: number; 의심: number; 실입주: number; 불명: number };

export async function classifyListings(db: Db, log: Logger, onSummary?: (rows: ComplexSummaryRow[]) => void): Promise<JobResult<ClassifyStats>> {
  const { complexes, units } = loadListings(db);
  const leases = new Map<string, LeaseHint[]>();
  for (const c of complexes) {
    if (!c.region.lawdCd) continue;
    const rows = findRents(db, c.region.lawdCd, c.name);
    if (rows.length > 0) leases.set(c.id, rows);
  }
  const { results, peerAll, peerMoveIn } = classifyAll(units, { now: new Date(), acceptMoveInWithinMonths: 3 }, leases);
  saveClassifications(
    db,
    [...results.entries()].map(([unitId, r]) => ({ unitId, status: r.status, probability: r.probability, summary: r.summary })),
  );

  const byComplex = new Map<string, ComplexSummaryRow>();
  for (const u of units) {
    const r = results.get(u.id);
    if (!r) continue;
    const name = complexes.find((c) => c.id === u.complexId)?.name ?? u.complexId;
    const row = byComplex.get(u.complexId) ?? { 단지: name, 매물: 0, 세안고: 0, 의심: 0, 실입주: 0, 불명: 0 };
    row.매물++;
    if (r.status === "seango") row.세안고++;
    else if (r.status === "suspect") row.의심++;
    else if (r.status === "movein") row.실입주++;
    else row.불명++;
    byComplex.set(u.complexId, row);
  }
  if (byComplex.size > 0) onSummary?.([...byComplex.values()]);

  let gapGroups = 0;
  for (const [k, prices] of peerAll) {
    const moveIn = (peerMoveIn.get(k) ?? []).map((p) => p.price);
    if (moveIn.length > 0 && Math.min(...prices) < Math.min(...moveIn)) gapGroups++;
  }
  const seango = [...results.values()].filter((r) => r.status === "seango").length;
  const suspect = [...results.values()].filter((r) => r.status === "suspect").length;
  log(`판별 완료: 매물 그룹 ${results.size} · 세안고 ${seango} · 의심 ${suspect} · 최저가가 세안고인 평형 ${gapGroups}곳`);
  return { status: "ok", stats: { units: results.size, seango, suspect, leasesComplexes: leases.size, gapGroups } };
}

const MAX_WARNINGS = 20;

/** 앱 화면용: DB에 있는 단지의 시군구를 매매·전월세 모두 수집한 뒤 세안고를 다시 판별한다 */
export async function syncMolitForApp(db: Db, serviceKey: string, months = 12): Promise<MolitSyncResult> {
  const targets = lawdTargets(db);
  const warnings: string[] = [];
  const warn: Logger = (msg) => warnings.push(msg);
  const quiet: Logger = () => {};
  const base = { lawdCodes: targets.length, months, trades: null, rents: null, classified: null };
  const finish = (r: Omit<MolitSyncResult, "warnings">): MolitSyncResult => ({
    ...r,
    warnings: warnings.length > MAX_WARNINGS ? [...warnings.slice(0, MAX_WARNINGS), `외 ${warnings.length - MAX_WARNINGS}건 더 실패했습니다.`] : warnings,
  });
  if (targets.length === 0) {
    return finish({ ...base, ok: false, message: "DB에 실매물 단지가 없어 가져올 시군구가 없습니다. 먼저 실매물을 수집하세요." });
  }
  const pick = ({ requests, fetched, inserted, errors }: MolitStats): MolitSyncCounts => ({ requests, fetched, inserted, errors });
  let trades: MolitSyncCounts | null = null;
  let rents: MolitSyncCounts | null = null;
  try {
    trades = pick((await runJob(db, "trades", () => collectMolit(db, { kind: "trades", months, targets, serviceKey, log: quiet, warn }))).stats);
    rents = pick((await runJob(db, "rents", () => collectMolit(db, { kind: "rents", months, targets, serviceKey, log: quiet, warn }))).stats);
    const c = (await runJob(db, "classify", () => classifyListings(db, quiet))).stats;
    const classified = { units: c.units, seango: c.seango, suspect: c.suspect };
    const failed = trades.errors + rents.errors;
    return finish({
      ...base,
      ok: true,
      trades,
      rents,
      classified,
      message: `시군구 ${targets.length}곳 최근 ${months}개월을 가져왔습니다. 매매 신규 ${trades.inserted.toLocaleString()}건, 전월세 신규 ${rents.inserted.toLocaleString()}건이고 세안고 ${classified.seango}건, 의심 ${classified.suspect}건으로 다시 판별했습니다.${failed > 0 ? ` ${failed}개 요청은 실패했습니다.` : ""}`,
    });
  } catch (e) {
    return finish({ ...base, trades, rents, ok: false, message: e instanceof Error ? e.message : String(e) });
  }
}
