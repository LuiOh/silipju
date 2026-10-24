// 실입주 앱 화면과 확장 사이의 다리: 앱이 고른 지역의 자동 수집을 시작·중지하고 진행 상황을 앱에 알림
(() => {
  const version = chrome.runtime.getManifest().version;
  const post = (msg) => window.postMessage({ source: "silipju-ext", ...msg }, location.origin);

  function summary(job) {
    if (!job) return null;
    const cells = Array.isArray(job.cells) ? job.cells : [];
    const leaves = cells.filter((c) => c.state !== "split");
    const finished = leaves.filter((c) => c.state !== "todo");
    const current = cells[job.index] ?? null;
    const hcells = (Array.isArray(job.hcells) ? job.hcells : []).filter((c) => c.state !== "split" && c.state !== "skipped");
    return {
      id: job.id,
      date: job.date,
      mode: job.mode ?? "full",
      phase: job.phase ?? "listings",
      status: job.status,
      message: job.message ?? "",
      regionIds: job.regionIds ?? [],
      cellsTotal: leaves.length,
      cellsDone: finished.length,
      region: current ? current.region : null,
      groups: finished.reduce((sum, c) => sum + (c.groups ?? 0), 0),
      households: job.phase === "households" || job.mode === "households"
        ? {
            cellsTotal: hcells.length,
            cellsDone: hcells.filter((c) => c.state !== "todo").length,
            found: job.hfound ?? 0,
            missingAtStart: job.missingAtStart ?? 0,
            missingLeft: Array.isArray(job.missing) ? job.missing.length : 0,
          }
        : null,
      startedAt: job.startedAt ?? null,
      updatedAt: job.updatedAt ?? null,
      finishedAt: job.finishedAt ?? null,
    };
  }

  async function hello() {
    const { job } = await chrome.storage.local.get("job");
    post({ type: "hello", version, job: summary(job) });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || d.source !== "silipju-app") return;
    try {
      if (d.type === "ping") await hello();
      else if (d.type === "job-start") {
        const res = await chrome.runtime.sendMessage({ type: "start-job", regions: d.regions, restart: Boolean(d.restart), mode: d.mode === "households" ? "households" : "full" });
        post({ type: "job-reply", ...res });
      } else if (d.type === "job-stop") {
        const res = await chrome.runtime.sendMessage({ type: "stop-job" });
        post({ type: "job-reply", ...res });
      }
    } catch (e) {
      console.debug("[실입주 수집기] 확장과 통신하지 못했습니다", e);
      post({ type: "job-reply", ok: false, error: "확장과 연결이 끊겼습니다. 확장을 다시 불러왔다면 이 페이지를 새로고침하세요." });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.job) post({ type: "job", job: summary(changes.job.newValue) });
  });

  hello();
})();
