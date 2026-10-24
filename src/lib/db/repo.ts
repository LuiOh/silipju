// 단지·매물·광고·상세보강·실거래·전월세·배치 실행 기록의 DB 읽기/쓰기

import type { CollectedComplex, Complex, ListingUnit, MovingInType, RealTrade, RealtorAd, SeangoStatus } from "@/lib/types";
import type { AdDetail, ComplexInfo } from "@/lib/data/naver-import";
import { resolveRegion } from "@/lib/finance/regions";
import { aptKey, sameApartment, type RentRow, type TradeRow } from "@/lib/molit";
import type { Db } from "./client";

const nowIso = () => new Date().toISOString();
const bool = (v: number | null) => (v === null ? null : v === 1);
const int = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

export interface UpsertStats {
  complexes: number;
  units: number;
  ads: number;
  details: number;
}

export function upsertListings(db: Db, complexes: Complex[], units: ListingUnit[], details: AdDetail[], seenAt = nowIso()): UpsertStats {
  const upComplex = db.prepare(`
    INSERT INTO complexes (id, source, name, lat, lng, address, sido, sigungu, households, approval_year, updated_at)
    VALUES (@id, @source, @name, @lat, @lng, @address, @sido, @sigungu,
            COALESCE(@households, (SELECT households FROM complex_info WHERE id = @id)), @approvalYear, @at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, lat = excluded.lat, lng = excluded.lng, address = excluded.address,
      sido = excluded.sido, sigungu = excluded.sigungu,
      households = COALESCE(excluded.households, complexes.households),
      approval_year = COALESCE(excluded.approval_year, complexes.approval_year),
      updated_at = excluded.updated_at`);
  const upUnit = db.prepare(`
    INSERT INTO units (id, complex_id, dong, floor_label, floor, total_floors, exclusive_area, supply_area, area_name,
                       room_count, direction, price, photo_url, first_seen_at, last_seen_at)
    VALUES (@id, @complexId, @dong, @floorLabel, @floor, @totalFloors, @exclusiveArea, @supplyArea, @areaName,
            @roomCount, @direction, @price, @photoUrl, @at, @at)
    ON CONFLICT(id) DO UPDATE SET
      dong = excluded.dong, floor_label = excluded.floor_label, floor = excluded.floor, total_floors = excluded.total_floors,
      exclusive_area = excluded.exclusive_area, supply_area = excluded.supply_area, area_name = excluded.area_name,
      direction = excluded.direction, price = excluded.price, photo_url = COALESCE(excluded.photo_url, units.photo_url),
      last_seen_at = excluded.last_seen_at`);
  const upAd = db.prepare(`
    INSERT INTO ads (article_no, unit_id, realtor_name, cp_name, feature_text, verification_type, confirmed_at, last_seen_at)
    VALUES (@articleNo, @unitId, @realtorName, @cpName, @featureText, @verificationType, @confirmedAt, @at)
    ON CONFLICT(article_no) DO UPDATE SET
      unit_id = excluded.unit_id, realtor_name = excluded.realtor_name, cp_name = excluded.cp_name,
      feature_text = excluded.feature_text, verification_type = excluded.verification_type,
      confirmed_at = excluded.confirmed_at, last_seen_at = excluded.last_seen_at`);
  const upDetail = db.prepare(`
    INSERT INTO ad_details (article_no, description, feature_text, moving_in_type, moving_in_date, moving_in_negotiable,
                            previous_deposit, previous_monthly_rent, is_lease_hold, room_count, updated_at)
    VALUES (@articleNo, @description, @featureText, @movingInType, @movingInDate, @movingInNegotiable,
            @previousDeposit, @previousMonthlyRent, @isLeaseHold, @roomCount, @at)
    ON CONFLICT(article_no) DO UPDATE SET
      description = COALESCE(excluded.description, ad_details.description),
      feature_text = COALESCE(excluded.feature_text, ad_details.feature_text),
      moving_in_type = excluded.moving_in_type, moving_in_date = excluded.moving_in_date,
      moving_in_negotiable = excluded.moving_in_negotiable, previous_deposit = excluded.previous_deposit,
      previous_monthly_rent = excluded.previous_monthly_rent, is_lease_hold = excluded.is_lease_hold,
      room_count = COALESCE(excluded.room_count, ad_details.room_count), updated_at = excluded.updated_at`);
  const dropEmptyUnits = db.prepare(
    `DELETE FROM units WHERE complex_id = ? AND id NOT IN (SELECT DISTINCT unit_id FROM ads)`,
  );

  const run = db.transaction(() => {
    for (const c of complexes) {
      upComplex.run({
        id: c.id,
        source: c.source,
        name: c.name,
        lat: c.location.lat,
        lng: c.location.lng,
        address: c.address,
        sido: c.region.sido,
        sigungu: c.region.sigungu,
        households: c.households,
        approvalYear: c.approvalYear,
        at: seenAt,
      });
    }
    let ads = 0;
    for (const u of units) {
      upUnit.run({
        id: u.id,
        complexId: u.complexId,
        dong: u.dong,
        floorLabel: u.floorLabel,
        floor: u.floor,
        totalFloors: u.totalFloors,
        exclusiveArea: u.exclusiveArea,
        supplyArea: u.supplyArea,
        areaName: u.areaName,
        roomCount: u.roomCount,
        direction: u.direction,
        price: u.price,
        photoUrl: u.photoUrl,
        at: seenAt,
      });
      for (const a of u.ads) {
        upAd.run({
          articleNo: a.articleNo,
          unitId: u.id,
          realtorName: a.realtorName,
          cpName: a.cpName,
          featureText: a.featureText,
          verificationType: a.verificationType,
          confirmedAt: a.confirmedAt,
          at: seenAt,
        });
        ads++;
      }
    }
    for (const d of details) {
      upDetail.run({
        articleNo: d.articleNo,
        description: d.description,
        featureText: d.featureText,
        movingInType: d.movingIn?.type ?? null,
        movingInDate: d.movingIn?.date ?? null,
        movingInNegotiable: d.movingIn ? int(d.movingIn.negotiable) : null,
        previousDeposit: d.previousDeposit,
        previousMonthlyRent: d.previousMonthlyRent,
        isLeaseHold: int(d.isLeaseHold),
        roomCount: d.roomCount,
        at: seenAt,
      });
    }
    // 대표 광고가 바뀌어 그룹이 다시 묶이면 광고가 다른 매물로 옮겨가므로 빈 매물을 정리한다
    for (const id of new Set(units.map((u) => u.complexId))) dropEmptyUnits.run(id);
    return ads;
  });
  const ads = run();
  return { complexes: complexes.length, units: units.length, ads, details: details.length };
}

