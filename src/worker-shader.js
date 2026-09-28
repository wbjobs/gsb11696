const DB_NAME = "shader-hot-reload";
const DB_VERSION = 1;
const STORE_NAME = "shaders";
const SHADER_KEY = "fragment";
const DEBOUNCE_MS = 350;

let db = null;
let timer = 0;
let pendingSource = "";

function localFallbackGet() {
  return globalThis.localStorage
    ? globalThis.localStorage.getItem(`${DB_NAME}:${SHADER_KEY}`)
    : null;
}

function localFallbackSet(source) {
  if (!globalThis.localStorage) throw new Error("localStorage 不可用");
  globalThis.localStorage.setItem(`${DB_NAME}:${SHADER_KEY}`, source);
}

function openDatabase() {
  if (db) return Promise.resolve(db);

  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readShader() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(SHADER_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeShader(source) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      source,
      updatedAt: Date.now(),
    }, SHADER_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function persist(source, version) {
  try {
    await writeShader(source);
    self.postMessage({ type: "saved", version });
  } catch (error) {
    try {
      localFallbackSet(source);
      self.postMessage({
        type: "saved",
        version,
        warning: `IndexedDB 不可用，已降级到 localStorage：${error.message}`,
      });
    } catch (fallbackError) {
      self.postMessage({
        type: "persist-error",
        version,
        message: `源码无法持久化：${fallbackError.message}`,
      });
    }
  }
}

self.onmessage = async (event) => {
  const message = event.data;

    if (message.type === "load") {
    try {
      const record = await readShader();
      self.postMessage({ type: "loaded", record });
    } catch (error) {
      try {
        const fallback = localFallbackGet();
        self.postMessage({
          type: "loaded",
          record: fallback ? { source: fallback } : null,
          warning: `IndexedDB 读取失败，已尝试 localStorage：${error.message}`,
        });
      } catch (fallbackError) {
        self.postMessage({
          type: "loaded",
          record: null,
          warning: `IndexedDB 和 localStorage 均不可用：${fallbackError.message}`,
        });
      }
    }
    return;
  }

  if (message.type === "editor-input") {
    pendingSource = message.source;
    clearTimeout(timer);
    timer = setTimeout(() => {
      self.postMessage({ type: "compile-requested", version: message.version });
      persist(pendingSource, message.version);
    }, DEBOUNCE_MS);
    return;
  }

  if (message.type === "flush") {
    clearTimeout(timer);
    self.postMessage({ type: "compile-requested", version: message.version });
    persist(message.source, message.version);
  }
};
