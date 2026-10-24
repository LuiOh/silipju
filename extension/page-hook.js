// 페이지 컨텍스트에서 네이버페이 부동산이 이미 받은 매물 목록·상세 응답을 읽어 확장으로 넘김(추가 요청 없음)
(() => {
  // 단지 매물 목록과, 지도 "매물 N개" 목록(화면 영역·법정동·클러스터 단위)은 응답 구조가 같다
  const LIST_PATHS = new Set([
    "/front-api/v1/complex/article/list",
    "/front-api/v1/article/boundedArticles",
    "/front-api/v1/article/legalDivisionArticleList",
    "/front-api/v1/article/clusteredArticles",
  ]);
  const DETAIL_PATH = "/front-api/v1/article/basicInfo";
  const COUNT_PATH = "/front-api/v1/article/boundedArticlesCount";
  const COMPLEX_PATH = "/front-api/v1/complex/complexClusters";
  const DETAIL_MARKER = '{"isSuccess":true,"result":{"priceInfo"';
  const sent = new Set();

  function pathOf(url) {
    try {
      return new URL(url, location.href).pathname;
    } catch {
      return "";
    }
  }
  const isTarget = (url) => LIST_PATHS.has(pathOf(url)) || pathOf(url) === DETAIL_PATH || pathOf(url) === COMPLEX_PATH;
  const kindOf = (url) => (LIST_PATHS.has(pathOf(url)) ? "article-list" : pathOf(url) === COMPLEX_PATH ? "complex-clusters" : "basic-info");
  const post = (msg) => window.postMessage({ source: "silipju-collector", body: "", meta: null, bounded: false, ...msg }, window.location.origin);

  function hash(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  // 지도 목록 요청 본문의 boundingBox·precision(=지도 zoom)으로 응답이 어느 화면 범위인지 안다
  function viewOf(reqBody) {
    try {
      const p = JSON.parse(reqBody);
      return { bbox: p.boundingBox ?? null, precision: p.precision ?? null };
    } catch {
      return { bbox: null, precision: null };
    }
  }

  function listMeta(body, reqBody) {
    try {
      const r = JSON.parse(body).result || {};
      return { groups: Array.isArray(r.list) ? r.list.length : 0, total: r.totalCount ?? null, hasNext: !!r.hasNextPage, seed: r.seed ?? null, ...viewOf(reqBody) };
    } catch {
      return null;
    }
  }

  function emit(kind, url, body, reqBody) {
    const key = `${kind}:${body.length}:${hash(body)}`;
    if (sent.has(key)) return;
    sent.add(key);
    const meta = kind === "article-list" ? listMeta(body, reqBody) : kind === "complex-clusters" ? viewOf(reqBody) : null;
    const bounded = pathOf(url) === "/front-api/v1/article/boundedArticles";
    post({ kind, url, body, meta, bounded });
  }

  function emitCount(url, body, reqBody) {
    try {
      const total = JSON.parse(body).result?.totalCount;
      if (typeof total === "number") post({ kind: "article-count", url, meta: { total, ...viewOf(reqBody) } });
    } catch (e) {
      console.debug("[실입주 수집기] 매물 수 응답 해석 실패", e);
    }
  }

  // 응답 텍스트에서 상세(basicInfo) JSON 객체를 중괄호 짝을 맞춰 잘라낸다(문자열 안의 괄호는 무시)
  function extractDetails(text) {
    const out = [];
    let from = 0;
    for (;;) {
      const i = text.indexOf(DETAIL_MARKER, from);
      if (i < 0) break;
      let depth = 0;
      let inStr = false;
      let end = -1;
      for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) {
          if (c === "\\") j++;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          end = j;
          break;
        }
      }
      if (end < 0) break;
      out.push(text.slice(i, end + 1));
      from = end + 1;
    }
    return out;
  }

  function inspect(url, text, reqBody, status) {
    const path = pathOf(url);
    if (status >= 400) {
      if (path.startsWith("/front-api/")) post({ kind: "http-error", url, status });
      return;
    }
    if (!text) return;
    if (path === COUNT_PATH) {
      emitCount(url, text, reqBody);
      return;
    }
    if (isTarget(url)) {
      emit(kindOf(url), url, text, reqBody);
      return;
    }
    if (text.includes(DETAIL_MARKER)) {
      for (const d of extractDetails(text)) emit("basic-info", url, d, null);
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
      const reqBody = args[1] && typeof args[1].body === "string" ? args[1].body : null;
      if (url.includes("fin.land.naver.com") || url.startsWith("/")) {
        res
          .clone()
          .text()
          .then((t) => inspect(new URL(url, location.href).href, t, reqBody, res.status))
          .catch((e) => console.debug("[실입주 수집기] 응답 본문을 읽지 못했습니다", e));
      }
    } catch (e) {
      console.debug("[실입주 수집기] fetch 응답 확인 실패", e);
    }
    return res;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__silipjuUrl = new URL(String(url), location.href).href;
    return originalOpen.call(this, method, url, ...rest);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const reqBody = typeof args[0] === "string" ? args[0] : null;
    this.addEventListener("load", () => {
      const url = this.__silipjuUrl || "";
      const path = pathOf(url);
      if (!isTarget(url) && path !== COUNT_PATH && !(this.status >= 400 && path.startsWith("/front-api/"))) return;
      const body =
        this.responseType === "" || this.responseType === "text"
          ? this.responseText
          : this.responseType === "json"
            ? JSON.stringify(this.response)
            : "";
      inspect(url, body, reqBody, this.status);
    });
    return originalSend.apply(this, args);
  };
  XMLHttpRequest.prototype.open.__silipju = true;
  window.fetch.__silipju = true;

  // 첫 화면 상세는 HTML 인라인 스크립트 self.__next_f.push([1,"..."])에 들어 있다.
  // Next.js가 hydration 뒤 window.__next_f 배열을 비우므로 DOM의 스크립트 텍스트에서 직접 읽는다.
  const FLIGHT_CHUNK = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  function scanInitialPage() {
    const parts = [];
    for (const s of document.scripts) {
      const src = s.textContent || "";
      if (!src.includes("__next_f.push")) continue;
      for (const m of src.matchAll(FLIGHT_CHUNK)) {
        try {
          parts.push(JSON.parse(`"${m[1]}"`));
        } catch (e) {
          console.debug("[실입주 수집기] flight 조각 해석 실패", e);
        }
      }
    }
    for (const d of extractDetails(parts.join(""))) emit("basic-info", location.href, d);
  }
  window.addEventListener("load", () => setTimeout(scanInitialPage, 500));
})();
