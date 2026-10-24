// 팝업: 지역 자동 수집 현황·중지·이어서 수집, 지금 탭 가져오기, 설정 저장과 수집 기록 표시
const $ = (id) => document.getElementById(id);
const ACTIVE = ["planning", "running"];

function renderJob(job) {
  const inHouseholds = job?.phase === "households";
  const source = inHouseholds ? job?.hcells : job?.cells;
  const cells = Array.isArray(source) ? source.filter((c) => c.state !== "split" && c.state !== "skipped") : [];
  const done = cells.filter((c) => c.state !== "todo").length;
  const active = job && ACTIVE.includes(job.status);
  const resumable = job && !active && job.status !== "done" && cells.length > 0;
  const regions = job?.regions?.map((r) => r.name).join("·") ?? "";
  const text = !job
    ? "아직 시작한 자동 수집이 없습니다. 지역 고르기를 누르면 실입주 앱의 수집 화면이 열립니다."
    : job.status === "planning"
      ? inHouseholds
        ? `${regions} 세대수가 빈 단지를 찾는 중입니다.`
        : `${regions} 수집할 칸을 나누는 중입니다.`
      : job.status === "running"
        ? inHouseholds
          ? `${regions} 세대수 보완 중입니다. ${done}/${cells.length}곳 · 새로 채운 단지 ${job.hfound ?? 0}곳`
          : `${regions} 수집 중입니다. ${done}/${cells.length}칸`
        : job.message || (job.status === "done" ? `${job.date} ${regions} 수집을 마쳤습니다.` : `${done}/${cells.length}칸까지 받았습니다.`);
  $("jobStatus").textContent = text;
  $("jobBar").style.width = cells.length ? `${Math.round((done / cells.length) * 100)}%` : "0";
  $("stop").hidden = !active;
  $("resume").hidden = !resumable;
}

async function render() {
  const { appUrl = "http://localhost:3210", enabled = true, stats, job } = await chrome.storage.local.get(["appUrl", "enabled", "stats", "job"]);
  $("appUrl").value = appUrl;
  $("enabled").checked = enabled;
  $("lists").textContent = String(stats?.lists ?? 0);
  $("details").textContent = String(stats?.details ?? 0);
  $("errors").textContent = String(stats?.errors ?? 0);
  $("message").textContent = stats?.lastMessage ?? "아직 수집한 매물이 없습니다.";
  renderJob(job ?? null);
}

$("pick").addEventListener("click", () => chrome.tabs.create({ url: `${($("appUrl").value || "http://localhost:3210").replace(/\/$/, "")}/#collect` }));
$("stop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "stop-job" }));
$("resume").addEventListener("click", async () => {
  const { job } = await chrome.storage.local.get("job");
  if (!job) return;
  const res = await chrome.runtime.sendMessage({ type: "start-job", regions: job.regions, restart: false, mode: job.mode });
  if (res && !res.ok) $("jobStatus").textContent = res.error;
});

$("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$("appUrl").addEventListener("change", (e) => chrome.storage.local.set({ appUrl: e.target.value.trim() || "http://localhost:3210" }));
$("open").addEventListener("click", () => chrome.tabs.create({ url: $("appUrl").value || "http://localhost:3210" }));
$("import").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let res = null;
  try {
    if (tab && tab.id !== undefined) res = await chrome.tabs.sendMessage(tab.id, { type: "start-import" });
  } catch (e) {
    console.debug("[실입주 수집기] 탭에 가져오기를 요청하지 못했습니다", e);
  }
  if (res && res.openUrl) {
    await chrome.tabs.create({ url: res.openUrl });
    window.close();
  } else if (res && res.ok) {
    window.close();
  } else {
    $("importMsg").textContent =
      (res && res.error) || "네이버페이 부동산 지도 탭에서 눌러 주세요. 확장을 설치하거나 갱신했다면 그 탭을 한 번 새로고침해야 합니다.";
  }
});
$("reset").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "reset-stats" });
  setTimeout(render, 100);
});
chrome.storage.onChanged.addListener(render);
render();
