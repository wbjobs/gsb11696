import { CodeEditor } from "./code-editor.js";
import { DEFAULT_FRAGMENT_SHADER } from "./default-shaders.js";
import { ShaderRenderer } from "./shader-renderer.js";

const elements = {
  canvas: document.querySelector("#glCanvas"),
  textarea: document.querySelector("#shaderSource"),
  gutter: document.querySelector(".gutter"),
  environment: document.querySelector("#environment"),
  pipelineState: document.querySelector("#pipelineState"),
  programBadge: document.querySelector("#programBadge"),
  errorModeBadge: document.querySelector("#errorModeBadge"),
  saveState: document.querySelector("#saveState"),
  diagnostics: document.querySelector("#diagnosticList"),
  diagnosticCount: document.querySelector("#diagnosticCount"),
  reload: document.querySelector("#reloadButton"),
  fallback: document.querySelector("#fallbackButton"),
  linkProbe: document.querySelector("#linkProbeButton"),
  runtimeProbe: document.querySelector("#runtimeProbeButton"),
  lose: document.querySelector("#loseButton"),
  restore: document.querySelector("#restoreButton"),
  overlay: document.querySelector("#contextOverlay"),
};

const stageLabels = {
  vertex: "顶点着色器",
  fragment: "片段着色器",
  link: "程序链接",
  validate: "程序校验",
  runtime: "运行时",
  context: "上下文",
};

let renderer = null;
let version = 0;
let editor;
let worker = null;
let localCompileTimer = 0;

try {
  renderer = new ShaderRenderer(elements.canvas);
  const info = renderer.getEnvironmentInfo();
  elements.environment.textContent =
    `${info.context} · ${info.renderer} · highp ${info.highp ? "可用" : "已降级"}`;
  elements.lose.disabled = !info.contextLostExtension;
  renderer.onDiagnostic = (error) => {
    renderDiagnostics([error]);
    setPipeline("运行时错误已捕获，已降级到默认程序", "warning");
    updateRuntimeState();
  };
  if (renderer.fatalError) {
    renderDiagnostics(renderer.fatalError.diagnostics?.length
      ? renderer.fatalError.diagnostics
      : [renderer.fatalError]);
  }
  renderer.start();
} catch (error) {
  elements.environment.textContent = error.message;
  elements.pipelineState.textContent = "WebGL 不可用，无法展示渲染结果";
  elements.lose.disabled = true;
  elements.restore.disabled = true;
}

editor = new CodeEditor(elements.textarea, elements.gutter);
editor.setValue(DEFAULT_FRAGMENT_SHADER);

try {
  worker = new Worker(new URL("./worker-shader.js", import.meta.url), { type: "classic" });
} catch {
  worker = null;
}

function setSaveState(text, tone = "neutral") {
  elements.saveState.textContent = text;
  elements.saveState.dataset.tone = tone;
}

function setPipeline(text, tone = "neutral") {
  elements.pipelineState.textContent = text;
  elements.pipelineState.dataset.tone = tone;
}

function updateRuntimeState() {
  if (!renderer) return;
  const usingDefault = renderer.activeKind === "default";
  elements.programBadge.textContent = usingDefault ? "默认程序" : "用户程序";
  elements.programBadge.dataset.tone = usingDefault ? "warning" : "ok";
  elements.errorModeBadge.classList.toggle("hidden", !renderer.runtimeError);
}

function renderDiagnostics(items) {
  elements.diagnostics.innerHTML = "";
  elements.diagnosticCount.textContent = `${items.length} 条`;

  for (const item of items) {
    const li = document.createElement("li");
    li.classList.add(item.severity || "error");

    const title = document.createElement("button");
    title.type = "button";
    title.className = "diagnostic-title";
    const location = item.line
      ? ` ${item.line} 行${item.column ? ` ${item.column} 列` : ""}`
      : "";
    title.textContent = `${stageLabels[item.stage] || item.stage}${location}：${item.message}`;
    title.disabled = !item.line;
    title.title = item.line ? "跳转到错误位置" : "该错误没有源码位置";
    title.addEventListener("click", () => {
      if (item.line) editor.focusPosition(item.line, item.column || 1);
    });

    li.append(title);
    elements.diagnostics.append(li);
  }
}

function renderSuccess(warningCount, sourceVersion) {
  editor.clearMarks();
  elements.errorModeBadge.classList.add("hidden");
  setPipeline(`热重载成功 #${sourceVersion}`, "ok");
  updateRuntimeState();

  if (warningCount) {
    renderDiagnostics([{
      stage: "fragment",
      severity: "warning",
      line: null,
      column: null,
      message: `编译或链接成功，但驱动返回 ${warningCount} 条警告。`,
    }]);
  } else {
    renderDiagnostics([{
      stage: "fragment",
      severity: "success",
      line: null,
      column: null,
      message: `编译、链接和运行时热路径检查通过 #${sourceVersion}。`,
    }]);
  }
}

function renderFailure(result, sourceVersion) {
  const diagnostics = result.diagnostics?.length
    ? result.diagnostics
    : [{
      stage: "fragment",
      severity: "error",
      line: null,
      column: null,
      message: "着色器程序构建失败，但驱动未提供详细日志。",
    }];

  editor.setMarkedLines(diagnostics.map((item) => item.line));
  renderDiagnostics(diagnostics);
  setPipeline(`热重载失败 #${sourceVersion}，已降级到默认程序`, "error");
  updateRuntimeState();
}

function compileCurrent(sourceVersion) {
  if (!renderer) return;
  const source = editor.value;
  const result = renderer.setUserShader(source);
  if (result.ok) renderSuccess(result.diagnostics.length, sourceVersion);
  else renderFailure(result, sourceVersion);
}

