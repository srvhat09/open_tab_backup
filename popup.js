const STORAGE_META_KEY = "latestBackupMeta";
const STORAGE_CHUNK_PREFIX = "latestBackupChunk_";
const STORAGE_CHUNK_SIZE = 7000;

const backupButton = document.getElementById("backupButton");
const restoreButton = document.getElementById("restoreButton");
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

function splitIntoChunks(text, chunkSize) {
  const chunks = [];

  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }

  return chunks;
}

async function getLatestBackupMeta() {
  const stored = await chrome.storage.sync.get(STORAGE_META_KEY);
  return stored[STORAGE_META_KEY] || null;
}

async function getLatestBackupPayload() {
  const meta = await getLatestBackupMeta();
  if (!meta) {
    return null;
  }

  const keys = Array.from({ length: meta.chunkCount }, (_, index) => {
    return `${STORAGE_CHUNK_PREFIX}${String(index).padStart(3, "0")}`;
  });
  const storedChunks = await chrome.storage.sync.get(keys);
  const serialized = keys.map((key) => storedChunks[key] || "").join("");

  if (!serialized) {
    throw new Error("バックアップデータが見つかりません。");
  }

  return {
    meta,
    payload: JSON.parse(serialized)
  };
}

async function clearExistingBackupChunks(fromIndex, toIndex) {
  if (typeof fromIndex !== "number" || typeof toIndex !== "number" || fromIndex > toIndex) {
    return;
  }

  const keys = Array.from({ length: toIndex - fromIndex + 1 }, (_, offset) => {
    const index = fromIndex + offset;
    return `${STORAGE_CHUNK_PREFIX}${String(index).padStart(3, "0")}`;
  });
  await chrome.storage.sync.remove(keys);
}

async function saveLatestBackup(payload) {
  const previousMeta = await getLatestBackupMeta();
  const serialized = JSON.stringify(payload);
  const chunks = splitIntoChunks(serialized, STORAGE_CHUNK_SIZE);
  const data = {};

  chunks.forEach((chunk, index) => {
    data[`${STORAGE_CHUNK_PREFIX}${String(index).padStart(3, "0")}`] = chunk;
  });

  const meta = {
    schemaVersion: 1,
    savedAt: payload.savedAt,
    windowCount: payload.windows.length,
    tabCount: payload.windows.reduce((total, windowData) => total + windowData.tabs.length, 0),
    chunkCount: chunks.length
  };

  data[STORAGE_META_KEY] = meta;
  await chrome.storage.sync.set(data);

  if (previousMeta && previousMeta.chunkCount > chunks.length) {
    await clearExistingBackupChunks(chunks.length, previousMeta.chunkCount - 1);
  }

  return meta;
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

async function refreshSummary() {
  try {
    const meta = await getLatestBackupMeta();

    if (!meta) {
      savedAtElement.textContent = "未保存";
      windowCountElement.textContent = "-";
      tabCountElement.textContent = "-";
      return;
    }

    savedAtElement.textContent = formatDateTime(meta.savedAt);
    windowCountElement.textContent = String(meta.windowCount);
    tabCountElement.textContent = String(meta.tabCount);
  } catch (error) {
    setStatus(error.message || "保存情報の読み込みに失敗しました。", "error");
  }
}

async function handleBackupClick() {
  setBusy(true);
  setStatus("バックアップ中です...");

  try {
    const payload = await captureCurrentWindows();
    if (!payload.windows.length) {
      throw new Error("保存対象の通常ウィンドウが見つかりません。");
    }

    const meta = await saveLatestBackup(payload);
    await refreshSummary();
    setStatus(
      `${meta.windowCount}個のウィンドウ、${meta.tabCount}個のタブを保存しました。`,
      "success"
    );
  } catch (error) {
    setStatus(error.message || "バックアップに失敗しました。", "error");
  } finally {
    setBusy(false);
  }
}

async function handleRestoreClick() {
  setBusy(true);
  setStatus("復元中です...");

  try {
    const backup = await getLatestBackupPayload();
    if (!backup) {
      throw new Error("復元できるバックアップがありません。");
    }

    await restoreBackup(backup.payload);
    setStatus(
      `${backup.meta.windowCount}個のウィンドウ、${backup.meta.tabCount}個のタブを復元しました。`,
      "success"
    );
  } catch (error) {
    setStatus(error.message || "復元に失敗しました。", "error");
  } finally {
    setBusy(false);
  }
}

backupButton.addEventListener("click", handleBackupClick);
restoreButton.addEventListener("click", handleRestoreClick);

refreshSummary();