interface ComplexRow {
  id: string;
  source: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  sido: string;
  sigungu: string;
  households: number | null;
  approval_year: number | null;
  floor_area_ratio: number | null;
}

interface UnitRow {
  id: string;
  complex_id: string;
  dong: string | null;
  floor_label: string;
  floor: number | null;
  total_floors: number | null;
  exclusive_area: number;
  supply_area: number | null;
  area_name: string | null;
  room_count: number;
  direction: string | null;
  price: number;
  photo_url: string | null;
}

interface AdRow {
  article_no: string;
  unit_id: string;
  realtor_name: string;
  cp_name: string | null;
  feature_text: string;
  verification_type: string | null;
  confirmed_at: string | null;
  d_description: string | null;
  d_feature_text: string | null;
  moving_in_type: string | null;
  moving_in_date: string | null;
  moving_in_negotiable: number | null;
  previous_deposit: number | null;
  previous_monthly_rent: number | null;
  is_lease_hold: number | null;
  d_room_count: number | null;
}

export function loadListings(db: Db): { complexes: Complex[]; units: ListingUnit[] } {
  const complexes = (
    db.prepare(`SELECT c.*, i.floor_area_ratio FROM complexes c LEFT JOIN complex_info i ON i.id = c.id`).all() as ComplexRow[]
  ).map(
    (r): Complex => ({
      id: r.id,
      name: r.name,
      source: r.source === "demo" ? "demo" : "naver-import",
      location: { lat: r.lat, lng: r.lng },
      address: r.address,
      region: resolveRegion(r.sido, r.sigungu),
      households: r.households,
      approvalYear: r.approval_year,
      floorAreaRatio: r.floor_area_ratio,
    }),
  );
  const adRows = db
    .prepare(
      `SELECT a.article_no, a.unit_id, a.realtor_name, a.cp_name, a.feature_text, a.verification_type, a.confirmed_at,
              d.description AS d_description, d.feature_text AS d_feature_text, d.moving_in_type, d.moving_in_date,
              d.moving_in_negotiable, d.previous_deposit, d.previous_monthly_rent, d.is_lease_hold, d.room_count AS d_room_count
         FROM ads a LEFT JOIN ad_details d ON d.article_no = a.article_no`,
    )
    .all() as AdRow[];
  const adsByUnit = new Map<string, { ads: RealtorAd[]; rooms: number | null }>();
  for (const r of adRows) {
    const entry = adsByUnit.get(r.unit_id) ?? { ads: [], rooms: null };
    entry.ads.push({
      articleNo: r.article_no,
      realtorName: r.realtor_name,
      cpName: r.cp_name,
      featureText: r.d_feature_text ?? r.feature_text,
      description: r.d_description,
      movingIn:
        r.moving_in_type || r.moving_in_date
          ? { type: (r.moving_in_type as MovingInType | null) ?? null, date: r.moving_in_date, negotiable: r.moving_in_negotiable === 1 }
          : null,
      previousDeposit: r.previous_deposit,
      previousMonthlyRent: r.previous_monthly_rent,
      isLeaseHold: bool(r.is_lease_hold),
      verificationType: r.verification_type,
      confirmedAt: r.confirmed_at,
    });
    if (r.d_room_count) entry.rooms = r.d_room_count;
    adsByUnit.set(r.unit_id, entry);
  }
  const units = (db.prepare(`SELECT * FROM units`).all() as UnitRow[])
    .filter((r) => adsByUnit.has(r.id))
    .map((r): ListingUnit => {
      const entry = adsByUnit.get(r.id)!;
      return {
        id: r.id,
        complexId: r.complex_id,
        dong: r.dong,
        floorLabel: r.floor_label,
        floor: r.floor,
        totalFloors: r.total_floors,
        exclusiveArea: r.exclusive_area,
        supplyArea: r.supply_area,
        areaName: r.area_name,
        roomCount: entry.rooms ?? r.room_count,
        direction: r.direction,
        price: r.price,
        ads: entry.ads,
        photoUrl: r.photo_url,
      };
    });
  return { complexes, units };
}

