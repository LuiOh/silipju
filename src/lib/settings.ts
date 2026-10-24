// 앱 설정(외부 API 키 등)을 SQLite app_settings에 저장·조회하는 서버 전용 모듈(키 원문은 클라이언트로 보내지 않는다)

import { ensureSchema, getDb, type Db } from "@/lib/db/client";
import type { ApiKeyName, ApiKeyStatus } from "@/lib/types";

export const API_KEY_NAMES: readonly ApiKeyName[] = ["tmap", "kakao", "molit", "finlife", "anthropic"];

const ENV_FALLBACK: Record<ApiKeyName, string> = {
  tmap: "TMAP_APP_KEY",
  kakao: "KAKAO_REST_API_KEY",
  molit: "MOLIT_SERVICE_KEY",
  finlife: "FINLIFE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const ready = new WeakSet<Db>();

function prepared(db: Db): Db {
  if (!ready.has(db)) {
    ensureSchema(db);
    ready.add(db);
  }
  return db;
}

export function isApiKeyName(v: unknown): v is ApiKeyName {
  return typeof v === "string" && (API_KEY_NAMES as readonly string[]).includes(v);
}

export function getSetting(key: string, db: Db = getDb()): string | null {
  const row = prepared(db).prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** null이면 지운다 */
export function setSetting(key: string, value: string | null, db: Db = getDb()): void {
  const d = prepared(db);
  if (value === null) {
    d.prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
    return;
  }
  d.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

const apiKeySetting = (name: ApiKeyName) => `apiKey.${name}`;

function resolveApiKey(name: ApiKeyName, db: Db): { value: string; source: "db" | "env" } | null {
  const stored = getSetting(apiKeySetting(name), db);
  if (stored) return { value: stored, source: "db" };
  const env = process.env[ENV_FALLBACK[name]]?.trim();
  return env ? { value: env, source: "env" } : null;
}

/** 앱에 저장한 키 → 환경변수 순으로 찾는다 */
export function getApiKey(name: ApiKeyName, db: Db = getDb()): string | null {
  return resolveApiKey(name, db)?.value ?? null;
}

export function setApiKey(name: ApiKeyName, value: string | null, db: Db = getDb()): void {
  setSetting(apiKeySetting(name), value, db);
}

export function maskSecret(v: string): string {
  if (v.length >= 12) return `${v.slice(0, 4)}••••${v.slice(-4)}`;
  if (v.length >= 6) return `${v.slice(0, 2)}••••${v.slice(-2)}`;
  return "••••";
}

export function apiKeyStatuses(db: Db = getDb()): Record<ApiKeyName, ApiKeyStatus> {
  const entry = (name: ApiKeyName): ApiKeyStatus => {
    const r = resolveApiKey(name, db);
    return r ? { set: true, source: r.source, masked: maskSecret(r.value) } : { set: false, source: null, masked: null };
  };
  return { tmap: entry("tmap"), kakao: entry("kakao"), molit: entry("molit"), finlife: entry("finlife"), anthropic: entry("anthropic") };
}

/** 외부 API가 오류 문구에 키를 되돌려 주는 경우가 있어 응답 메시지에서 지운다 */
export function redactSecret(message: string, secret: string | null): string {
  return secret ? message.split(secret).join("(키)") : message;
}
