function requestMapData(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError?.message || response?.error;
      if (error || !response) reject(new Error(error || "확장프로그램 응답이 없습니다."));
      else resolve(response);
    });
  });
}

async function initializeDataTools() {
  const status = document.querySelector("#dataStatus");
  const toggle = document.querySelector("#trackingToggle");
  const fileInput = document.querySelector("#importFile");
  const buttons = [...document.querySelectorAll(".data-settings-menu button")];
  let enabled = true;
  function updateToggle(value) {
    enabled = value;
    toggle.textContent = enabled ? "기록 일시정지" : "기록 재개 (현재 일시정지)";
    toggle.setAttribute("aria-pressed", String(!enabled));
  }
  async function run(action) {
    buttons.forEach(button => button.disabled = true);
    status.textContent = "처리 중…";
    try { await action(); }
    catch (error) { status.textContent = `처리하지 못했습니다: ${error.message}`; }
    finally { buttons.forEach(button => button.disabled = false); }
  }
  toggle.addEventListener("click", () => run(async () => {
    const result = await requestMapData({ type: "SET_TRACKING_ENABLED", enabled: !enabled });
    updateToggle(result.enabled);
    status.textContent = enabled ? "기록을 재개했습니다." : "기록을 일시정지했습니다.";
    await renderActivePeriod();
  }));
  document.querySelector("#exportData").addEventListener("click", () => run(async () => {
    const { sessions } = await requestMapData({ type: "EXPORT_SESSIONS" });
    const blob = new Blob([JSON.stringify({ format: "internet-map", version: 1, exportedAt: new Date().toISOString(), sessions }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `internet-map-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = `${sessions.length.toLocaleString()}개 기록의 다운로드를 요청했습니다.`;
  }));
  document.querySelector("#importData").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    run(async () => {
      if (file.size > 50 * 1024 * 1024) throw new Error("50MB 이하 JSON 파일을 선택하세요.");
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data) && (data?.format !== "internet-map" || data.version !== 1)) {
        throw new Error("지원하지 않는 백업 형식입니다.");
      }
      const sessions = Array.isArray(data) ? data : data.sessions;
      if (!Array.isArray(sessions)) throw new Error("세션 목록이 없습니다.");
      const result = await requestMapData({ type: "IMPORT_SESSIONS", sessions });
      await renderActivePeriod();
      status.textContent = `${result.imported}개 추가, 중복 ${result.skipped}개 제외했습니다.`;
    });
  });
  document.querySelector("#clearData").addEventListener("click", () => {
    if (!window.confirm("모든 이용 기록을 영구 삭제할까요? 필요한 기록은 먼저 JSON으로 내보내세요. 이 작업은 되돌릴 수 없습니다.")) return;
    run(async () => {
      await requestMapData({ type: "CLEAR_SESSIONS" });
      layoutPositionMemory.clear();
      selectedDomain = null;
      await renderActivePeriod();
      status.textContent = "모든 이용 기록을 삭제했습니다.";
    });
  });
  try {
    updateToggle((await requestMapData({ type: "GET_TRACKING_STATUS" })).enabled);
    toggle.disabled = false;
  } catch (error) { status.textContent = error.message; }
}