export function upsertTrades(db: Db, rows: TradeRow[]): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO trades (lawd_cd, apt_name, apt_key, umd_name, jibun, exclusive_area, floor, price, deal_date, dealing_type)
    VALUES (@lawdCd, @aptName, @key, @umdName, @jibun, @exclusiveArea, @floor, @price, @dealDate, @dealingType)`);
  return db.transaction(() => rows.reduce((n, r) => n + stmt.run({ ...r, key: aptKey(r.aptName) }).changes, 0))();
}

export function upsertRents(db: Db, rows: RentRow[]): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO rents (lawd_cd, apt_name, apt_key, umd_name, jibun, exclusive_area, floor, deposit, monthly_rent,
                                 contract_date, contract_term, contract_type, use_rr_right)
    VALUES (@lawdCd, @aptName, @key, @umdName, @jibun, @exclusiveArea, @floor, @deposit, @monthlyRent,
            @contractDate, @contractTerm, @contractType, @useRRRight)`);
  return db.transaction(() => rows.reduce((n, r) => n + stmt.run({ ...r, key: aptKey(r.aptName) }).changes, 0))();
}

export function findTrades(db: Db, lawdCd: string, complexName: string): RealTrade[] {
  const rows = db
    .prepare(`SELECT apt_name, exclusive_area, floor, price, deal_date FROM trades WHERE lawd_cd = ? ORDER BY deal_date`)
    .all(lawdCd) as { apt_name: string; exclusive_area: number; floor: number | null; price: number; deal_date: string }[];
  return rows
    .filter((r) => sameApartment(r.apt_name, complexName))
    .map((r) => ({ date: r.deal_date, exclusiveArea: r.exclusive_area, floor: r.floor, price: r.price }));
}

export interface LeaseRecord {
  exclusiveArea: number;
  floor: number | null;
  deposit: number;
  monthlyRent: number;
  contractDate: string;
  contractTerm: string | null;
  contractType: string | null;
}

