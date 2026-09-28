/* 简易代码编辑器：textarea + 行号槽 + 错误行高亮 + 行列跳转。 */
(function (global) {
  'use strict';

  function Editor(textarea, gutter) {
    var self = this;
    this.ta = textarea;
    this.gutter = gutter;
    this.errorLines = {};
    this.listeners = [];

    this.ta.addEventListener('input', function () {
      self.renderGutter();
      self.listeners.forEach(function (fn) { fn(self.ta.value); });
    });
    this.ta.addEventListener('scroll', function () {
      self.gutter.scrollTop = self.ta.scrollTop;
    });
    // Tab 键插入两个空格
    this.ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = self.ta.selectionStart;
        self.ta.setRangeText('  ', s, self.ta.selectionEnd, 'end');
        self.renderGutter();
        self.listeners.forEach(function (fn) { fn(self.ta.value); });
      }
    });
    this.renderGutter();
  }

  Editor.prototype.onChange = function (fn) { this.listeners.push(fn); };

  Editor.prototype.getValue = function () { return this.ta.value; };

  Editor.prototype.setValue = function (v) {
    this.ta.value = v;
    this.renderGutter();
  };

  /** errors: [{line}]，将对应行号标红 */
  Editor.prototype.setErrors = function (errors) {
    var map = {};
    (errors || []).forEach(function (e) {
      if (e.line > 0) map[e.line] = true;
    });
    this.errorLines = map;
    this.renderGutter();
  };

  Editor.prototype.renderGutter = function () {
    var count = this.ta.value.split('\n').length;
    var html = '';
    for (var i = 1; i <= count; i++) {
      html += '<div class="gline' + (this.errorLines[i] ? ' err' : '') + '">' + i + '</div>';
    }
    this.gutter.innerHTML = html;
    this.gutter.scrollTop = this.ta.scrollTop;
  };

  /** 把光标移动到指定行列（1 起始），并聚焦。 */
  Editor.prototype.jumpTo = function (line, col) {
    var lines = this.ta.value.split('\n');
    line = Math.max(1, Math.min(line, lines.length));
    col = Math.max(1, col || 1);
    var pos = 0;
    for (var i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    pos += Math.min(col - 1, lines[line - 1].length);
    this.ta.focus();
    this.ta.setSelectionRange(pos, pos);
    // 滚动到可见区域
    var lineHeight = parseFloat(getComputedStyle(this.ta).lineHeight) || 19;
    this.ta.scrollTop = Math.max(0, (line - 3) * lineHeight);
  };

  global.Editor = Editor;
})(typeof self !== 'undefined' ? self : this);