editor.onInput = (source) => {
  version += 1;
  setSaveState("等待保存…", "neutral");
  setPipeline("编辑中，防抖结束后热重载", "neutral");
  if (worker) {
    worker.postMessage({ type: "editor-input", source, version });
    return;
  }

  clearTimeout(localCompileTimer);
  localCompileTimer = setTimeout(() => {
    try {
      localStorage.setItem("shader-hot-reload:fragment", source);
      setSaveState(`已降级保存到 localStorage #${version}`, "warning");
    } catch {
      setSaveState("保存失败", "error");
    }
    compileCurrent(version);
  }, 350);
};

function flushLocally(source) {
  clearTimeout(localCompileTimer);
  try {
    localStorage.setItem("shader-hot-reload:fragment", source);
    setSaveState(`已降级保存到 localStorage #${version}`, "warning");
  } catch {
    setSaveState("保存失败", "error");
  }
  compileCurrent(version);
}

elements.reload.addEventListener("click", () => {
  version += 1;
  if (worker) worker.postMessage({ type: "flush", source: editor.value, version });
  else flushLocally(editor.value);
});

elements.fallback.addEventListener("click", () => {
  version += 1;
  editor.setValue(DEFAULT_FRAGMENT_SHADER);
  if (worker) worker.postMessage({ type: "flush", source: DEFAULT_FRAGMENT_SHADER, version });
  else flushLocally(DEFAULT_FRAGMENT_SHADER);
});

elements.linkProbe.addEventListener("click", () => {
  if (!renderer) return;
  const result = renderer.probeLinkFailure();
  renderFailure(result, ++version);
});

elements.runtimeProbe.addEventListener("click", () => {
  if (!renderer) return;
  const result = renderer.probeRuntimeError();
  if (result.error) {
    renderDiagnostics([{
      ...result.error,
      message: `运行时探针捕获到 WebGL 错误：${result.error.message}。主渲染循环如遇到同类错误，会自动降级到默认程序。`,
    }]);
    setPipeline("运行时 GL 错误已捕获", "warning");
  }
});

elements.lose.addEventListener("click", () => {
  renderer?.forceLoseContext();
});

elements.restore.addEventListener("click", () => {
  renderer?.forceRestoreContext();
});

elements.canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  renderer?.handleContextLost();
  elements.overlay.classList.remove("hidden");
  elements.restore.disabled = !renderer?.loseContextExtension;
  elements.lose.disabled = true;
  setPipeline("WebGL 上下文已丢失", "error");
  renderDiagnostics([{
    stage: "context",
    severity: "error",
    line: null,
    column: null,
    message: "GPU 上下文丢失；WebGL 资源已标记为失效，等待上下文恢复。",
  }]);
});

elements.canvas.addEventListener("webglcontextrestored", () => {
  const result = renderer?.handleContextRestored();
  elements.overlay.classList.add("hidden");
  elements.restore.disabled = true;
  elements.lose.disabled = !renderer?.loseContextExtension;
  if (result?.ok) renderSuccess(result.diagnostics.length, version);
  else if (result) renderFailure(result, version);
});

if (worker) {
  worker.onmessage = (event) => {
    const message = event.data;

    if (message.type === "loaded") {
      if (message.record?.source) editor.setValue(message.record.source);
      compileCurrent(version);
      if (message.warning) {
        renderDiagnostics([{
          stage: "context",
          severity: "warning",
          line: null,
          column: null,
          message: message.warning,
        }]);
      }
      setSaveState(message.record ? "已从 IndexedDB 恢复" : "默认着色器", "ok");
      return;
    }

    if (message.type === "compile-requested") {
      compileCurrent(message.version);
      return;
    }

    if (message.type === "saved") {
      setSaveState(`已保存 #${message.version}`, "ok");
      if (message.warning) {
        renderDiagnostics([{
          stage: "context",
          severity: "warning",
          line: null,
          column: null,
          message: message.warning,
        }]);
      }
      return;
    }

    if (message.type === "persist-error") {
      try {
        localStorage.setItem("shader-hot-reload:fragment", editor.value);
        setSaveState(`已降级保存到 localStorage #${message.version}`, "warning");
      } catch {
        setSaveState("保存失败", "error");
      }
      renderDiagnostics([{
        stage: "context",
        severity: "warning",
        line: null,
        column: null,
        message: message.message,
      }]);
    }
  };

  worker.onerror = () => {
    worker.terminate();
    worker = null;
    let fallbackSource = DEFAULT_FRAGMENT_SHADER;
    try {
      fallbackSource = localStorage.getItem("shader-hot-reload:fragment") || DEFAULT_FRAGMENT_SHADER;
    } catch {
      // localStorage 不可用时继续使用内置默认着色器。
    }
    if (fallbackSource !== DEFAULT_FRAGMENT_SHADER) editor.setValue(fallbackSource);
    compileCurrent(++version);
    setSaveState("Worker 不可用", "error");
    setPipeline("Worker 加载失败：已降级到主线程防抖和 localStorage", "warning");
  };

  worker.postMessage({ type: "load" });
} else {
  let fallbackSource = DEFAULT_FRAGMENT_SHADER;
  try {
    fallbackSource = localStorage.getItem("shader-hot-reload:fragment") || DEFAULT_FRAGMENT_SHADER;
  } catch {
    // localStorage 不可用时继续使用内置默认着色器。
  }
  if (fallbackSource !== DEFAULT_FRAGMENT_SHADER) editor.setValue(fallbackSource);
  compileCurrent(version);
  setSaveState("Worker 不可用，使用 localStorage", "warning");
  setPipeline("已降级到主线程防抖", "warning");
}
