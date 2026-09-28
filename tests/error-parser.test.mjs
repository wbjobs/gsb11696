import assert from "node:assert/strict";
import test from "node:test";
import { parseShaderLog, textPosition } from "../src/error-parser.js";

const source = [
  "precision highp float;",
  "",
  "void main() {",
  "  gl_FragColor = color;",
  "}",
].join("\n");

test("parses Chrome ANGLE line and column diagnostics", () => {
  const [item] = parseShaderLog("ERROR: 4:18: 'color' : undeclared identifier", source, "fragment");
  assert.equal(item.line, 4);
  assert.equal(item.column, 18);
  assert.match(item.message, /undeclared identifier/);
  assert.equal(item.position.offset, source.indexOf("color"));
});

test("parses macOS style shader diagnostics", () => {
  const [item] = parseShaderLog("ERROR: 0:4: 'color' : undeclared identifier", source, "fragment");
  assert.equal(item.sourceId, "0");
  assert.equal(item.line, 4);
  assert.equal(item.column, null);
});

test("parses parenthesized numeric driver formats", () => {
  const [item] = parseShaderLog("ERROR: (12) : 0:4: 'color' : undeclared identifier", source, "fragment");
  assert.equal(item.sourceId, "12");
  assert.equal(item.line, 4);
});

test("parses Firefox line column source diagnostics", () => {
  const [item] = parseShaderLog("4:18(12): ERROR: 'color' : undeclared identifier", source, "fragment");
  assert.equal(item.sourceId, "12");
  assert.equal(item.line, 4);
  assert.equal(item.column, 18);
});

test("preserves diagnostics without source positions", () => {
  const [item] = parseShaderLog("ERROR: Variables of type uniform block are not allowed", source, "link");
  assert.equal(item.line, null);
  assert.equal(item.column, null);
  assert.equal(item.stage, "link");
});

test("clamps text positions to source bounds", () => {
  const position = textPosition(source, 99, 10);
  assert.equal(position.line, 5);
  assert.equal(position.column, 2);
});
