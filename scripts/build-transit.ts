// 수도권 도시철도 노선·역을 Overpass API에서 한 번 받아 public/transit/*.json 정적 파일로 만드는 빌드 스크립트
//
// 사용법: npx tsx scripts/build-transit.ts [--reuse]
//   --reuse  .data/transit-raw/에 저장해 둔 Overpass 응답을 다시 쓴다(데이터 가공만 다시 할 때).
// 데이터 출처: © OpenStreetMap contributors (ODbL)

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LINE_COLOR } from "@/lib/commute/stations";

const BBOX = "36.9,126.3,38.0,127.7";
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const USER_AGENT = "silipju-transit-build/1.0 (one-time static build of Seoul metro lines for a personal local map)";
const RAW_DIR = path.join(".data", "transit-raw");
const OUT_DIR = path.join("public", "transit");
const REUSE = process.argv.includes("--reuse");

/** 단순화 허용 오차(m)와 복선 중복 제거 거리(m) */
const SIMPLIFY_M = 20;
const PARALLEL_M = 35;
/** 같은 이름의 정차 지점을 한 역으로 묶는 거리(m) */
const STATION_MERGE_M = 500;

const STANDARD_COLOR: Record<string, string> = {
  "1호선": "#0052A4",
  "2호선": "#00A84D",
  "3호선": "#EF7C1C",
  "4호선": "#00A5DE",
  "5호선": "#996CAC",
  "6호선": "#CD7C2F",
  "7호선": "#747F00",
  "8호선": "#E6186C",
  "9호선": "#BDB092",
  신분당선: "#D4003B",
  수인분당선: "#F5A200",
  경의중앙선: "#77C4A3",
  공항철도: "#0090D2",
  경춘선: "#0C8E72",
  서해선: "#8FC31F",
  경강선: "#003DA5",
  용인경전철: "#56AD2D",
  우이신설선: "#B0CE18",
  신림선: "#6789CA",
  김포골드라인: "#A17E46",
  의정부경전철: "#FDA600",
  인천1호선: "#7CA8D5",
  인천2호선: "#ED8B00",
  "GTX-A": "#9A6292",
};

/** 그리는 순서(뒤가 위). 광역·간선을 먼저 깔고 도시철도를 위에 올린다. */
const LINE_ORDER = [
  "경의중앙선", "경춘선", "서해선", "경강선", "공항철도", "GTX-A", "1호선", "수인분당선",
  "인천1호선", "인천2호선", "김포골드라인", "의정부경전철", "용인경전철", "우이신설선", "신림선",
  "9호선", "8호선", "7호선", "6호선", "5호선", "4호선", "3호선", "신분당선", "2호선",
];

