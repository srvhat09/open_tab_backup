const backupButton = document.getElementById("backupButton");
const copyButton = document.getElementById("copyButton");
const restoreButton = document.getElementById("restoreButton");
const exportCodeElement = document.getElementById("exportCode");
const importCodeElement = document.getElementById("importCode");
const savedAtElement = document.getElementById("savedAt");
const windowCountElement = document.getElementById("windowCount");
const tabCountElement = document.getElementById("tabCount");
const statusMessageElement = document.getElementById("statusMessage");

function setStatus(message, type = "") {
  statusMessageElement.textContent = message;
  statusMessageElement.className = type ? `status ${type}` : "status";
}

function setBusy(isBusy) {
  backupButton.disabled = isBusy;
  copyButton.disabled = isBusy;
  restoreButton.disabled = isBusy;
}

function formatDateTime(isoString) {
  if (!isoString) {
    return "未保存";
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "不明";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(date);
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(base64Text) {
  const binary = atob(base64Text);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function captureCurrentWindows() {
  const windows = await chrome.windows.getAll({ populate: true });
  const backupWindows = windows
    .filter((windowData) => windowData.type === "normal")
    .map((windowData) => {
      const tabs = (windowData.tabs || [])
        .filter((tab) => typeof tab.url === "string" && tab.url.length > 0)
        .map((tab) => ({ url: tab.url }));

      return {
        tabs
      };
    })
    .filter((windowData) => windowData.tabs.length > 0);

  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    windows: backupWindows
  };
}

function encodePayload(payload) {
  const json = JSON.stringify(payload);
  return bytesToBase64(new TextEncoder().encode(json));
}

function decodePayload(encodedText) {
  try {
    const normalized = encodedText.trim();
    const decoded = new TextDecoder().decode(base64ToBytes(normalized));
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error("インポートコードを読み取れません。コピー内容を確認してください。");
  }
}

function summarizePayload(payload) {
  return {
    savedAt: payload.savedAt,
    windowCount: payload.windows.length,
    tabCount: payload.windows.reduce((total, windowData) => total + windowData.tabs.length, 0)
  };
}

async function restoreBackup(payload) {
  if (!payload.windows.length) {
    throw new Error("復元できるウィンドウがありません。");
  }

  for (const windowData of payload.windows) {
    const urls = windowData.tabs.map((tab) => tab.url).filter(Boolean);
    if (!urls.length) {
      continue;
    }

    await chrome.windows.create({
      url: urls
    });
  }
}

function renderSummary(summary) {
  if (!summary) {
    savedAtElement.textContent = "未生成";
    windowCountElement.textContent = "-";
    tabCountElement.textContent = "-";
    return;
  }

  savedAtElement.textContent = formatDateTime(summary.savedAt);
  windowCountElement.textContent = String(summary.windowCount);
  tabCountElement.textContent = String(summary.tabCount);
}

async function copyExportCode() {
  const code = exportCodeElement.value.trim();
  if (!code) {
    throw new Error("先にエクスポートコードを生成してください。");
  }

  await navigator.clipboard.writeText(code);
}

async function handleBackupClick() {
  setBusy(true);
  setStatus("エクスポートコードを生成しています...");

  try {
    const payload = await captureCurrentWindows();
    if (!payload.windows.length) {
      throw new Error("出力対象の通常ウィンドウが見つかりません。");
    }

    const summary = summarizePayload(payload);
    exportCodeElement.value = encodePayload(payload);
    renderSummary(summary);
    setStatus(
      `${summary.windowCount}個のウィンドウ、${summary.tabCount}個のタブからコードを生成しました。`,
      "success"
    );
  } catch (error) {
    setStatus(error.message || "コード生成に失敗しました。", "error");
  } finally {
    setBusy(false);
  }
}

async function handleCopyClick() {
  setBusy(true);

  try {
    await copyExportCode();
    setStatus("エクスポートコードをクリップボードへコピーしました。", "success");
  } catch (error) {
    setStatus(error.message || "コピーに失敗しました。", "error");
  } finally {
    setBusy(false);
  }
}

async function handleRestoreClick() {
  setBusy(true);
  setStatus("復元中です...");

  try {
    const code = importCodeElement.value.trim();
    if (!code) {
      throw new Error("インポートコードを貼り付けてください。");
    }

    const payload = decodePayload(code);
    if (!payload || !Array.isArray(payload.windows)) {
      throw new Error("インポートコードの形式が正しくありません。");
    }

    await restoreBackup(payload);
    const summary = summarizePayload(payload);
    setStatus(
      `${summary.windowCount}個のウィンドウ、${summary.tabCount}個のタブを復元しました。`,
      "success"
    );
  } catch (error) {
    setStatus(error.message || "復元に失敗しました。", "error");
  } finally {
    setBusy(false);
  }
}

backupButton.addEventListener("click", handleBackupClick);
copyButton.addEventListener("click", handleCopyClick);
restoreButton.addEventListener("click", handleRestoreClick);
renderSummary(null);