export function findRents(db: Db, lawdCd: string, complexName: string): LeaseRecord[] {
  const rows = db
    .prepare(
      `SELECT apt_name, exclusive_area, floor, deposit, monthly_rent, contract_date, contract_term, contract_type
         FROM rents WHERE lawd_cd = ? ORDER BY contract_date`,
    )
    .all(lawdCd) as {
    apt_name: string;
    exclusive_area: number;
    floor: number | null;
    deposit: number;
    monthly_rent: number;
    contract_date: string;
    contract_term: string | null;
    contract_type: string | null;
  }[];
  return rows
    .filter((r) => sameApartment(r.apt_name, complexName))
    .map((r) => ({
      exclusiveArea: r.exclusive_area,
      floor: r.floor,
      deposit: r.deposit,
      monthlyRent: r.monthly_rent,
      contractDate: r.contract_date,
      contractTerm: r.contract_term,
      contractType: r.contract_type,
    }));
}

export function saveClassifications(
  db: Db,
  rows: { unitId: string; status: SeangoStatus; probability: number; summary: string }[],
  at = nowIso(),
): void {
  const stmt = db.prepare(
    `UPDATE units SET seango_status = ?, seango_probability = ?, seango_summary = ?, classified_at = ? WHERE id = ?`,
  );
  db.transaction(() => {
    for (const r of rows) stmt.run(r.status, r.probability, r.summary, at, r.unitId);
  })();
}

export function pruneStale(db: Db, days: number, now = new Date()): { ads: number; units: number; complexes: number } {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  return db.transaction(() => {
    const ads = db.prepare(`DELETE FROM ads WHERE last_seen_at < ?`).run(cutoff).changes;
    const units = db.prepare(`DELETE FROM units WHERE id NOT IN (SELECT DISTINCT unit_id FROM ads)`).run().changes;
    const complexes = db.prepare(`DELETE FROM complexes WHERE id NOT IN (SELECT DISTINCT complex_id FROM units)`).run().changes;
    db.prepare(`DELETE FROM ad_details WHERE article_no NOT IN (SELECT article_no FROM ads) AND updated_at < ?`).run(cutoff);
    return { ads, units, complexes };
  })();
}

