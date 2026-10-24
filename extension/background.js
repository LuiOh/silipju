// 수집한 응답을 로컬 실입주 앱(/api/import?source=extension)으로 보내고 수집 현황을 저장
const DEFAULTS = { appUrl: "http://localhost:3210", enabled: true };
const EMPTY_STATS = { lists: 0, details: 0, errors: 0, lastAt: null, lastMessage: "아직 수집한 매물이 없습니다." };

async function settings() {
  const s = await chrome.storage.local.get(["appUrl", "enabled"]);
  return { ...DEFAULTS, ...s };
}

async function updateStats(patch) {
  const { stats = EMPTY_STATS } = await chrome.storage.local.get("stats");
  const next = { ...stats, ...patch(stats) };
  await chrome.storage.local.set({ stats: next });
  const total = next.lists + next.details;
  await chrome.action.setBadgeText({ text: total > 0 ? String(Math.min(total, 999)) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: next.errors > 0 && next.lastMessage.startsWith("실패") ? "#d14343" : "#1f6feb" });
}

async function send(kind, body) {
  const { appUrl, enabled } = await settings();
  if (!enabled) return { ok: false, error: "수집이 꺼져 있습니다. 확장 아이콘을 눌러 켜 주세요." };
  try {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/import?source=extension`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || (json.warnings && json.warnings[0]) || `HTTP ${res.status}`);
    await updateStats((s) => ({
      lists: s.lists + (kind === "article-list" ? 1 : 0),
      details: s.details + (kind === "basic-info" ? 1 : 0),
      lastAt: new Date().toISOString(),
      lastMessage: `저장됨: 앱 전체 단지 ${json.complexes} · 매물 그룹 ${json.units} · 상세 ${json.enrichedAds}`,
    }));
    return { ok: true, complexes: json.complexes, units: json.units, ads: json.ads, enrichedAds: json.enrichedAds };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateStats((s) => ({
      errors: s.errors + 1,
      lastAt: new Date().toISOString(),
      lastMessage: `실패: ${message} (앱이 ${appUrl}에서 실행 중인지 확인)`,
    }));
    return { ok: false, error: `저장하지 못했습니다(${message}). 실입주 앱이 ${appUrl}에서 켜져 있는지 확인하세요.` };
  }
}

const MAP_URL = "https://fin.land.naver.com/map?tradeTypes=A1&realEstateTypes=A01";
const ACTIVE_JOB = ["planning", "running"];

// 같은 날 같은 지역 작업이 끝나지 않았으면 남은 칸부터 이어 간다. 지도 칸 계획은 지도 탭이 화면 크기를 재서 만든다.
// mode "households"는 매물 목록 없이 세대수가 빈 단지 주변 지도만 확대해 여는 작업이다
async function startJob(regions, restart, mode) {
  if (!Array.isArray(regions) || regions.length === 0) return { ok: false, error: "수집할 지역을 하나 이상 고르세요." };
  const householdsOnly = mode === "households";
  const date = new Date().toLocaleDateString("sv-SE");
  const regionIds = regions.map((r) => r.id);
  const id = `${date}:${regionIds.join(",")}${householdsOnly ? ":households" : ""}`;
  const { job: prev } = await chrome.storage.local.get("job");
  const now = new Date().toISOString();
  const token = crypto.randomUUID();
  const started = prev && ((Array.isArray(prev.cells) && prev.cells.length > 0) || (Array.isArray(prev.hcells) && prev.hcells.length > 0));
  const resume = !restart && prev && prev.id === id && prev.status !== "done" && started;
  const job = resume
    ? { ...prev, token, status: "running", message: "", updatedAt: now }
    : {
        id,
        date,
        mode: householdsOnly ? "households" : "full",
        phase: householdsOnly ? "households" : "listings",
        regionIds,
        regions,
        token,
        status: "planning",
        message: "",
        cells: null,
        index: 0,
        startedAt: now,
        updatedAt: now,
        finishedAt: null,
      };
  await chrome.storage.local.set({ job });
  await chrome.windows.create({ url: `${MAP_URL}#silipju-job=${token}`, focused: true, width: 1400, height: 900 });
  return { ok: true, resumed: Boolean(resume) };
}

// 빠짐없이 끝난 작업만 정리한다. 실패·부분 칸이 있으면 그 지역 매물이 일부 안 보였을 수 있어 지우지 않는다
async function pruneAfterJob(job) {
  if (job.mode === "households") return;
  const leaves = (job.cells ?? []).filter((c) => c.state !== "split");
  if (leaves.length === 0 || leaves.some((c) => c.state === "failed" || c.state === "partial")) return;
  const { appUrl } = await settings();
  const regions = job.regions.map((r) => ({ sido: r.sido ?? null, name: r.name }));
  try {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/collected/prune`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since: job.startedAt, regions }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    await updateStats(() => ({ lastAt: new Date().toISOString(), lastMessage: `수집 완료. 이번에 보이지 않은 매물 ${json.removed.units}건을 정리했습니다.` }));
  } catch (e) {
    console.debug("[실입주 수집기] 지난 매물 정리 실패", e);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.job) return;
  const { oldValue, newValue } = changes.job;
  if (newValue && newValue.status === "done" && (!oldValue || oldValue.status !== "done")) pruneAfterJob(newValue);
});

async function missingHouseholds(regions) {
  const { appUrl } = await settings();
  try {
    const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/collected/missing-households`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regions: regions.map((r) => ({ sido: r.sido ?? null, name: r.name })) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return { ok: true, items: json.items };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function stopJob() {
  const { job } = await chrome.storage.local.get("job");
  if (!job || !ACTIVE_JOB.includes(job.status)) return { ok: true };
  const message = "중지했습니다. '이어서 수집'을 누르면 남은 칸부터 계속합니다.";
  await chrome.storage.local.set({ job: { ...job, status: "stopped", message, updatedAt: new Date().toISOString() } });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "collect" && typeof msg.body === "string") {
    send(msg.kind, msg.body).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "start-job") {
    startJob(msg.regions, Boolean(msg.restart), msg.mode).then(sendResponse, (e) => sendResponse({ ok: false, error: `자동 수집을 시작하지 못했습니다(${e}).` }));
    return true;
  }
  if (msg && msg.type === "missing-households" && Array.isArray(msg.regions)) {
    missingHouseholds(msg.regions).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "stop-job") {
    stopJob().then(sendResponse);
    return true;
  }
  if (msg && msg.type === "reset-stats") chrome.storage.local.set({ stats: EMPTY_STATS }).then(() => chrome.action.setBadgeText({ text: "" }));
});
