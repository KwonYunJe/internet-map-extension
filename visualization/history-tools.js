let historyTimer = null;
let historyVersion = 0;
let comparisonVersion = 0;
let historyRecords = [];
let historyGraph = null;
let historyIndex = 0;
let historyActive = false;
let historySpeed = 1;
const HISTORY_SPEEDS = [0.5, 1, 2, 4, 8];
let historyDatePicker = null;

const HISTORY_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>'
};

function setHistoryPlaying(playing) {
  const play = document.querySelector("#historyPlay");
  if (!play) return;
  play.innerHTML = playing ? HISTORY_ICONS.pause : HISTORY_ICONS.play;
  play.setAttribute("aria-label", playing ? "일시정지" : "재생");
  play.title = playing ? "일시정지" : "재생";
  play.classList.toggle("is-playing", playing);
}

function getHistorySlider() {
  return document.querySelector("#historySlider")?.noUiSlider || null;
}

function setHistorySliderEnabled(enabled) {
  const element = document.querySelector("#historySlider");
  if (!element?.noUiSlider) return;
  if (enabled) element.noUiSlider.enable(); else element.noUiSlider.disable();
}

function updateHistorySpeedButton() {
  const button = document.querySelector("#historySpeed");
  if (!button) return;
  button.textContent = `×${historySpeed}`;
  button.setAttribute("aria-label", `재생 속도 ${historySpeed}배, 눌러서 변경`);
  button.title = "재생 속도 변경";
}

// Playback advances continuously: the handle glides between visits and the map
// switches site at the moment the handle reaches the next visit.
const HISTORY_STEP_MS = 1200;
let historyClock = null;

function getHistoryPosition() {
  const value = Number(getHistorySlider()?.get());
  return Number.isFinite(value) ? value : historyIndex;
}

function startHistoryTimer() {
  cancelAnimationFrame(historyTimer);
  const position = Math.min(Math.max(getHistoryPosition(), historyIndex), historyIndex + 0.999);
  historyClock = { time: performance.now(), position };
  const step = now => {
    const last = historyRecords.length - 1;
    const position = Math.min(last, historyClock.position + (now - historyClock.time) * historySpeed / HISTORY_STEP_MS);
    const index = Math.floor(position + 1e-6);
    if (index !== historyIndex) {
      historyIndex = index;
      showHistoryRecord({ syncSlider: false });
    }
    getHistorySlider()?.set(position, false);
    if (position >= last) { pauseHistory(); return; }
    historyTimer = requestAnimationFrame(step);
  };
  historyTimer = requestAnimationFrame(step);
}

function getDisplayedPeriodLabel() {
  return historyActive ? `${document.querySelector("#historyDate").value} · 하루 전체` : PERIODS[activePeriodKey].label;
}

function localDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function stopHistoryPlayback() {
  cancelAnimationFrame(historyTimer);
  historyTimer = null;
  historyVersion++;
  comparisonVersion++;
  historyActive = false;
  historyRecords = [];
  historyGraph = null;
  document.querySelector("#historyFavicons")?.replaceChildren();
  const play = document.querySelector("#historyPlay");
  if (play) {
    setHistoryPlaying(false);
    play.disabled = false;
    setHistorySliderEnabled(false);
    getHistorySlider()?.set(0);
    document.querySelector("#historyStatus").textContent = "날짜를 선택하고 재생하세요. 각 방문을 시간순으로 보여줍니다.";
  }
}

