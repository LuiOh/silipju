// 수집 배치 CLI: 수집함(JSON/HAR/HTML) 적재 → 국토부 매매·전월세 실거래 수집 → 세안고 재판별 → 오래된 매물 정리

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import { openDb, type Db } from "@/lib/db/client";
import { counts, hasPayload, pruneStale, recentRuns, recordPayload, upsertListings } from "@/lib/db/repo";
import { extractDehydratedBasicInfo, parseNaverPayloads } from "@/lib/data/naver-import";
import { classifyListings, collectMolit, lawdTargets, runJob, type JobResult } from "@/lib/jobs/molit-sync";
import { getApiKey } from "@/lib/settings";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

type Options = Record<string, string | true>;

const HELP = `실입주 수집 배치

사용법: npm run batch -- <명령> [옵션]

명령
  ingest   [--dir .data/inbox]              수집함의 JSON·HAR·HTML을 DB에 적재하고 done/으로 옮김
  trades   [--lawd 41135,41463] [--months 12]  국토부 아파트 매매 실거래가 수집
  rents    [--lawd 41135,41463] [--months 24]  국토부 아파트 전월세 실거래가 수집(세안고 보조 단서)
  classify                                  DB 매물 전체 세안고 재판별 후 결과 저장
  prune    [--days 21]                      N일 동안 다시 수집되지 않은 매물 정리
  all      [위 옵션 모두]                    ingest → trades → rents → classify → prune 순서로 실행
  stats                                     DB 현황과 최근 실행 기록

공통 옵션
  --db <경로>   DB 파일(기본 .data/silipju.db, 환경변수 SILIPJU_DB)

국토부 수집에는 앱의 API 설정에 저장한 국토부 키나 .env.local의 MOLIT_SERVICE_KEY가 필요합니다. --lawd를 생략하면 DB에 적재된 단지의 시군구를 씁니다.`;

function parseArgs(argv: string[]): { command: string | undefined; opts: Options } {
  const [command, ...rest] = argv;
  const opts: Options = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) continue;
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      opts[a.slice(2)] = next;
      i++;
    } else {
      opts[a.slice(2)] = true;
    }
  }
  return { command, opts };
}

const optString = (o: Options, k: string, d: string) => (typeof o[k] === "string" ? (o[k] as string) : d);
const optInt = (o: Options, k: string, d: number) => {
  const v = parseInt(optString(o, k, String(d)), 10);
  return Number.isFinite(v) && v > 0 ? v : d;
};
const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ${msg}`);

function payloadsFromFile(file: string, text: string): unknown[] {
  if (file.endsWith(".html") || file.endsWith(".htm")) return extractDehydratedBasicInfo(text);
  return [JSON.parse(text)];
}

async function ingest(db: Db, opts: Options): Promise<JobResult> {
  const dir = path.resolve(optString(opts, "dir", path.join(".data", "inbox")));
  const done = path.join(dir, "done");
  mkdirSync(done, { recursive: true });
  const files = readdirSync(dir).filter((f) => /\.(json|har|html?)$/i.test(f));
  const stats = { files: files.length, ingested: 0, duplicates: 0, failed: 0, units: 0, ads: 0, details: 0 };
  if (files.length === 0) {
    log(`수집함이 비어 있습니다: ${dir}`);
    return { status: "skipped", stats };
  }
  for (const f of files) {
    const full = path.join(dir, f);
    const text = readFileSync(full, "utf-8");
    const sha = createHash("sha256").update(text).digest("hex");
    if (hasPayload(db, sha)) {
      stats.duplicates++;
      renameSync(full, path.join(done, f));
      continue;
    }
    try {
      const parsed = parseNaverPayloads(payloadsFromFile(f, text));
      if (parsed.units.length === 0 && parsed.details.length === 0) {
        log(`건너뜀(매물 없음): ${f}`);
        stats.failed++;
        continue;
      }
      const r = upsertListings(db, parsed.complexes, parsed.units, parsed.details);
      recordPayload(db, sha, "inbox", Buffer.byteLength(text), parsed.units.length, parsed.details.length);
      renameSync(full, path.join(done, f));
      stats.ingested++;
      stats.units += r.units;
      stats.ads += r.ads;
      stats.details += r.details;
      log(`적재: ${f} → 단지 ${r.complexes} · 매물 그룹 ${r.units} · 광고 ${r.ads} · 상세 ${r.details}`);
    } catch (e) {
      stats.failed++;
      log(`실패: ${f} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { status: "ok", stats };
}

function collect(db: Db, opts: Options, kind: "trades" | "rents"): Promise<JobResult> {
  return collectMolit(db, {
    kind,
    months: optInt(opts, "months", kind === "trades" ? 12 : 24),
    targets: lawdTargets(db, optString(opts, "lawd", "")),
    serviceKey: getApiKey("molit", db),
    log,
  });
}

function classify(db: Db): Promise<JobResult> {
  return classifyListings(db, log, (rows) => console.table(rows));
}

async function prune(db: Db, opts: Options): Promise<JobResult> {
  const days = optInt(opts, "days", 21);
  const r = pruneStale(db, days);
  log(`${days}일 이상 미수집 정리: 광고 ${r.ads} · 매물 그룹 ${r.units} · 단지 ${r.complexes}`);
  return { status: "ok", stats: { days, ...r } };
}

function stats(db: Db): void {
  console.table([counts(db)]);
  const runs = recentRuns(db, 12).map((r) => ({ 작업: r.job, 시작: r.started_at, 상태: r.status, 통계: r.stats ?? "", 오류: r.error ?? "" }));
  if (runs.length > 0) console.table(runs);
  else log("실행 기록이 없습니다.");
}

async function main(): Promise<number> {
  const { command, opts } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || opts.help) {
    console.log(HELP);
    return command ? 0 : 1;
  }
  const db = openDb(typeof opts.db === "string" ? path.resolve(opts.db) : undefined);
  const started = Date.now();
  try {
    switch (command) {
      case "ingest":
        await runJob(db, "ingest", () => ingest(db, opts));
        break;
      case "trades":
        await runJob(db, "trades", () => collect(db, opts, "trades"));
        break;
      case "rents":
        await runJob(db, "rents", () => collect(db, opts, "rents"));
        break;
      case "classify":
        await runJob(db, "classify", () => classify(db));
        break;
      case "prune":
        await runJob(db, "prune", () => prune(db, opts));
        break;
      case "all":
        await runJob(db, "ingest", () => ingest(db, opts));
        await runJob(db, "trades", () => collect(db, opts, "trades"));
        await runJob(db, "rents", () => collect(db, opts, "rents"));
        await runJob(db, "classify", () => classify(db));
        await runJob(db, "prune", () => prune(db, opts));
        break;
      case "stats":
        break;
      default:
        console.error(`알 수 없는 명령: ${command}\n`);
        console.log(HELP);
        return 1;
    }
    stats(db);
    log(`완료(${((Date.now() - started) / 1000).toFixed(1)}초)`);
    return 0;
  } catch (e) {
    console.error(`배치 실패: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    db.close();
  }
}

main().then((code) => process.exit(code));
