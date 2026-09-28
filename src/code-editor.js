export class CodeEditor {
  constructor(textarea, gutter) {
    this.textarea = textarea;
    this.gutter = gutter;
    this.markedLines = new Set();
    this.onInput = () => {};
    this.textarea.addEventListener("input", () => {
      this.renderGutter();
      this.onInput(this.textarea.value);
    });
    this.textarea.addEventListener("scroll", () => {
      this.gutter.scrollTop = this.textarea.scrollTop;
    });
    new ResizeObserver(() => this.renderGutter()).observe(textarea);
  }

  get value() {
    return this.textarea.value;
  }

  setValue(value) {
    this.textarea.value = value;
    this.renderGutter();
  }

  setMarkedLines(lines) {
    this.markedLines = new Set(lines.filter(Boolean));
    this.renderGutter();
  }

  clearMarks() {
    this.setMarkedLines([]);
  }

  focusPosition(line, column) {
    const source = this.value;
    const lines = source.split("\n");
    const lineIndex = Math.max(0, Math.min(line - 1, lines.length - 1));
    const columnIndex = Math.max(0, Math.min(column - 1, lines[lineIndex].length));
    const offset = lines.slice(0, lineIndex).reduce((sum, item) => sum + item.length + 1, 0) + columnIndex;
    this.textarea.focus();
    this.textarea.setSelectionRange(offset, offset);
  }

  renderGutter() {
    const lineCount = Math.max(1, this.value.split("\n").length);
    this.gutter.innerHTML = "";
    for (let line = 1; line <= lineCount; line += 1) {
      const item = document.createElement("span");
      item.textContent = String(line);
      if (this.markedLines.has(line)) item.classList.add("error-line");
      this.gutter.append(item);
    }
    this.gutter.scrollTop = this.textarea.scrollTop;
  }
}
