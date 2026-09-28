const FALLBACK_PATTERN = /^(?:ERROR|WARNING):\s*(.*)$/i;
const PREFIXED_PATTERN = /^(ERROR|WARNING):\s*(?:\((\d+)\)\s*:\s*)?([\d:]*)[\s:]*(.*)$/i;
const FIREFOX_PATTERN = /^(\d+):(\d+)(?:\((\d+)\))?\s*:\s*(?:ERROR|WARNING):\s*(.*)$/i;

function classify(kind, text) {
  const value = `${kind || ""} ${text}`.toLowerCase();
  return value.includes("warning") ? "warning" : "error";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export function textPosition(source, line, column) {
  const safeLine = line ? line - 1 : 0;
  const lines = source.split("\n");
  const lineIndex = clamp(safeLine, 0, lines.length - 1);
  const lineText = lines[lineIndex];
  const safeColumn = typeof column === "number" ? Math.max(0, column - 1) : 0;
  const columnIndex = clamp(safeColumn, 0, lineText.length);
  const offset = lines.slice(0, lineIndex).reduce((sum, item) => sum + item.length + 1, 0) + columnIndex;
  return {
    line: lineIndex + 1,
    column: columnIndex + 1,
    offset,
    lineText,
  };
}

function parseDiagnostic(kind, sourceIdRaw, numbers, message, source, stage) {
  let sourceId = sourceIdRaw || null;
  let lineRaw = null;
  let columnRaw = null;

  if (numbers.length >= 3) {
    sourceId = numbers[0];
    lineRaw = numbers[1];
    columnRaw = numbers[2];
  } else if (numbers.length === 2) {
    if (sourceId || numbers[0] === "0") {
      sourceId = sourceId || numbers[0];
      lineRaw = numbers[1];
    } else {
      lineRaw = numbers[0];
      columnRaw = numbers[1];
    }
  } else if (numbers.length === 1) {
    lineRaw = numbers[0];
  }

  const line = lineRaw ? Number.parseInt(lineRaw, 10) : null;
  const column = columnRaw ? Number.parseInt(columnRaw, 10) : null;
  const position = line ? textPosition(source, line, column || 1) : null;

  return {
    id: `${stage}-${sourceId || "x"}-${line || 0}-${column || 0}-${message || ""}`,
    stage,
    severity: classify(kind, message || ""),
    sourceId: sourceId || null,
    line,
    column,
    message: (message || "未知着色器错误").trim(),
    position,
  };
}

export function parseShaderLog(log, source, stage) {
  if (!log || !log.trim()) return [];

  const items = [];
  for (const rawLine of log.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(warning|error):?\s*$/i.test(line)) continue;

    const firefox = line.match(FIREFOX_PATTERN);
    if (firefox) {
      items.push(parseDiagnostic(
        "ERROR",
        firefox[3],
        [firefox[3], firefox[1], firefox[2]].filter(Boolean),
        firefox[4],
        source,
        stage,
      ));
      continue;
    }

    const prefixed = line.match(PREFIXED_PATTERN);
    if (prefixed) {
      const [, kind, parentSourceId, numericPrefix, message] = prefixed;
      const numbers = numericPrefix.split(":").filter(Boolean);
      items.push(parseDiagnostic(kind, parentSourceId, numbers, message, source, stage));
      continue;
    }

    const fallback = line.match(FALLBACK_PATTERN);
    items.push({
      id: `${stage}-${line}`,
      stage,
      severity: fallback && line.toLowerCase().includes("warning") ? "warning" : "error",
      sourceId: null,
      line: null,
      column: null,
      message: (fallback ? fallback[1] : line).trim(),
      position: null,
    });
  }

  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function glErrorName(gl, code) {
  for (const name of [
    "INVALID_ENUM",
    "INVALID_VALUE",
    "INVALID_OPERATION",
    "OUT_OF_MEMORY",
    "INVALID_FRAMEBUFFER_OPERATION",
    "CONTEXT_LOST_WEBGL",
  ]) {
    if (gl[name] === code) return name;
  }
  return `ERROR_${code}`;
}

export function createRuntimeError(gl, name, code, detail = {}) {
  return {
    id: `runtime-${name}-${code}-${Date.now()}`,
    stage: "runtime",
    severity: "error",
    code,
    line: null,
    column: null,
    message: `${name} 触发 WebGL ${glErrorName(gl, code)}`,
    ...detail,
  };
}