function showHistoryRecord({ syncSlider = true } = {}) {
  const record = historyRecords[historyIndex];
  if (!record) return;
  const node = historyGraph.nodes.find(node => node.domain === record.domain);
  svg.onpointerleave?.();
  if (node) selectNode(node, historyGraph, { toggle: false, singleNode: true });
  document.querySelectorAll(".edge-pair").forEach(group => {
    group.classList.remove("edge-highlight", "edge-hovered");
    group.classList.add("dimmed");
  });
  updateHistoryStops();
  const date = document.querySelector("#historyDate").value;
  const eyebrow = document.querySelector("#detail .panel-eyebrow");
  if (eyebrow) eyebrow.textContent = `${date} · 하루 전체 상세정보`;
  if (syncSlider) getHistorySlider()?.set(historyIndex, false);
  const time = new Date(record.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  document.querySelector("#historyStatus").textContent = `${time} · ${record.fromDomain ? record.fromDomain + " → " : ""}${record.domain} · ${historyIndex + 1}/${historyRecords.length}`;
}

function pauseHistory() {
  cancelAnimationFrame(historyTimer);
  historyTimer = null;
  setHistoryPlaying(false);
}

async function playHistory() {
  if (historyTimer) { pauseHistory(); return; }
  const play = document.querySelector("#historyPlay");
  if (!historyActive) {
    const version = ++historyVersion;
    ++periodRenderVersion;
    ++comparisonVersion;
    const dateValue = document.querySelector("#historyDate").value;
    const start = new Date(`${dateValue}T00:00:00`);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    if (!Number.isFinite(start.getTime()) || start.getTime() > Date.now()) {
      document.querySelector("#historyStatus").textContent = "오늘 또는 이전 날짜를 선택하세요.";
      return;
    }
    const range = { start: start.getTime(), end: Math.min(end.getTime(), Date.now()), label: `${dateValue} · 이동 재생` };
    play.disabled = true;
    document.querySelector("#historyStatus").textContent = "이동 기록을 불러오는 중…";
    try {
      const response = await requestMapData({ type: "GET_SESSIONS", range });
      if (version !== historyVersion) return;
      historyRecords = clipSessionsToRange(response.sessions, range).map(groupSessionBySite).sort((a, b) => a.startedAt - b.startedAt);
      if (!historyRecords.length) {
        document.querySelector("#historyStatus").textContent = "이 날짜에는 이동 기록이 없습니다.";
        return;
      }
      historyGraph = aggregateSessions(historyRecords);
      renderGraph(historyGraph, range);
      clearSelection();
      historyActive = true;
      historyIndex = 0;
      getHistorySlider()?.updateOptions({ range: { min: 0, max: Math.max(1, historyRecords.length - 1) } }, false);
      setHistorySliderEnabled(historyRecords.length > 1);
      renderHistoryFavicons();
      document.querySelector("#periodComparison").textContent = "재생 중에는 선택한 하루의 전체 지도를 표시합니다. 기간 비교는 지도로 돌아가면 표시됩니다.";
    } catch (error) {
      if (version === historyVersion) document.querySelector("#historyStatus").textContent = `불러오지 못했습니다: ${error.message}`;
      return;
    } finally {
      if (version === historyVersion) play.disabled = false;
    }
  } else if (historyIndex >= historyRecords.length - 1) historyIndex = 0;
  showHistoryRecord();
  if (historyRecords.length < 2) return;
  setHistoryPlaying(true);
  startHistoryTimer();
}

// Only navigation moments (a change of site) get a favicon on the timeline.
function getHistoryStopIndices() {
  return historyRecords.reduce((indices, record, index) => {
    if (index === 0 || record.domain !== historyRecords[index-1].domain) indices.push(index);
    return indices;
  }, []);
}

function updateHistoryStops() {
  const stops = [...document.querySelectorAll(".history-stop")];
  let current = null;
  for (const stop of stops) if (Number(stop.dataset.index) <= historyIndex) current = stop;
  stops.forEach((stop, order) => {
    const active = stop === current;
    stop.setAttribute("aria-current", String(active));
    // Later stops overlap earlier ones; the active stop always stays on top.
    stop.style.zIndex = String(active ? stops.length + 1 : order + 1);
  });
}

function loadHistoryFavicon(image, button, record) {
  const node = historyGraph?.nodes.find(item => item.domain === record.domain) || {};
  const candidates = getFaviconCandidates({
    domain: record.domain,
    faviconUrl: record.faviconUrl || node.faviconUrl,
    faviconPageUrl: record.faviconPageUrl || record.pageUrl || node.faviconPageUrl
  });
  let attempt = 0;
  image.onerror = () => {
    if (++attempt < candidates.length) { image.src = candidates[attempt]; return; }
    image.remove();
    button.textContent = record.domain.charAt(0).toUpperCase();
  };
  image.src = candidates[0];
}

function renderHistoryFavicons() {
  const container = document.querySelector("#historyFavicons");
  container.replaceChildren();
  const fragment = document.createDocumentFragment();
  const last = Math.max(1, historyRecords.length - 1);
  for (const index of getHistoryStopIndices()) {
    const record = historyRecords[index];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-stop";
    button.dataset.index = String(index);
    button.style.left = `${historyRecords.length > 1 ? index/last*100 : 0}%`;
    const time = new Date(record.startedAt).toLocaleTimeString();
    button.title = `${time} · ${record.domain}`;
    button.setAttribute("aria-label", button.title);
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    loadHistoryFavicon(image, button, record);
    button.appendChild(image);
    button.addEventListener("click", () => { pauseHistory(); historyIndex=index; showHistoryRecord(); });
    fragment.appendChild(button);
  }
  container.appendChild(fragment);
  updateHistoryStops();
}

function initializeHistoryTools() {
  document.querySelector("#historyTools").innerHTML = `
    <div class="history-header">
      <span class="history-title">하루 기록 재생</span>
      <label class="history-date" for="historyDate">
        <span class="history-date-icon">${HISTORY_ICONS.calendar}</span>
        <input id="historyDate" type="text" aria-label="재생할 날짜" placeholder="날짜 선택">
      </label>
      <p id="historyStatus" role="status">날짜를 선택하고 재생하세요. 각 방문을 시간순으로 보여줍니다.</p>
    </div>
    <div class="history-player">
      <button id="historyPlay" class="history-play glass-bubble" type="button"></button>
      <div class="history-timeline">
        <div id="historySlider" aria-label="방문 순서"></div>
        <div id="historyFavicons" aria-label="시간순 방문 사이트"></div>
      </div>
      <button id="historySpeed" class="history-speed" type="button"></button>
    </div>
    <svg class="history-optics" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="historyHandleLens" x="0" y="0" width="24" height="24" filterUnits="userSpaceOnUse"
        primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
        <feImage id="historyHandleLensMap" x="0" y="0" width="24" height="24" preserveAspectRatio="none" result="field"/>
        <feDisplacementMap in="SourceGraphic" in2="field" scale="16" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </svg>`;
  // The timeline handle refracts the glass tube beneath it like a node lens.
  if (typeof getCircularLensMap === "function") {
    document.querySelector("#historyHandleLensMap").setAttribute("href", getCircularLensMap());
  }
  setHistoryPlaying(false);
  updateHistorySpeedButton();

  const date = document.querySelector("#historyDate");
  const today = localDateValue(new Date());
  date.value = today;
  historyDatePicker = flatpickr(date, {
    locale: "ko",
    dateFormat: "Y-m-d",
    altInput: true,
    altFormat: "Y년 n월 j일 (D)",
    altInputClass: "history-date-input",
    defaultDate: today,
    maxDate: today,
    disableMobile: true,
    monthSelectorType: "static",
    position: "below left",
    onOpen: (_, __, picker) => picker.set("maxDate", localDateValue(new Date())),
    onChange: () => renderActivePeriod()
  });
  historyDatePicker.altInput.setAttribute("aria-label", "재생할 날짜");

  const sliderElement = document.querySelector("#historySlider");
  noUiSlider.create(sliderElement, {
    start: 0,
    range: { min: 0, max: 1 },
    connect: "lower",
    behaviour: "tap-drag",
    animate: false,
    keyboardSupport: false,
    handleAttributes: [{ "aria-label": "방문 순서" }]
  });
  sliderElement.noUiSlider.disable();
  sliderElement.noUiSlider.on("start", () => { if (historyActive) pauseHistory(); });
  sliderElement.noUiSlider.on("slide", values => {
    const index = Math.round(Number(values[0]));
    if (!historyActive || index === historyIndex) return;
    pauseHistory();
    historyIndex = index;
    showHistoryRecord({ syncSlider: false });
  });
  // Released handles settle onto the visit they represent.
  sliderElement.noUiSlider.on("end", () => { if (historyActive) getHistorySlider().set(historyIndex, false); });
  sliderElement.addEventListener("keydown", event => {
    if (!historyActive || sliderElement.hasAttribute("disabled")) return;
    const last = historyRecords.length - 1;
    const page = Math.max(1, Math.round(last / 10));
    const next = {ArrowRight: historyIndex + 1, ArrowUp: historyIndex + 1, ArrowLeft: historyIndex - 1, ArrowDown: historyIndex - 1,
      PageUp: historyIndex + page, PageDown: historyIndex - page, Home: 0, End: last}[event.key];
    if (next === undefined) return;
    event.preventDefault();
    pauseHistory();
    historyIndex = Math.max(0, Math.min(last, next));
    showHistoryRecord();
  });

  document.querySelector("#historyPlay").addEventListener("click", playHistory);
  document.querySelector("#historySpeed").addEventListener("click", () => {
    historySpeed = HISTORY_SPEEDS[(HISTORY_SPEEDS.indexOf(historySpeed) + 1) % HISTORY_SPEEDS.length];
    updateHistorySpeedButton();
    if (historyTimer) startHistoryTimer();
  });
  window.addEventListener("pagehide", stopHistoryPlayback);
}

function getPreviousPeriodRange(range, days) {
  // Shift both endpoints by local calendar days, preserving time-of-day and DST.
  const start = new Date(range.start);
  const end = new Date(range.end);
  start.setDate(start.getDate() - days);
  end.setDate(end.getDate() - days);
  return { start: start.getTime(), end: end.getTime() };
}

async function updatePeriodComparison(range, sessions) {
  const version = ++comparisonVersion;
  const container = document.querySelector("#periodComparison");
  container.replaceChildren();
  if (range.start === null) {
    container.textContent = "전체 기간에는 이전 기간 비교가 없습니다. 오늘·7일·30일을 선택하세요.";
    return;
  }
  container.textContent = "이전 기간과 비교 중…";
  const days = PERIODS[range.key].days;
  const previousRange = getPreviousPeriodRange(range, days);
  try {
    const response = await requestMapData({ type: "GET_SESSIONS", range: previousRange });
    if (version !== comparisonVersion) return;
    const previous = aggregateSessions(clipSessionsToRange(response.sessions, previousRange));
    const current = aggregateSessions(sessions);
    const before = new Map(previous.nodes.map(node => [node.domain, node.activeTime]));
    const total = current.nodes.reduce((sum, node) => sum + node.activeTime, 0);
    const priorTotal = previous.nodes.reduce((sum, node) => sum + node.activeTime, 0);
    const delta = total - priorTotal;
    const heading = document.createElement("h3");
    heading.textContent = days === 1 ? "어제 같은 시각까지와 비교" : `이전 ${days}일의 같은 시각까지와 비교`;
    const summary = document.createElement("p");
    summary.textContent = `활성시간 ${formatDuration(total)} · ${delta >= 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}` +
      (priorTotal > 0 ? ` (${delta >= 0 ? "+" : ""}${Math.round(delta / priorTotal * 100)}%)` : " · 이전 기간 기록 없음");
    container.replaceChildren(heading, summary);
    const list = document.createElement("ul");
    const changes = current.nodes.map(node => ({ ...node, delta: node.activeTime - (before.get(node.domain) || 0) }))
      .filter(node => node.delta > 0 || !before.has(node.domain)).sort((a, b) => b.delta - a.delta).slice(0, 5);
    for (const node of changes) {
      const item = document.createElement("li");
      item.textContent = `${node.domain} · ${before.has(node.domain) ? "+" + formatDuration(node.delta) : "새 방문 · " + formatDuration(node.activeTime)}`;
      list.appendChild(item);
    }
    if (!changes.length) {
      const item = document.createElement("li");
      item.textContent = "이용시간이 늘거나 새로 방문한 사이트가 없습니다.";
      list.appendChild(item);
    }
    container.appendChild(list);
  } catch (error) {
    if (version === comparisonVersion) container.textContent = `기간 비교를 불러오지 못했습니다: ${error.message}`;
  }
}
