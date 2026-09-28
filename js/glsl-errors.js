/*
 * 解析各浏览器/驱动返回的着色器 infoLog，提取 行号/列号。
 *
 * 常见格式：
 *   ANGLE (Chrome/Edge/Windows): "ERROR: 0:15: 'foo' : syntax error"
 *   Firefox + 原生 GL:           "ERROR: 0:15: ..."
 *   Mesa (Linux):                "0:15(3): error: syntax error"
 *   部分驱动:                    "ERROR: 15:3: ..."
 *   Safari/WebKit:               "ERROR: 0:15: ..."
 */
(function (global) {
  'use strict';

  function parseLine(text) {
    // ANGLE / WebKit: "ERROR: 0:15: message" 或 "WARNING: 0:15: message"
    var m = /^(\w+):\s*\d+:(\d+):\s*(.*)$/.exec(text);
    if (m) {
      return { severity: m[1].toUpperCase(), line: parseInt(m[2], 10), col: 0, message: m[3] };
    }
    // Mesa: "0:15(3): error: message"
    m = /^\d+:(\d+)\((\d+)\):\s*(\w+):\s*(.*)$/.exec(text);
    if (m) {
      return { severity: m[3].toUpperCase(), line: parseInt(m[1], 10), col: parseInt(m[2], 10), message: m[4] };
    }
    // "ERROR: 15:3: message"（行:列）
    m = /^(\w+):\s*(\d+):(\d+):\s*(.*)$/.exec(text);
    if (m) {
      return { severity: m[1].toUpperCase(), line: parseInt(m[2], 10), col: parseInt(m[3], 10), message: m[4] };
    }
    // 只有 "ERROR: message"
    m = /^(\w+):\s*(.*)$/.exec(text);
    if (m) {
      return { severity: m[1].toUpperCase(), line: 0, col: 0, message: m[2] };
    }
    return { severity: 'ERROR', line: 0, col: 0, message: text };
  }

  /**
   * 解析完整 infoLog，返回 [{severity, line, col, message}]。
   * line/col 为 1 起始；0 表示未知。
   */
  function parseInfoLog(log) {
    if (!log) return [];
    var out = [];
    var lines = String(log).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      out.push(parseLine(t));
    }
    return out;
  }

  /** 链接日志通常没有行号，整体作为一条错误。 */
  function parseLinkLog(log) {
    if (!log) return [];
    return String(log).split(/\r?\n/).filter(function (s) {
      return s.trim();
    }).map(function (s) {
      return { severity: 'ERROR', line: 0, col: 0, message: s.trim() };
    });
  }

  global.GLSLErrors = { parseInfoLog: parseInfoLog, parseLinkLog: parseLinkLog };
})(typeof self !== 'undefined' ? self : this);