export function clearListings(db: Db): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM ads`).run();
    db.prepare(`DELETE FROM ad_details`).run();
    db.prepare(`DELETE FROM units`).run();
    db.prepare(`DELETE FROM complexes`).run();
    db.prepare(`DELETE FROM raw_payloads`).run();
  })();
}

export interface RegionName {
  sido: string | null;
  name: string;
}

// "수원시"는 "수원시"와 "수원시 장안구"처럼 시 이름으로 시작하는 시군구에 모두 맞는다
function regionFilter(regions: RegionName[], alias: string): { sql: string; params: (string | null)[] } {
  const sql = regions.map(() => `((? IS NULL OR ${alias}.sido = ?) AND (${alias}.sigungu = ? OR ${alias}.sigungu LIKE ? || ' %'))`).join(" OR ");
  return { sql, params: regions.flatMap((r) => [r.sido, r.sido, r.name, r.name]) };
}

/** 지역(시·구 이름 앞부분 일치)을 끝까지 다시 수집했을 때, 그 수집 시작 뒤로 한 번도 보이지 않은 매물을 지운다 */
export function pruneUnseenInRegions(db: Db, since: string, regions: RegionName[]): { ads: number; units: number; complexes: number } {
  if (regions.length === 0) return { ads: 0, units: 0, complexes: 0 };
  const { sql: match, params } = regionFilter(regions, "c");
  return db.transaction(() => {
    const ads = db
      .prepare(
        `DELETE FROM ads WHERE last_seen_at < ? AND unit_id IN
           (SELECT u.id FROM units u JOIN complexes c ON c.id = u.complex_id WHERE c.source != 'demo' AND (${match}))`,
      )
      .run(since, ...params).changes;
    const units = db.prepare(`DELETE FROM units WHERE id NOT IN (SELECT DISTINCT unit_id FROM ads)`).run().changes;
    const complexes = db.prepare(`DELETE FROM complexes WHERE id NOT IN (SELECT DISTINCT complex_id FROM units)`).run().changes;
    return { ads, units, complexes };
  })();
}

export function complexesMissingHouseholds(db: Db, regions: RegionName[]): { id: string; lat: number; lng: number; region: string }[] {
  if (regions.length === 0) return [];
  const { sql: match, params } = regionFilter(regions, "c");
  return db
    .prepare(
      `SELECT c.id, c.lat, c.lng, c.sigungu AS region FROM complexes c
        WHERE c.households IS NULL AND c.source != 'demo' AND (${match})
        ORDER BY c.lat DESC, c.lng`,
    )
    .all(...params) as { id: string; lat: number; lng: number; region: string }[];
}

export function upsertComplexInfo(db: Db, infos: ComplexInfo[], at = nowIso()): number {
  const upInfo = db.prepare(`
    INSERT INTO complex_info (id, households, approval_date, floor_area_ratio, updated_at)
    VALUES (@id, @households, @approvalDate, @floorAreaRatio, @at)
    ON CONFLICT(id) DO UPDATE SET
      households = COALESCE(excluded.households, complex_info.households),
      approval_date = COALESCE(excluded.approval_date, complex_info.approval_date),
      floor_area_ratio = COALESCE(excluded.floor_area_ratio, complex_info.floor_area_ratio),
      updated_at = excluded.updated_at`);
  const fillComplex = db.prepare(`
    UPDATE complexes SET
      households = COALESCE(@households, households),
      approval_year = COALESCE(approval_year, CAST(substr(@approvalDate, 1, 4) AS INTEGER))
    WHERE id = @id`);
  let changed = 0;
  db.transaction(() => {
    for (const i of infos) {
      upInfo.run({ ...i, at });
      changed += fillComplex.run(i).changes;
    }
  })();
  return changed;
}

/** 같은 원본(sha256)을 두 번 적재하지 않도록 기록한다. 새 원본이면 true */
export function recordPayload(db: Db, sha256: string, source: string, bytes: number, units: number, enriched: number): boolean {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO raw_payloads (sha256, source, bytes, received_at, units, enriched) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sha256, source, bytes, nowIso(), units, enriched).changes > 0
  );
}

export function hasPayload(db: Db, sha256: string): boolean {
  return !!db.prepare(`SELECT 1 FROM raw_payloads WHERE sha256 = ?`).get(sha256);
}

export function startRun(db: Db, job: string): number {
  return Number(db.prepare(`INSERT INTO batch_runs (job, started_at, status) VALUES (?, ?, 'running')`).run(job, nowIso()).lastInsertRowid);
}

export function finishRun(db: Db, id: number, status: "ok" | "skipped" | "error", stats: unknown, error?: string): void {
  db.prepare(`UPDATE batch_runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?`).run(
    nowIso(),
    status,
    JSON.stringify(stats),
    error ?? null,
    id,
  );
}

export function counts(db: Db): Record<string, number> {
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    complexes: one(`SELECT COUNT(*) AS n FROM complexes`),
    units: one(`SELECT COUNT(*) AS n FROM units`),
    ads: one(`SELECT COUNT(*) AS n FROM ads`),
    adDetails: one(`SELECT COUNT(*) AS n FROM ad_details`),
    trades: one(`SELECT COUNT(*) AS n FROM trades`),
    rents: one(`SELECT COUNT(*) AS n FROM rents`),
    seango: one(`SELECT COUNT(*) AS n FROM units WHERE seango_status IN ('seango', 'suspect')`),
  };
}

export function recentRuns(db: Db, limit = 10): { job: string; started_at: string; status: string; stats: string | null; error: string | null }[] {
  return db
    .prepare(`SELECT job, started_at, status, stats, error FROM batch_runs ORDER BY id DESC LIMIT ?`)
    .all(limit) as { job: string; started_at: string; status: string; stats: string | null; error: string | null }[];
}

export function collectedComplexes(db: Db): CollectedComplex[] {
  return (
    db
      .prepare(
        `SELECT c.id, c.name, c.sigungu, COUNT(u.id) AS units, MIN(u.price) AS min_price, MAX(u.price) AS max_price,
                MAX(u.last_seen_at) AS last_seen
           FROM complexes c JOIN units u ON u.complex_id = c.id
          GROUP BY c.id ORDER BY last_seen DESC`,
      )
      .all() as { id: string; name: string; sigungu: string; units: number; min_price: number; max_price: number; last_seen: string }[]
  ).map((r) => ({
    id: r.id,
    name: r.name,
    sigungu: r.sigungu,
    units: r.units,
    minPrice: r.min_price,
    maxPrice: r.max_price,
    lastSeenAt: r.last_seen,
  }));
}

export function distinctLawdCodes(db: Db): string[] {
  const rows = db.prepare(`SELECT DISTINCT sido, sigungu FROM complexes`).all() as { sido: string; sigungu: string }[];
  return [...new Set(rows.map((r) => resolveRegion(r.sido, r.sigungu).lawdCd).filter((c): c is string => !!c))];
}
