// 동네 브리핑을 complex_briefs 테이블에 저장·조회하고 단지별 생성 중 상태를 관리한다(서버 전용)

import { getDb, type Db } from "@/lib/db/client";
import type { NeighborhoodBrief } from "@/lib/types";

interface StoredContent {
  webSearches: number | null;
  content: NeighborhoodBrief["content"];
}

export function loadBrief(complexId: string, db: Db = getDb()): NeighborhoodBrief | null {
  const row = db.prepare(`SELECT model, created_at, content FROM complex_briefs WHERE complex_id = ?`).get(complexId) as
    | { model: string | null; created_at: string | null; content: string | null }
    | undefined;
  if (!row?.content) return null;
  try {
    const stored = JSON.parse(row.content) as StoredContent;
    if (!stored?.content?.summary) return null;
    return { complexId, model: row.model ?? "알 수 없음", createdAt: row.created_at ?? "", webSearches: stored.webSearches ?? null, content: stored.content };
  } catch {
    return null;
  }
}

export function saveBrief(brief: NeighborhoodBrief, db: Db = getDb()): void {
  const stored: StoredContent = { webSearches: brief.webSearches, content: brief.content };
  db.prepare(
    `INSERT INTO complex_briefs (complex_id, model, created_at, content) VALUES (?, ?, ?, ?)
     ON CONFLICT(complex_id) DO UPDATE SET model = excluded.model, created_at = excluded.created_at, content = excluded.content`,
  ).run(brief.complexId, brief.model, brief.createdAt, JSON.stringify(stored));
}

const g = globalThis as unknown as { __silipjuBriefJobs?: Set<string> };

function jobs(): Set<string> {
  g.__silipjuBriefJobs ??= new Set();
  return g.__silipjuBriefJobs;
}

export function isGenerating(complexId: string): boolean {
  return jobs().has(complexId);
}

/** 이미 생성 중이면 false */
export function startGenerating(complexId: string): boolean {
  if (jobs().has(complexId)) return false;
  jobs().add(complexId);
  return true;
}

export function finishGenerating(complexId: string): void {
  jobs().delete(complexId);
}