type Tags = Record<string, string>;
interface OsmMember { type: "node" | "way" | "relation"; ref: number; role: string }
interface OsmRelation { type: "relation"; id: number; tags?: Tags; members?: OsmMember[] }
interface OsmWay { type: "way"; id: number; nodes?: number[]; geometry?: { lat: number; lon: number }[] }
interface OsmNode { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
type OsmElement = OsmRelation | OsmWay | OsmNode;

type LatLng = [number, number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 줄 이름 판별: 수도권 전철 계통만 남기고 KTX·ITX·무궁화 같은 간선 열차는 버린다. */
function classifyLine(tags: Tags): string | null {
  const name = tags.name ?? "";
  const network = tags.network ?? "";
  const metro = network.includes("수도권 전철");
  let m: RegExpMatchArray | null;
  if (/^인천 도시철도 1호선/.test(name)) return "인천1호선";
  if (/^인천 도시철도 2호선/.test(name)) return "인천2호선";
  if ((m = name.match(/^(?:서울 지하철|수도권 전철) ([1-9])호선/))) return `${m[1]}호선`;
  if (/^신분당선/.test(name)) return "신분당선";
  if (/^수인·분당선/.test(name)) return "수인분당선";
  if (/^경의·중앙선/.test(name)) return "경의중앙선";
  if (/^인천국제공항철도/.test(name)) return "공항철도";
  if (/광역급행철도 A/.test(name)) return "GTX-A";
  if (/^용인 경전철/.test(name)) return "용인경전철";
  if (/^의정부경전철/.test(name)) return "의정부경전철";
  if (/^우이신설선/.test(name)) return "우이신설선";
  if (/신림선/.test(name)) return "신림선";
  if (/김포 골드라인/.test(name)) return "김포골드라인";
  if (metro && /경춘선/.test(name)) return "경춘선";
  if (metro && /서해선/.test(name)) return "서해선";
  if (metro && /경강선/.test(name)) return "경강선";
  return null;
}

function lineColor(line: string, osmColour: string | undefined): string {
  const canonical = LINE_COLOR[line] ?? STANDARD_COLOR[line];
  if (canonical) return canonical;
  if (osmColour && /^#[0-9a-f]{6}$/i.test(osmColour)) return osmColour.toUpperCase();
  return "#8A929E";
}

async function overpass(label: string, query: string): Promise<OsmElement[]> {
  const cacheFile = path.join(RAW_DIR, `${label}.json`);
  if (REUSE && existsSync(cacheFile)) {
    console.log(`[${label}] 저장된 응답 사용: ${cacheFile}`);
    return (JSON.parse(readFileSync(cacheFile, "utf8")) as { elements: OsmElement[] }).elements;
  }
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const endpoint = ENDPOINTS[Math.floor(attempt / 2) % ENDPOINTS.length];
    const started = Date.now();
    let retryAfterMs = Math.min(15_000 * 2 ** attempt, 240_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(360_000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) {
        const json = JSON.parse(text) as { elements: OsmElement[]; remark?: string };
        if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(`Overpass remark: ${json.remark}`);
        mkdirSync(RAW_DIR, { recursive: true });
        writeFileSync(cacheFile, text);
        console.log(`[${label}] ${json.elements.length}개 요소, ${((Date.now() - started) / 1000).toFixed(1)}초 (${endpoint})`);
        return json.elements;
      }
      if (![429, 502, 503, 504].includes(res.status) && res.ok === false) {
        throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const ra = Number(res.headers.get("retry-after"));
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.max(retryAfterMs, ra * 1000);
      console.warn(`[${label}] HTTP ${res.status}, ${Math.round(retryAfterMs / 1000)}초 후 재시도 (${attempt + 1}/${maxAttempts})`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Overpass HTTP")) throw err;
      console.warn(`[${label}] 요청 실패: ${err instanceof Error ? err.message : String(err)}, ${Math.round(retryAfterMs / 1000)}초 후 재시도`);
    }
    await sleep(retryAfterMs);
  }
  throw new Error(`[${label}] Overpass 요청이 ${maxAttempts}번 모두 실패했습니다.`);
}

// ---- 기하 유틸 ----

const toXY = (p: LatLng, lat0: number): [number, number] => [
  p[1] * 111_320 * Math.cos((lat0 * Math.PI) / 180),
  p[0] * 110_540,
];

function distM(a: LatLng, b: LatLng): number {
  const [ax, ay] = toXY(a, a[0]);
  const [bx, by] = toXY(b, a[0]);
  return Math.hypot(ax - bx, ay - by);
}

/** Douglas–Peucker(반복형). 허용 오차는 미터 단위. */
function simplify(points: LatLng[], tolM: number): LatLng[] {
  if (points.length <= 2) return points;
  const lat0 = points[0][0];
  const xy = points.map((p) => toXY(p, lat0));
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = xy[s];
    const [x2, y2] = xy[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = xy[i];
      let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** 끝점 노드를 공유하는 way들을 이어 긴 사슬로 만든다. */
function mergeWays(ways: { nodes: number[]; coords: LatLng[] }[]): LatLng[][] {
  const used = new Uint8Array(ways.length);
  const byEnd = new Map<number, number[]>();
  ways.forEach((w, i) => {
    for (const n of [w.nodes[0], w.nodes[w.nodes.length - 1]]) {
      const list = byEnd.get(n);
      if (list) list.push(i);
      else byEnd.set(n, [i]);
    }
  });
  const chains: LatLng[][] = [];
  for (let i = 0; i < ways.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let nodes = [...ways[i].nodes];
    let coords = [...ways[i].coords];
    for (const atTail of [true, false]) {
      for (;;) {
        const end = atTail ? nodes[nodes.length - 1] : nodes[0];
        const next = (byEnd.get(end) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        let wn = ways[next].nodes;
        let wc = ways[next].coords;
        const forward = atTail ? wn[0] === end : wn[wn.length - 1] === end;
        if (!forward) {
          wn = [...wn].reverse();
          wc = [...wc].reverse();
        }
        if (atTail) {
          nodes = nodes.concat(wn.slice(1));
          coords = coords.concat(wc.slice(1));
        } else {
          nodes = wn.slice(0, -1).concat(nodes);
          coords = wc.slice(0, -1).concat(coords);
        }
      }
    }
    chains.push(coords);
  }
  return chains;
}

/** 이미 남긴 선과 PARALLEL_M 안에서 나란히 달리는 구간(복선의 반대 선로 등)을 잘라 낸다. */
class CoverageGrid {
  private cells = new Map<string, LatLng[]>();
  private readonly cell = 0.0005;
  private key(p: LatLng) {
    return `${Math.floor(p[0] / this.cell)}:${Math.floor(p[1] / this.cell)}`;
  }
  add(line: LatLng[]) {
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const steps = b ? Math.max(1, Math.ceil(distM(a, b) / 10)) : 1;
      for (let s = 0; s < steps; s++) {
        const p: LatLng = b ? [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps] : a;
        const k = this.key(p);
        const list = this.cells.get(k);
        if (list) list.push(p);
        else this.cells.set(k, [p]);
      }
    }
  }
  covered(p: LatLng): boolean {
    const ci = Math.floor(p[0] / this.cell);
    const cj = Math.floor(p[1] / this.cell);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const q of this.cells.get(`${ci + di}:${cj + dj}`) ?? []) if (distM(p, q) <= PARALLEL_M) return true;
      }
    }
    return false;
  }
}

function dedupeParallel(chains: LatLng[][]): LatLng[][] {
  const sorted = [...chains].sort((a, b) => b.length - a.length);
  const grid = new CoverageGrid();
  const out: LatLng[][] = [];
  for (const chain of sorted) {
    let run: LatLng[] = [];
    const pieces: LatLng[][] = [];
    chain.forEach((p, i) => {
      if (grid.covered(p)) {
        if (run.length) {
          run.push(p);
          pieces.push(run);
          run = [];
        }
      } else {
        if (run.length === 0 && i > 0) run.push(chain[i - 1]);
        run.push(p);
      }
    });
    if (run.length) pieces.push(run);
    for (const piece of pieces) {
      const len = piece.slice(1).reduce((acc, p, i) => acc + distM(piece[i], p), 0);
      if (piece.length >= 2 && len >= 60) {
        out.push(piece);
        grid.add(piece);
      }
    }
  }
  return out;
}

// ---- 역 ----

/** 부역명이 달라 이름만으로는 묶이지 않는 환승역 */
const STATION_ALIAS: Record<string, string> = { 이수: "총신대입구" };

/** "잠실(송파구청)", "판교역", "강남 승강장" → "잠실", "판교", "강남" */
function normalizeStationName(raw: string): string {
  const name = raw
    .trim()
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*(?:[0-9]+번\s*)?(?:승강장|타는\s*곳|플랫폼)$/u, "")
    .replace(/\s+/gu, " ")
    .replace(/역$/u, "")
    .trim();
  return STATION_ALIAS[name] ?? name;
}

interface StationAcc {
  name: string;
  points: LatLng[];
  lines: Set<string>;
  anchor: LatLng | null;
}

async function main() {
  const relTags = await overpass(
    "relations",
    `[out:json][timeout:180];relation["route"~"^(subway|light_rail|train|monorail)$"](${BBOX});out tags;`,
  );
  const routeLine = new Map<number, string>();
  const osmColour = new Map<string, string>();
  for (const el of relTags) {
    if (el.type !== "relation" || !el.tags) continue;
    const line = classifyLine(el.tags);
    if (!line) continue;
    routeLine.set(el.id, line);
    if (el.tags.colour && !osmColour.has(line)) osmColour.set(line, el.tags.colour);
  }
  console.log(`노선 relation ${routeLine.size}개 → ${new Set(routeLine.values()).size}개 노선`);

  if (!REUSE) await sleep(10_000);
  const ids = [...routeLine.keys()].join(",");
  const detail = await overpass(
    "geometry",
    `[out:json][timeout:300];relation(id:${ids})->.r;.r out body qt;way(r.r);out skel geom qt;node(r.r);out body qt;node["railway"="station"](${BBOX});out body qt;`,
  );

  const ways = new Map<number, OsmWay>();
  const nodes = new Map<number, OsmNode>();
  const relations: OsmRelation[] = [];
  for (const el of detail) {
    if (el.type === "way") ways.set(el.id, el);
    else if (el.type === "node") nodes.set(el.id, el);
    else if (el.type === "relation") relations.push(el);
  }

  // 노선별 선로 way와 정차 노드
  const lineWays = new Map<string, Set<number>>();
  const lineStops = new Map<string, Set<number>>();
  for (const rel of relations) {
    const line = routeLine.get(rel.id);
    if (!line) continue;
    const wset = lineWays.get(line) ?? new Set<number>();
    const sset = lineStops.get(line) ?? new Set<number>();
    for (const m of rel.members ?? []) {
      if (m.type === "way" && !m.role.startsWith("platform")) wset.add(m.ref);
      if (m.type === "node" && (m.role.startsWith("stop") || m.role.startsWith("platform") || m.role === "")) sset.add(m.ref);
    }
    lineWays.set(line, wset);
    lineStops.set(line, sset);
  }

  const lines: { name: string; color: string; paths: LatLng[][] }[] = [];
  let pointCount = 0;
  for (const name of [...lineWays.keys()].sort((a, b) => LINE_ORDER.indexOf(a) - LINE_ORDER.indexOf(b))) {
    const wl: { nodes: number[]; coords: LatLng[] }[] = [];
    for (const id of lineWays.get(name) ?? []) {
      const w = ways.get(id);
      if (!w?.nodes || !w.geometry || w.geometry.length < 2) continue;
      wl.push({ nodes: w.nodes, coords: w.geometry.map((g): LatLng => [g.lat, g.lon]) });
    }
    const chains = dedupeParallel(mergeWays(wl));
    const paths = chains
      .map((c) => simplify(c, SIMPLIFY_M).map((p): LatLng => [round5(p[0]), round5(p[1])]))
      .filter((c) => c.length >= 2);
    pointCount += paths.reduce((a, p) => a + p.length, 0);
    lines.push({ name, color: lineColor(name, osmColour.get(name)), paths });
    console.log(`  ${name}: way ${wl.length} → 경로 ${paths.length}개, 점 ${paths.reduce((a, p) => a + p.length, 0)}`);
  }

  // 역: railway=station 노드를 기준 좌표로 쓰고, 노선별 정차 노드 이름으로 노선을 붙인다.
  const stationAnchors = [...nodes.values()].filter((n) => n.tags?.railway === "station" && (n.tags["name:ko"] ?? n.tags.name));
  const acc: StationAcc[] = [];
  const unnamed = new Map<string, number>();
  for (const [line, stops] of lineStops) {
    for (const id of stops) {
      const n = nodes.get(id);
      const raw = n?.tags?.["name:ko"] ?? n?.tags?.name;
      if (!n || !raw) {
        unnamed.set(line, (unnamed.get(line) ?? 0) + 1);
        continue;
      }
      const name = normalizeStationName(raw);
      if (!name) continue;
      const p: LatLng = [n.lat, n.lon];
      let st = acc.find((s) => s.name === name && distM(s.points[0], p) <= STATION_MERGE_M);
      if (!st) {
        st = { name, points: [], lines: new Set(), anchor: null };
        acc.push(st);
      }
      st.points.push(p);
      st.lines.add(line);
    }
  }
  for (const st of acc) {
    const c: LatLng = [
      st.points.reduce((a, p) => a + p[0], 0) / st.points.length,
      st.points.reduce((a, p) => a + p[1], 0) / st.points.length,
    ];
    let best: { d: number; p: LatLng } | null = null;
    for (const a of stationAnchors) {
      const an = normalizeStationName(a.tags?.["name:ko"] ?? a.tags?.name ?? "");
      if (an !== st.name) continue;
      const d = distM(c, [a.lat, a.lon]);
      if (d <= STATION_MERGE_M && (!best || d < best.d)) best = { d, p: [a.lat, a.lon] };
    }
    st.anchor = best?.p ?? c;
  }
  // 정차 노드 묶음끼리도 같은 이름·가까운 거리면 한 역으로(노선마다 정차 노드가 따로 있는 환승역)
  const merged: StationAcc[] = [];
  for (const st of acc) {
    const same = merged.find((m) => m.name === st.name && distM(m.anchor!, st.anchor!) <= STATION_MERGE_M);
    if (same) for (const l of st.lines) same.lines.add(l);
    else merged.push(st);
  }
  const lat = (s: StationAcc) => s.anchor![0];
  const lo = 36.9;
  const hi = 38.0;
  const stations = merged
    .filter((s) => lat(s) >= lo && lat(s) <= hi && s.anchor![1] >= 126.3 && s.anchor![1] <= 127.7)
    .map((s) => ({
      name: s.name,
      lat: round5(s.anchor![0]),
      lng: round5(s.anchor![1]),
      lines: [...s.lines].sort((a, b) => LINE_ORDER.indexOf(b) - LINE_ORDER.indexOf(a)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko") || a.lat - b.lat);
  if (unnamed.size) console.log(`이름 없는 정차 노드: ${[...unnamed].map(([l, n]) => `${l} ${n}`).join(", ")}`);

  const meta = {
    source: "OpenStreetMap via Overpass API",
    attribution: "© OpenStreetMap contributors (ODbL)",
    generatedAt: new Date().toISOString(),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const linesFile = path.join(OUT_DIR, "metro-lines.json");
  const stationsFile = path.join(OUT_DIR, "metro-stations.json");
  writeFileSync(linesFile, JSON.stringify({ ...meta, lines }));
  writeFileSync(stationsFile, JSON.stringify({ ...meta, stations }));
  const kb = (f: string) => (statSync(f).size / 1024).toFixed(1);
  console.log(`노선 ${lines.length}개, 경로 ${lines.reduce((a, l) => a + l.paths.length, 0)}개, 점 ${pointCount}개 → ${linesFile} ${kb(linesFile)} KB`);
  console.log(`역 ${stations.length}개(환승 ${stations.filter((s) => s.lines.length > 1).length}개) → ${stationsFile} ${kb(stationsFile)} KB`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
