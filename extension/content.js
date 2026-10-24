// 네이버페이 부동산 화면에 '실입주 수집기' 패널을 붙이고, 지도 목록을 끝까지 불러오거나 앱이 맡긴 지역을 칸 단위로 자동 수집
(() => {
  const IS_FIN = location.hostname === "fin.land.naver.com";
  const IS_NEW = location.hostname === "new.land.naver.com";
  const AUTO_FLAG = "silipju-auto";
  const JOB_KEY = "silipju-job";
  const CELL_KEY = "silipju-cell";
  const MAX_PAGES = 80;
  const BASE_ZOOM = 13;
  const MAX_ZOOM = 16;
  const SPLIT_OVER = 1800;
  // 줌 14 이하에서는 단지 마커 응답이 일부 단지만 담아 오므로 세대수 보완은 줌 15부터 본다
  const HH_ZOOM = 15;
  const HH_MAX_ZOOM = 17;
  const ACTIVE = new Set(["planning", "running"]);
  const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const MAP_URL = "https://fin.land.naver.com/map?tradeTypes=A1&realEstateTypes=A01";

  // 라우터가 주소를 바꾸기 전에 해시 표시를 읽는다. 같은 탭에서 다음 칸으로 옮겨도 sessionStorage는 남는다
  const hash = new URLSearchParams(location.hash.slice(1));
  if (IS_FIN && hash.get(JOB_KEY)) sessionStorage.setItem(JOB_KEY, hash.get(JOB_KEY));
  const autoStart = IS_FIN && hash.has(AUTO_FLAG) && sessionStorage.getItem(AUTO_FLAG) !== "done";

  // 지금 열린 지도 목록의 누적치. 필터를 바꾸거나 지도를 옮겨 목록이 새로 열리면 seed가 바뀌므로 다시 센다
  const list = { seed: null, pages: 0, groups: 0, total: null, hasNext: true };
  const view = { bbox: null, precision: null, total: null };
  const run = { active: false, stop: false, blocked: null, message: "" };
  const app = { saved: null, error: null };
  const markersSeen = [];
  let job = null;
  let received = 0;
  let host = null;
  let root = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (cond, ms) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await sleep(250);
    return cond();
  };
  const onMap = () => location.pathname.startsWith("/map");
  const fmt = (n) => Number(n).toLocaleString("ko-KR");
  const r7 = (v) => Math.round(v * 1e7) / 1e7;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || d.source !== "silipju-collector") return;
    if (d.kind === "http-error") return onHttpError(d.status, d.url);
    if (d.kind === "article-count") return trackCount(d.meta);
    if (typeof d.body !== "string" || !d.body) return;
    if (d.kind === "article-list" && d.bounded && d.meta) track(d.meta);
    if (d.kind === "complex-clusters") trackMarkers(d.body, d.meta);
    relay(d);
  });

  function trackMarkers(body, meta) {
    if (!meta || !meta.bbox) return;
    try {
      const r = JSON.parse(body).result ?? {};
      const markers = [...(r.clusters ?? []), ...(r.points ?? [])].filter((m) => m.complexNumber);
      markersSeen.push({
        bbox: meta.bbox,
        precision: meta.precision,
        total: typeof r.totalCount === "number" ? r.totalCount : markers.length,
        ids: markers.map((m) => `naver-${m.complexNumber}`),
        filled: markers.filter((m) => m.totalHouseholdNumber > 0).map((m) => `naver-${m.complexNumber}`),
      });
    } catch (e) {
      console.debug("[실입주 수집기] 단지 마커 응답 해석 실패", e);
    }
  }

  function onHttpError(status, url) {
    const listCall = new URL(url, location.href).pathname.includes("/article/boundedArticles");
    if (status !== 429 && !(listCall && status === 403)) return;
    run.blocked = status;
    run.stop = true;
    render();
  }

  function trackCount(meta) {
    if (!meta) return;
    view.total = meta.total;
    view.bbox = meta.bbox ?? view.bbox;
    view.precision = meta.precision ?? view.precision;
  }

  function track(meta) {
    if (meta.seed !== null && meta.seed !== list.seed) Object.assign(list, { seed: meta.seed, pages: 0, groups: 0 });
    list.pages += 1;
    list.groups += meta.groups;
    if (meta.total !== null) list.total = meta.total;
    list.hasNext = meta.hasNext;
    received += 1;
    render();
  }

  async function relay(d) {
    try {
      const res = await chrome.runtime.sendMessage({ type: "collect", kind: d.kind, url: d.url, body: d.body });
      if (res && res.ok) {
        app.saved = res;
        app.error = null;
      } else if (res && res.error) {
        app.error = res.error;
      }
    } catch (e) {
      app.error = "확장을 다시 불러왔다면 이 탭을 새로고침해 주세요.";
      console.debug("[실입주 수집기] 확장으로 전달하지 못했습니다", e);
    }
    render();
  }

  function findListButton() {
    return [...document.querySelectorAll("button[class*='BottomInfoControls']")].find((b) => /^\s*매물/.test(b.innerText)) || null;
  }

  function findListContainer() {
    let best = null;
    let bestCount = 0;
    for (const el of document.querySelectorAll("div, ul, section")) {
      if (el.scrollHeight <= el.clientHeight + 100) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll") continue;
      const count = el.querySelectorAll("li").length;
      if (count > bestCount) {
        best = el;
        bestCount = count;
      }
    }
    return best;
  }

  const stopStatus = () => (run.blocked ? "blocked" : "stopped");

  async function collectList() {
    if (!findListContainer()) {
      await waitFor(() => findListButton() !== null || run.stop, 8000);
      const btn = findListButton();
      if (!btn) return { status: run.stop ? stopStatus() : "no-button" };
      Object.assign(list, { seed: null, pages: 0, groups: 0, total: null, hasNext: true });
      const before = received;
      btn.click();
      await waitFor(() => received > before || run.stop, 8000);
    }
    const first = received;
    let idle = 0;
    while (!run.stop && received - first < MAX_PAGES) {
      if (list.pages > 0 && !list.hasNext) break;
      // 가려진 탭은 화면을 그리지 않아 목록이 다음 쪽을 부르지 않으므로 돌아올 때까지 기다린다
      if (document.hidden) {
        run.message = "창이 가려져 잠시 멈췄습니다. 이 창이 보이면 이어서 가져옵니다.";
        render();
        await waitFor(() => !document.hidden || run.stop, 24 * 60 * 60 * 1000);
        continue;
      }
      const box = findListContainer();
      const before = received;
      if (box) {
        // 바닥에 머문 채로는 목록이 다음 쪽을 부르지 않으므로 조금 올렸다가 다시 끝까지 내린다
        box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight * 2);
        await sleep(400);
        box.scrollTop = box.scrollHeight;
        await waitFor(() => received > before || run.stop, 6000);
      } else {
        await sleep(1500);
      }
      idle = received > before ? 0 : idle + 1;
      if (idle >= 3) break;
      await sleep(1200 + Math.random() * 800);
    }
    const counts = { groups: list.groups, pages: list.pages, total: list.total };
    if (run.stop) return { status: stopStatus(), ...counts };
    if (list.pages > 0 && !list.hasNext) return { status: "done", ...counts };
    if (received - first >= MAX_PAGES) return { status: "cap", ...counts };
    return { status: "stalled", ...counts };
  }

  const MANUAL_MESSAGES = {
    done: "이 화면의 매물을 끝까지 가져왔습니다. 실입주 앱이 저절로 다시 검색합니다.",
    stopped: "중지했습니다. 지금까지 불러온 매물은 저장되었습니다.",
    cap: `한 번에 ${MAX_PAGES}쪽까지만 가져옵니다. 지도를 확대해 나눠서 가져오세요.`,
    stalled: "목록이 더 불러와지지 않아 멈췄습니다. 목록을 손으로 조금 내린 뒤 다시 눌러 주세요.",
    "no-button": "지도 아래 '매물 N개' 버튼을 찾지 못했습니다. 지도를 조금 움직인 뒤 다시 눌러 주세요.",
  };

  async function startManual() {
    if (run.active) return;
    if (!onMap()) {
      run.message = "지도 화면에서만 가져올 수 있습니다. 단지·매물 화면은 열기만 해도 저장됩니다.";
      return render();
    }
    Object.assign(run, { active: true, stop: false, blocked: null, message: "매물 목록을 여는 중입니다." });
    app.error = null;
    render();
    const r = await collectList();
    run.active = false;
    run.message = r.status === "blocked" ? `네이버가 요청을 잠시 막았습니다(HTTP ${run.blocked}). 한참 뒤에 다시 시도하세요.` : MANUAL_MESSAGES[r.status];
    render();
  }

  const loadJob = async () => (await chrome.storage.local.get("job")).job ?? null;

  async function saveJob(patch) {
    const cur = await loadJob();
    if (!cur || !job || cur.id !== job.id || cur.token !== job.token) return false;
    job = { ...cur, ...patch(cur), updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ job });
    return true;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.job || !job) return;
    const next = changes.job.newValue;
    if (!next || next.id !== job.id || next.token !== job.token) {
      run.stop = true;
      job = null;
    } else {
      job = next;
      if (!ACTIVE.has(next.status)) run.stop = true;
    }
    render();
  });

  async function runJob() {
    job = await loadJob();
    if (!job || !ACTIVE.has(job.status) || sessionStorage.getItem(JOB_KEY) !== job.token) {
      job = null;
      return false;
    }
    Object.assign(run, { active: true, stop: false, blocked: null, message: "" });
    render();
    try {
      const households = job.phase === "households";
      if (job.status === "planning") await (households ? planHouseholds() : planJob());
      else await (households ? processHouseholdCell() : processCell());
    } catch (e) {
      console.debug("[실입주 수집기] 자동 수집 오류", e);
      await endJob("stalled", `자동 수집 중 오류가 났습니다(${e instanceof Error ? e.message : String(e)}). 앱에서 '이어서 수집'을 눌러 주세요.`);
    }
    return true;
  }

  function navigate(marker, url) {
    sessionStorage.setItem(CELL_KEY, marker);
    location.assign(url);
  }

  const cellUrl = (c) => `${MAP_URL}&center=${encodeCoord(c.lng)}-${encodeCoord(c.lat)}&zoom=${c.zoom}`;
  const gotoCell = () => navigate(`${job.token}:${job.index}`, cellUrl(job.cells[job.index]));
  const pause = () => sleep(2500 + Math.random() * 2000);

  async function planJob() {
    const box = regionsBox(job.regions);
    const marker = `${job.token}:plan`;
    if (sessionStorage.getItem(CELL_KEY) !== marker) {
      return navigate(marker, cellUrl({ lat: (box.top + box.bottom) / 2, lng: (box.left + box.right) / 2, zoom: BASE_ZOOM }));
    }
    run.message = "지도 크기를 재서 수집할 칸을 나누는 중입니다.";
    render();
    const ok = await waitFor(() => (view.bbox !== null && Number.isInteger(view.precision)) || run.stop, 20000);
    if (run.stop) return stopJob();
    if (!ok) return endJob("stalled", "지도 범위를 읽지 못했습니다. 지도 창을 띄워 둔 채 앱에서 '이어서 수집'을 눌러 주세요.");
    const cells = planCells(job.regions, view);
    await saveJob(() => ({ cells, index: 0, status: "running", message: "" }));
    await pause();
    if (run.stop) return stopJob();
    return gotoCell();
  }

  function viewMatches(v, cell) {
    const b = v.bbox;
    if (!b || v.precision !== cell.zoom) return false;
    const lat = (b.top + b.bottom) / 2;
    const lng = (b.left + b.right) / 2;
    return Math.abs(lat - cell.lat) < (b.top - b.bottom) * 0.1 && Math.abs(lng - cell.lng) < (b.right - b.left) * 0.1;
  }

  const sameView = (cell) => viewMatches(view, cell);

  async function processCell() {
    const cell = job.cells[job.index];
    if (!cell) return endJob("done", "");
    const marker = `${job.token}:${job.index}`;
    const visit = sessionStorage.getItem(CELL_KEY);
    if (visit !== marker && visit !== `${marker}:retry`) return gotoCell();
    run.message = `${cell.region} 칸의 매물 수를 확인하는 중입니다.`;
    render();
    const counted = await waitFor(() => (view.total !== null && sameView(cell)) || run.stop, 15000);
    if (run.stop) return stopJob();
    if (!counted) {
      if (visit === marker) return navigate(`${marker}:retry`, cellUrl(cell));
      return finishCell({ state: "failed" });
    }
    if (view.total === 0) return finishCell({ state: "empty", total: 0, groups: 0, pages: 0 });
    const share = targetShare(view.bbox, job.regions);
    if (share === 0 && cell.zoom > BASE_ZOOM) return finishCell({ state: "outside", total: view.total, groups: 0, pages: 0 });
    const mostlyOutside = share < 0.5 && view.total > 150 && cell.zoom < 15;
    if ((view.total > SPLIT_OVER || mostlyOutside) && cell.zoom < MAX_ZOOM) return splitCell(cell);
    run.message = `${cell.region} 칸의 매물 ${fmt(view.total)}건을 불러오는 중입니다. 이 창을 닫거나 최소화하지 마세요.`;
    render();
    const r = await collectList();
    if (r.status === "stopped" || r.status === "blocked") return stopJob();
    return finishCell({ state: r.status === "done" ? "done" : "partial", total: view.total, groups: r.groups, pages: r.pages });
  }

  // 칸 안에 고르게 찍은 8×8 점 중 수집 대상 지역 안에 드는 비율
  function targetShare(b, regions) {
    let hit = 0;
    for (let i = 0; i < 8; i++) {
      for (let k = 0; k < 8; k++) {
        const x = b.left + ((i + 0.5) / 8) * (b.right - b.left);
        const y = b.bottom + ((k + 0.5) / 8) * (b.top - b.bottom);
        if (regions.some((r) => r.parts.some((p) => inRing(x, y, p.ring)))) hit += 1;
      }
    }
    return hit / 64;
  }

  // 4등분한 칸의 중심을 0.24칸씩만 벌려 형제 칸끼리 조금 겹치게 하고(경계 매물 누락 방지), 대상 지역에 닿지 않는 칸은 버린다
  async function splitCell(cell) {
    const b = view.bbox;
    const dLat = (b.top - b.bottom) * 0.24;
    const dLng = (b.right - b.left) * 0.24;
    const halfLat = ((b.top - b.bottom) / 4) * 1.1;
    const halfLng = ((b.right - b.left) / 4) * 1.1;
    const kids = [
      [1, -1],
      [1, 1],
      [-1, -1],
      [-1, 1],
    ]
      .map(([y, x]) => ({ lat: r7(cell.lat + y * dLat), lng: r7(cell.lng + x * dLng), zoom: cell.zoom + 1, region: cell.region, state: "todo" }))
      .filter((k) => {
        const rect = { left: k.lng - halfLng, right: k.lng + halfLng, bottom: k.lat - halfLat, top: k.lat + halfLat };
        return job.regions.some((r) => r.parts.some((p) => rectHitsRing(rect, p.ring)));
      });
    await saveJob((j) => {
      const cells = j.cells.slice();
      cells[j.index] = { ...cells[j.index], state: "split", total: view.total };
      cells.splice(j.index + 1, 0, ...kids);
      return { cells, index: j.index + 1 };
    });
    await pause();
    if (run.stop) return stopJob();
    return gotoCell();
  }

  async function finishCell(result) {
    await saveJob((j) => {
      const cells = j.cells.slice();
      cells[j.index] = { ...cells[j.index], ...result };
      return { cells, index: j.index + 1 };
    });
    const recent = job.cells.slice(0, job.index).filter((c) => c.state !== "split").slice(-3);
    if (recent.length === 3 && recent.every((c) => c.state === "failed" || c.state === "partial")) {
      return endJob("stalled", "세 칸 연속 목록을 다 불러오지 못해 멈췄습니다. 지도 창을 확인한 뒤 앱에서 '이어서 수집'을 눌러 주세요.");
    }
    if (job.index >= job.cells.length) {
      const span = spanAt(HH_ZOOM);
      return span ? beginHouseholds(span) : endJob("done", "");
    }
    await pause();
    if (run.stop) return stopJob();
    return gotoCell();
  }

  function spanAt(zoom) {
    if (!view.bbox || !Number.isInteger(view.precision)) return null;
    const scale = 2 ** (view.precision - zoom);
    return { lng: (view.bbox.right - view.bbox.left) * scale, lat: (view.bbox.top - view.bbox.bottom) * scale };
  }

  function cellRect(cell, span) {
    const f = 2 ** (cell.zoom - HH_ZOOM);
    const halfLng = span.lng / f / 2;
    const halfLat = span.lat / f / 2;
    return { left: cell.lng - halfLng, right: cell.lng + halfLng, bottom: cell.lat - halfLat, top: cell.lat + halfLat };
  }

  const inRect = (p, r) => p.lng >= r.left && p.lng <= r.right && p.lat >= r.bottom && p.lat <= r.top;

  // 세대수가 빈 단지를 화면 크기의 0.9배 격자로 묶어, 단지가 하나라도 있는 격자만 그 중심에서 한 번씩 연다
  function planHouseholdCells(missing, span) {
    const stepLng = span.lng * 0.9;
    const stepLat = span.lat * 0.9;
    const cells = new Map();
    for (const m of missing) {
      const gx = Math.floor(m.lng / stepLng);
      const gy = Math.floor(m.lat / stepLat);
      const key = `${gx}:${gy}`;
      if (!cells.has(key)) cells.set(key, { lat: r7((gy + 0.5) * stepLat), lng: r7((gx + 0.5) * stepLng), zoom: HH_ZOOM, state: "todo" });
    }
    return [...cells.values()].sort((a, b) => b.lat - a.lat || a.lng - b.lng);
  }

  async function planHouseholds() {
    const marker = `${job.token}:hplan`;
    if (sessionStorage.getItem(CELL_KEY) !== marker) {
      const box = regionsBox(job.regions);
      return navigate(marker, cellUrl({ lat: (box.top + box.bottom) / 2, lng: (box.left + box.right) / 2, zoom: HH_ZOOM }));
    }
    run.message = "지도 크기를 재는 중입니다.";
    render();
    const ok = await waitFor(() => spanAt(HH_ZOOM) !== null || run.stop, 20000);
    if (run.stop) return stopJob();
    if (!ok) return endJob("stalled", "지도 범위를 읽지 못했습니다. 지도 창을 띄워 둔 채 앱에서 다시 눌러 주세요.");
    return beginHouseholds(spanAt(HH_ZOOM));
  }

  async function beginHouseholds(span) {
    run.message = "세대수가 빈 단지를 찾는 중입니다.";
    render();
    const res = await chrome.runtime.sendMessage({ type: "missing-households", regions: job.regions });
    if (!res || !res.ok) {
      const why = (res && res.error) || "응답 없음";
      return endJob(job.mode === "households" ? "stalled" : "done", `세대수가 빈 단지 목록을 받지 못했습니다(${why}).`);
    }
    const missing = res.items.map(({ id, lat, lng }) => ({ id, lat, lng }));
    if (missing.length === 0) return endJob("done", job.mode === "households" ? "세대수가 빈 단지가 없습니다." : "");
    const hcells = planHouseholdCells(missing, span);
    await saveJob(() => ({ status: "running", phase: "households", hspan: span, missing, missingAtStart: missing.length, hcells, hindex: 0, hfound: 0, message: "" }));
    return gotoNextHouseholdCell(false);
  }

  async function processHouseholdCell() {
    const cell = job.hcells[job.hindex];
    if (!cell) return endJob("done", householdsDoneMessage());
    const marker = `${job.token}:h${job.hindex}`;
    const visit = sessionStorage.getItem(CELL_KEY);
    if (visit !== marker && visit !== `${marker}:retry`) return gotoNextHouseholdCell(false);
    run.message = "세대수가 빈 단지 주변의 단지 정보를 받는 중입니다. 이 창을 닫거나 최소화하지 마세요.";
    render();
    let seen = null;
    const ok = await waitFor(() => {
      seen = markersSeen.find((m) => viewMatches(m, cell)) ?? null;
      return seen !== null || run.stop;
    }, 15000);
    if (run.stop) return stopJob();
    if (!ok || !seen) {
      if (visit === marker) return navigate(`${marker}:retry`, cellUrl(cell));
      return finishHouseholdCell({ state: "failed" }, job.missing, []);
    }
    const seenIds = new Set(seen.ids);
    const filledIds = new Set(seen.filled);
    const stillMissing = job.missing.filter((m) => !seenIds.has(m.id));
    const found = job.missing.filter((m) => filledIds.has(m.id)).length;
    const complete = seen.ids.length >= seen.total;
    const kids = complete || cell.zoom >= HH_MAX_ZOOM ? [] : splitHouseholdCell(cell, stillMissing);
    const state = kids.length > 0 ? "split" : "done";
    return finishHouseholdCell({ state, total: seen.total, markers: seen.ids.length, found }, stillMissing, kids);
  }

  function splitHouseholdCell(cell, missing) {
    const r = cellRect(cell, job.hspan);
    const dLng = (r.right - r.left) / 4;
    const dLat = (r.top - r.bottom) / 4;
    return [
      [1, -1],
      [1, 1],
      [-1, -1],
      [-1, 1],
    ]
      .map(([y, x]) => ({ lat: r7(cell.lat + y * dLat), lng: r7(cell.lng + x * dLng), zoom: cell.zoom + 1, state: "todo" }))
      .filter((k) => missing.some((m) => inRect(m, cellRect(k, job.hspan))));
  }

  async function finishHouseholdCell(result, missing, kids) {
    await saveJob((j) => {
      const hcells = j.hcells.slice();
      hcells[j.hindex] = { ...hcells[j.hindex], ...result };
      hcells.splice(j.hindex + 1, 0, ...kids);
      return { hcells, hindex: j.hindex + 1, missing, hfound: (j.hfound ?? 0) + (result.found ?? 0) };
    });
    const recent = job.hcells.slice(0, job.hindex).filter((c) => c.state === "done" || c.state === "failed").slice(-3);
    if (recent.length === 3 && recent.every((c) => c.state === "failed")) {
      return endJob("stalled", "세 곳 연속 단지 정보를 받지 못해 멈췄습니다. 지도 창을 확인한 뒤 앱에서 '세대수 빈 단지 채우기'를 다시 눌러 주세요.");
    }
    return gotoNextHouseholdCell(true);
  }

  // 앞 칸에서 이미 찾은 단지만 남은 칸은 열지 않고 건너뛴다
  async function gotoNextHouseholdCell(withPause) {
    await saveJob((j) => {
      const hcells = j.hcells.slice();
      let i = j.hindex;
      while (i < hcells.length && !j.missing.some((m) => inRect(m, cellRect(hcells[i], j.hspan)))) {
        hcells[i] = { ...hcells[i], state: "skipped" };
        i += 1;
      }
      return { hcells, hindex: i };
    });
    if (job.hindex >= job.hcells.length) return endJob("done", householdsDoneMessage());
    if (withPause) await pause();
    if (run.stop) return stopJob();
    return navigate(`${job.token}:h${job.hindex}`, cellUrl(job.hcells[job.hindex]));
  }

  function householdsDoneMessage() {
    const left = Array.isArray(job.missing) ? job.missing.length : 0;
    const head = job.mode === "households" ? "세대수 보완을 마쳤습니다." : "오늘 자동 수집을 마쳤습니다.";
    const tail = left > 0 ? ` 남은 ${fmt(left)}곳은 지도에서 세대수를 찾지 못했습니다.` : "";
    return `${head} 세대수 ${fmt(job.hfound ?? 0)}곳을 새로 채웠습니다.${tail} 실입주 앱이 저절로 다시 검색합니다.`;
  }

  async function endJob(status, message) {
    const done = status === "done";
    await saveJob(() => ({ status, message, finishedAt: done ? new Date().toISOString() : null }));
    run.active = false;
    run.message = message || (done ? "오늘 자동 수집을 마쳤습니다. 실입주 앱이 저절로 다시 검색합니다." : "");
    render();
  }

  function stopJob() {
    if (run.blocked) {
      return endJob("blocked", `네이버가 요청을 잠시 막았습니다(HTTP ${run.blocked}). 한참 뒤에 앱에서 '이어서 수집'을 누르세요.`);
    }
    return endJob("stopped", "중지했습니다. 앱에서 '이어서 수집'을 누르면 남은 칸부터 계속합니다.");
  }

  function regionsBox(regions) {
    const pts = regions.flatMap((r) => r.parts.flatMap((p) => p.ring));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
  }

  // 지도 화면 범위(boundingBox)는 zoom이 1 오를 때마다 가로세로가 절반이 되므로 precision 차이로 기본 zoom의 칸 크기를 구한다
  function planCells(regions, v) {
    const scale = 2 ** (v.precision - BASE_ZOOM);
    const spanLng = (v.bbox.right - v.bbox.left) * scale;
    const spanLat = (v.bbox.top - v.bbox.bottom) * scale;
    const stepLng = spanLng * 0.92;
    const stepLat = spanLat * 0.92;
    const box = regionsBox(regions);
    const cols = Math.max(1, Math.ceil((box.right - box.left) / stepLng));
    const rows = Math.max(1, Math.ceil((box.top - box.bottom) / stepLat));
    const lng0 = (box.left + box.right) / 2 - ((cols - 1) * stepLng) / 2;
    const lat0 = (box.top + box.bottom) / 2 + ((rows - 1) * stepLat) / 2;
    const taken = new Set();
    const cells = [];
    for (const region of regions) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const key = `${r}:${c}`;
          if (taken.has(key)) continue;
          const lat = lat0 - r * stepLat;
          const lng = lng0 + c * stepLng;
          const rect = { left: lng - spanLng * 0.6, right: lng + spanLng * 0.6, bottom: lat - spanLat * 0.6, top: lat + spanLat * 0.6 };
          if (!region.parts.some((p) => rectHitsRing(rect, p.ring))) continue;
          taken.add(key);
          cells.push({ lat: r7(lat), lng: r7(lng), zoom: BASE_ZOOM, region: region.name, state: "todo" });
        }
      }
    }
    return cells;
  }

  // 짝수-홀수 규칙(ray casting)으로 점이 다각형 안에 있는지 판정
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // 두 선분이 서로 가로지르는지(외적 부호가 양쪽으로 갈리는지) 판정
  function segmentsCross(a, b, c, d) {
    const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
  }

  function rectHitsRing(r, ring) {
    if (ring.some(([x, y]) => x >= r.left && x <= r.right && y >= r.bottom && y <= r.top)) return true;
    const corners = [
      [r.left, r.top],
      [r.right, r.top],
      [r.right, r.bottom],
      [r.left, r.bottom],
    ];
    if (corners.some(([x, y]) => inRing(x, y, ring))) return true;
    for (let i = 0; i < ring.length - 1; i++) {
      for (let k = 0; k < 4; k++) {
        if (segmentsCross(ring[i], ring[i + 1], corners[k], corners[(k + 1) % 4])) return true;
      }
    }
    return false;
  }

  // 네이버 지도 주소의 좌표 표기: base62(값×1e7 + 2e9). 예) 126.9779692 → 3zhF48
  const encodeCoord = (v) => {
    let n = Math.round(v * 1e7) + 2e9;
    let s = "";
    while (n > 0) {
      s = B62[n % 62] + s;
      n = Math.floor(n / 62);
    }
    return s;
  };
  const decodeCoord = (s) => {
    if (s.includes(".")) return parseFloat(s);
    let n = 0;
    for (const ch of s) n = n * 62 + B62.indexOf(ch);
    return (n - 2e9) / 1e7;
  };

  function finMapUrlFromNewLand() {
    const ms = new URLSearchParams(location.search).get("ms");
    const [lat, lng, zoom] = (ms || "").split(",");
    if (!lat || !lng) return null;
    return `${cellUrl({ lat: decodeCoord(lat), lng: decodeCoord(lng), zoom: zoom || 15 })}#${AUTO_FLAG}`;
  }

  function openFinMap() {
    const url = finMapUrlFromNewLand();
    if (url) {
      window.open(url, "_blank");
      return;
    }
    run.message = "지도를 한 번 움직인 뒤 다시 눌러 주세요.";
    render();
  }

  function mount() {
    if (host || !document.body) return;
    host = document.createElement("div");
    host.dataset.silipju = "panel";
    host.style.cssText = "position:fixed;right:16px;bottom:96px;z-index:2147483646;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .card{width:288px;font:13px/1.45 "Pretendard","Apple SD Gothic Neo",system-ui,sans-serif;color:#1c2430;background:#fff;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.22);padding:12px 14px}
        .head{display:flex;align-items:center;gap:6px;font-weight:800;font-size:13.5px}
        .logo{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#1f6feb;color:#fff;font-size:11px;font-weight:900}
        .x{margin-left:auto;border:0;background:none;color:#8a94a6;cursor:pointer;font-size:18px;line-height:1;padding:0 2px}
        .msg{margin:6px 0 8px;color:#5b6575}
        .bar{height:6px;border-radius:99px;background:#eef1f5;overflow:hidden;margin:6px 0}
        .bar i{display:block;height:100%;background:#1f6feb;width:0;transition:width .3s}
        .stat div{font-variant-numeric:tabular-nums}
        .ok{color:#137a4c;font-weight:600}.err{color:#c43c3c}
        .row{display:flex;gap:6px;margin-top:10px}
        button.main{flex:1;height:34px;border:0;border-radius:9px;background:#1f6feb;color:#fff;font-weight:700;cursor:pointer}
        button.main.stop{background:#1c2430}
        button.main:disabled{background:#aab4c3;cursor:default}
        button.sub{height:34px;padding:0 10px;border:1px solid #d5dbe4;border-radius:9px;background:#fff;color:#1c2430;font-weight:600;cursor:pointer}
        .min .body{display:none}
      </style>
      <div class="card">
        <div class="head"><span class="logo">실</span>실입주 수집기<button class="x" type="button" title="접기·펼치기">–</button></div>
        <div class="body">
          <div class="msg"></div>
          <div class="bar"><i></i></div>
          <div class="stat"></div>
          <div class="row"><button class="main" type="button"></button><button class="sub" type="button">실입주에서 보기</button></div>
        </div>
      </div>`;
    document.body.appendChild(host);
    root.querySelector(".x").addEventListener("click", () => root.querySelector(".card").classList.toggle("min"));
    root.querySelector(".sub").addEventListener("click", async () => {
      const { appUrl = "http://localhost:3210" } = await chrome.storage.local.get("appUrl");
      window.open(appUrl, "silipju-app");
    });
    root.querySelector(".main").addEventListener("click", () => {
      if (IS_NEW) openFinMap();
      else if (run.active) {
        run.stop = true;
        render();
      } else startManual();
    });
    render();
  }

  function render() {
    if (!root) return;
    const $ = (s) => root.querySelector(s);
    const main = $(".main");
    if (IS_NEW) {
      $(".msg").textContent =
        run.message || "이 예전 지도는 단지를 하나씩 열어야 매물이 보입니다. 같은 위치를 네이버페이 새 지도로 열어 이 지역 매매 매물을 한 번에 가져옵니다.";
      $(".bar").style.display = "none";
      main.textContent = "새 지도에서 이 지역 가져오기";
      return;
    }
    const lines = [];
    const listDone = list.pages > 0 && !list.hasNext;
    let pct = listDone ? 100 : list.total ? Math.min(100, Math.round((list.groups / list.total) * 100)) : 6;
    if (job && job.phase === "households" && Array.isArray(job.hcells) && job.hcells.length > 0) {
      const leaves = job.hcells.filter((c) => c.state !== "split" && c.state !== "skipped");
      const finished = leaves.filter((c) => c.state !== "todo").length;
      pct = leaves.length > 0 ? Math.round((finished / leaves.length) * 100) : 100;
      lines.push(["", `세대수 보완 ${fmt(finished)}/${fmt(leaves.length)}곳 · 새로 채운 단지 ${fmt(job.hfound ?? 0)}곳`]);
    } else if (job && Array.isArray(job.cells) && job.cells.length > 0) {
      const leaves = job.cells.filter((c) => c.state !== "split");
      const finished = leaves.filter((c) => c.state !== "todo").length;
      const cell = job.cells[job.index];
      pct = Math.round((finished / leaves.length) * 100);
      lines.push(["", `자동 수집 ${cell ? cell.region : ""} · ${fmt(finished)}/${fmt(leaves.length)}칸 완료`]);
    }
    if (list.pages > 0) {
      lines.push([
        "",
        listDone && list.total !== null
          ? `지도 목록 ${fmt(list.total)}건을 모두 불러옴`
          : list.total !== null
            ? `지도 목록 ${fmt(list.total)}건 중 ${fmt(Math.min(list.groups, list.total))}건 불러옴`
            : `${fmt(list.groups)}건 불러옴`,
      ]);
    }
    if (app.saved) lines.push(["ok", `앱 실매물 단지 ${fmt(app.saved.complexes)} · 매물 ${fmt(app.saved.units)}`]);
    if (app.error) lines.push(["err", app.error]);
    $(".bar").style.display = run.active || list.pages > 0 || job ? "" : "none";
    $(".bar i").style.width = `${pct}%`;
    $(".msg").textContent =
      run.message ||
      (job && job.message) ||
      (onMap()
        ? "위쪽 필터(매매·아파트·가격·면적)를 고른 뒤 누르면 지금 지도 화면의 매물을 끝까지 불러와 실입주 앱에 저장합니다. 세안고는 실입주 앱에서 걸러집니다."
        : "단지·매물 화면은 열기만 해도 저장됩니다. 지역 매물을 한 번에 가져오려면 지도 화면에서 누르세요.");
    $(".stat").replaceChildren(
      ...lines.map(([cls, text]) => {
        const div = document.createElement("div");
        div.className = cls;
        div.textContent = text;
        return div;
      }),
    );
    main.textContent = run.active ? (job ? "자동 수집 중지" : "중지") : "실입주로 가져오기";
    main.classList.toggle("stop", run.active);
    main.disabled = !run.active && !onMap();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "start-import") return;
    if (IS_NEW) {
      const openUrl = finMapUrlFromNewLand();
      sendResponse(openUrl ? { ok: true, openUrl } : { ok: false, error: "지도를 한 번 움직인 뒤 다시 눌러 주세요." });
      return;
    }
    if (!onMap()) {
      sendResponse({ ok: false, error: "네이버페이 부동산 지도 화면에서 눌러 주세요." });
      return;
    }
    sendResponse({ ok: true });
    startManual();
  });

  async function ready() {
    mount();
    let lastPath = location.pathname;
    setInterval(() => {
      if (host && !host.isConnected && document.body) document.body.appendChild(host);
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      render();
    }, 1000);
    if (IS_FIN && (await runJob())) return;
    if (!autoStart) return;
    sessionStorage.setItem(AUTO_FLAG, "done");
    run.message = "잠시 뒤 이 지역 매물을 자동으로 가져옵니다.";
    render();
    setTimeout(startManual, 1500);
  }
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready);
})();
