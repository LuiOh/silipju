// SQLite(better-sqlite3) 연결·스키마 마이그레이션(웹 서버와 배치가 같은 DB 파일을 공유)

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export const DEFAULT_DB_PATH = path.join(process.cwd(), ".data", "silipju.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS complexes (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  address TEXT NOT NULL,
  sido TEXT NOT NULL,
  sigungu TEXT NOT NULL,
  households INTEGER,
  approval_year INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  complex_id TEXT NOT NULL REFERENCES complexes(id) ON DELETE CASCADE,
  dong TEXT,
  floor_label TEXT NOT NULL,
  floor INTEGER,
  total_floors INTEGER,
  exclusive_area REAL NOT NULL,
  supply_area REAL,
  area_name TEXT,
  room_count INTEGER NOT NULL,
  direction TEXT,
  price INTEGER NOT NULL,
  photo_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seango_status TEXT,
  seango_probability REAL,
  seango_summary TEXT,
  classified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_complex ON units(complex_id);
CREATE TABLE IF NOT EXISTS ads (
  article_no TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  realtor_name TEXT NOT NULL,
  cp_name TEXT,
  feature_text TEXT NOT NULL,
  verification_type TEXT,
  confirmed_at TEXT,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ads_unit ON ads(unit_id);
CREATE TABLE IF NOT EXISTS ad_details (
  article_no TEXT PRIMARY KEY,
  description TEXT,
  feature_text TEXT,
  moving_in_type TEXT,
  moving_in_date TEXT,
  moving_in_negotiable INTEGER,
  previous_deposit INTEGER,
  previous_monthly_rent INTEGER,
  is_lease_hold INTEGER,
  room_count INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lawd_cd TEXT NOT NULL,
  apt_name TEXT NOT NULL,
  apt_key TEXT NOT NULL,
  umd_name TEXT,
  jibun TEXT,
  exclusive_area REAL NOT NULL,
  floor INTEGER,
  price INTEGER NOT NULL,
  deal_date TEXT NOT NULL,
  dealing_type TEXT,
  UNIQUE(lawd_cd, apt_name, jibun, exclusive_area, floor, price, deal_date)
);
CREATE INDEX IF NOT EXISTS idx_trades_apt ON trades(lawd_cd, apt_key);
CREATE TABLE IF NOT EXISTS rents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lawd_cd TEXT NOT NULL,
  apt_name TEXT NOT NULL,
  apt_key TEXT NOT NULL,
  umd_name TEXT,
  jibun TEXT,
  exclusive_area REAL NOT NULL,
  floor INTEGER,
  deposit INTEGER NOT NULL,
  monthly_rent INTEGER NOT NULL,
  contract_date TEXT NOT NULL,
  contract_term TEXT,
  contract_type TEXT,
  use_rr_right TEXT,
  UNIQUE(lawd_cd, apt_name, jibun, exclusive_area, floor, deposit, monthly_rent, contract_date)
);
CREATE INDEX IF NOT EXISTS idx_rents_apt ON rents(lawd_cd, apt_key);
CREATE TABLE IF NOT EXISTS complex_info (
  id TEXT PRIMARY KEY,
  households INTEGER,
  approval_date TEXT,
  floor_area_ratio INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS raw_payloads (
  sha256 TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  units INTEGER NOT NULL,
  enriched INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS batch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  stats TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS complex_briefs (
  complex_id TEXT PRIMARY KEY,
  model TEXT,
  created_at TEXT,
  content TEXT
);
CREATE TABLE IF NOT EXISTS complex_schools (
  complex_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  content TEXT NOT NULL
);
`;

export function openDb(file = process.env.SILIPJU_DB ?? DEFAULT_DB_PATH): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  ensureSchema(db);
  return db;
}

/** 멱등. dev 핫리로드 뒤 재사용된 연결에는 나중에 추가된 테이블이 없을 수 있어 다시 실행한다 */
export function ensureSchema(db: Db): void {
  db.exec(SCHEMA);
}

const globalDb = globalThis as unknown as { __silipjuDb?: Db; __silipjuSchema?: string };

/** 웹 서버 프로세스 안에서 재사용하는 연결 */
export function getDb(): Db {
  globalDb.__silipjuDb ??= openDb();
  if (globalDb.__silipjuSchema !== SCHEMA) {
    ensureSchema(globalDb.__silipjuDb);
    globalDb.__silipjuSchema = SCHEMA;
  }
  return globalDb.__silipjuDb;
}

/** 다른 연결(배치 프로세스)이 커밋하면 값이 바뀐다. 웹 서버 스냅샷 무효화에 사용 */
export function dataVersion(db: Db): number {
  return db.pragma("data_version", { simple: true }) as number;
}
