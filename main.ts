import {App, MarkdownView, Plugin, PluginSettingTab, Setting} from 'obsidian';

interface MyPluginSettings {
  timoutduration: number;
  rememberscroll: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  timoutduration: 10,
  rememberscroll: true
}

// https://raw.githubusercontent.com/derwish-pro/obsidian-remember-cursor-position/master/main.ts
interface EphemeralState {
  cursor?: {from: {ch: number
                        line: number
		},
		to: {
			ch: number
                        line: number
		}
	},
	scroll?: number
}

interface ViewAnchorState {
  cursor: {
    from: {ch: number, line: number},
    to: {ch: number, line: number}
  };
  cursorLineOffset: number;
  cursorLineText?: string;
  sourceScroll?: number;
}

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;
  db: {[file_path: string]: EphemeralState;};
  lastTime: number;

  async onload() {
    console.log('loading plugin autoview');
    this.lastTime = 1;
    this.db = {};

    await this.loadSettings();

    this.addSettingTab(new SampleSettingTab(this.app, this));

    this.registerCodeMirror((cm: CodeMirror.Editor) => {
      console.log('codemirror', cm);
    });

    this.registerDomEvent(
        document, 'keydown',
        (evt: KeyboardEvent) => this.handleMarkdownKeydown(evt));

    this.registerDomEvent(
        document, 'dblclick',
        (evt: MouseEvent) => this.handleMarkdownDoubleClick(evt));
  }

  async handleMarkdownDoubleClick(evt: MouseEvent) {
    let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!markdownView) {
      return;
    }

    if (!markdownView.containerEl.contains(evt.target as Node)) {
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();

    if (markdownView.getMode() == 'preview') {
      let clickedState = this.getPreviewClickState(evt, markdownView);
      await this.switchToSource(clickedState);
    } else if (markdownView.getMode() == 'source') {
      await this.switchToPreview(markdownView);
    }
  }

  async handleMarkdownKeydown(evt: KeyboardEvent) {
    let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!markdownView) {
      return;
    }

    if (markdownView.getMode() == 'source') {
      this.resetPreviewTimer();
      return;
    }

    if (markdownView.getMode() != 'preview' || !this.isTypingKey(evt) ||
        this.isEditableTarget(evt.target)) {
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();

    let key = evt.key;
    await this.switchToSource();
    await this.applyTypingKey(key);
  }

  resetPreviewTimer() {
    let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!markdownView || markdownView.getMode() != 'source') {
      return;
    }

    this.lastTime++;
    this.backtopreview(this.lastTime, markdownView);
  }

  async switchToSource(state?: EphemeralState) {
    let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!markdownView) {
      return;
    }

    if (markdownView.getMode() == 'preview') {
      var curState = markdownView.getState();
      curState.mode = 'source';
      await markdownView.setState(curState, theresult);

      if (state && state.cursor) {
        await this.waitForEditor();
        this.setEphemeralState(state);
        await this.waitForNextFrame();
        this.setEphemeralState(state);
      } else {
        await this.restoreEphemeralState();
      }
    }

    this.resetPreviewTimer();
  }

  async switchToPreview(markdownView: MarkdownView) {
    if (markdownView.getMode() != 'source') {
      return;
    }

    let st = this.getEphemeralState();
    let anchor = this.getViewAnchorState(st);
    this.saveEphemeralState(st);

    await this.withViewOverlay(markdownView, async () => {
      var curState = markdownView.getState();
      curState.mode = 'preview';
      await markdownView.setState(curState, theresult);
      await this.scrollPreviewToAnchor(anchor || st);
    });
  }

  isTypingKey(evt: KeyboardEvent): boolean {
    if (evt.ctrlKey || evt.metaKey || evt.altKey || evt.isComposing) {
      return false;
    }

    return evt.key.length == 1 ||
        ['Enter', 'Backspace', 'Delete', 'Tab'].indexOf(evt.key) >= 0;
  }

  isEditableTarget(target: EventTarget|null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    let tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName == 'input' ||
        tagName == 'textarea' || tagName == 'select';
  }

  async applyTypingKey(key: string) {
    await this.waitForEditor();

    let editor = this.getEditor();
    if (!editor) {
      return;
    }

    if (key.length == 1) {
      this.replaceEditorSelection(editor, key);
    } else if (key == 'Enter') {
      this.replaceEditorSelection(editor, '\n');
    } else if (key == 'Tab') {
      this.replaceEditorSelection(editor, '\t');
    } else if (key == 'Backspace') {
      this.deleteFromEditor(editor, -1);
    } else if (key == 'Delete') {
      this.deleteFromEditor(editor, 1);
    }

    editor.focus();
    this.resetPreviewTimer();
  }

  replaceEditorSelection(editor: any, text: string) {
    if (editor.replaceSelection) {
      editor.replaceSelection(text);
      return;
    }

    if (editor.replaceRange) {
      let from = editor.getCursor('anchor');
      let to = editor.getCursor('head');
      if (this.compareEditorPositions(from, to) > 0) {
        let swap = from;
        from = to;
        to = swap;
      }
      editor.replaceRange(text, from, to);
    }
  }

  deleteFromEditor(editor: any, direction: number) {
    if (!editor.getCursor || !editor.replaceRange) {
      return;
    }

    let from = editor.getCursor('anchor');
    let to = editor.getCursor('head');

    if (this.compareEditorPositions(from, to) > 0) {
      let swap = from;
      from = to;
      to = swap;
    }

    if (this.compareEditorPositions(from, to) != 0) {
      editor.replaceRange('', from, to);
      editor.setCursor?.(from);
      return;
    }

    let cursor = from;
    let deleteFrom = cursor;
    let deleteTo = cursor;

    if (direction < 0) {
      if (cursor.ch > 0) {
        deleteFrom = {line: cursor.line, ch: cursor.ch - 1};
      } else if (cursor.line > 0) {
        deleteFrom = {
          line: cursor.line - 1,
          ch: editor.getLine(cursor.line - 1).length
        };
      } else {
        return;
      }
    } else {
      let lineText = editor.getLine(cursor.line);
      if (cursor.ch < lineText.length) {
        deleteTo = {line: cursor.line, ch: cursor.ch + 1};
      } else if (cursor.line < editor.lineCount() - 1) {
        deleteTo = {line: cursor.line + 1, ch: 0};
      } else {
        return;
      }
    }

    editor.replaceRange('', deleteFrom, deleteTo);
    editor.setCursor?.(deleteFrom);
  }

  compareEditorPositions(
      a: {line: number, ch: number},
      b: {line: number, ch: number}): number {
    if (a.line != b.line) {
      return a.line - b.line;
    }

    return a.ch - b.ch;
  }

  getPreviewClickState(evt: MouseEvent, view: MarkdownView): EphemeralState {
    let lineEl = this.getPreviewLineElementFromClick(evt, view);
    let clickedTexts = this.getClickedTextCandidates(evt, lineEl);

    if (!lineEl) {
      let line = this.resolveClickedTextToSourceLine(clickedTexts);

      if (line === null) {
        return {};
      }

      let ch = this.estimateTextClickColumn(evt, line, clickedTexts) || 0;

      return {
        cursor: {
          from: {line: line, ch: ch},
          to: {line: line, ch: ch}
        },
        scroll: Number(view.currentMode?.getScroll()?.toFixed(4))
      };
    }

    let previewLine = this.getPreviewLineNumber(lineEl);

    if (previewLine === null) {
      return {};
    }

    let line = this.resolvePreviewLineToSourceLine(
        previewLine, lineEl, clickedTexts);
    let ch = this.estimatePreviewClickColumn(evt, lineEl, line, clickedTexts);

    return {
      cursor: {
        from: {line: line, ch: ch},
        to: {line: line, ch: ch}
      },
      scroll: Number(view.currentMode?.getScroll()?.toFixed(4))
    };
  }

  getPreviewLineElementFromClick(
      evt: MouseEvent, view: MarkdownView): HTMLElement|null {
    let pointEls = document.elementsFromPoint(evt.clientX, evt.clientY);
    let lineEls: HTMLElement[] = [];

    for (let pointEl of pointEls) {
      let lineEl = pointEl.closest('[data-line]') as HTMLElement;
      if (lineEl && view.containerEl.contains(lineEl) &&
          lineEls.indexOf(lineEl) == -1) {
        lineEls.push(lineEl);
      }
    }

    if (lineEls.length == 0) {
      return null;
    }

    return lineEls.sort((a, b) => {
      let aRect = a.getBoundingClientRect();
      let bRect = b.getBoundingClientRect();
      return (aRect.width * aRect.height) - (bRect.width * bRect.height);
    })[0];
  }

  getPreviewLineNumber(lineEl: HTMLElement): number|null {
    let lineValue = lineEl.getAttribute('data-line');
    let lineMatch = lineValue?.match(/\d+/);

    if (!lineMatch) {
      return null;
    }

    return Number(lineMatch[0]);
  }

  resolvePreviewLineToSourceLine(
      previewLine: number, lineEl: HTMLElement,
      clickedTexts: string[]): number {
    let clickedText = clickedTexts[0] || '';
    let previewLineText = this.normalizeDisplayText(
        this.getMarkdownLine(previewLine));

    if (!clickedText || clickedTexts.some(text => previewLineText.includes(text))) {
      return previewLine;
    }

    let editor = this.getEditor();
    if (!editor || !editor.lineCount) {
      return previewLine;
    }

    let matchedLine = this.resolveClickedTextToSourceLine(clickedTexts);
    if (matchedLine !== null) {
      return matchedLine;
    }

    return previewLine;
  }

  resolveClickedTextToSourceLine(clickedTexts: string[]): number|null {
    let editor = this.getEditor();
    if (!editor || !editor.lineCount) {
      return null;
    }

    let bestLine: number|null = null;
    let bodyStart = this.getEditableBodyStartLine(editor);

    for (let line = 0; line < editor.lineCount(); line++) {
      let markdownText = this.normalizeDisplayText(editor.getLine(line) || '');

      if (!markdownText ||
          !clickedTexts.some(text => markdownText.includes(text))) {
        continue;
      }

      if (line >= bodyStart) {
        return line;
      }

      if (bestLine === null) {
        bestLine = line;
      }
    }

    return bestLine;
  }

  estimateTextClickColumn(
      evt: MouseEvent, line: number, clickedTexts: string[]): number|null {
    let markdownLine = this.getMarkdownLine(line);

    if (!markdownLine) {
      return null;
    }

    let range = this.getCaretRangeFromPoint(evt);
    if (!range) {
      return null;
    }

    let textNodeContent = range.startContainer.textContent || '';
    if (!textNodeContent) {
      return null;
    }

    let clickedText = this.normalizeDisplayText(textNodeContent);
    let textBeforeCursor = this.normalizeDisplayText(
        textNodeContent.slice(0, range.startOffset));
    let displayLine = this.normalizeDisplayText(markdownLine);
    let matchText = clickedTexts.find(text => displayLine.includes(text)) ||
        clickedText;
    let matchStart = displayLine.indexOf(matchText);

    if (matchStart < 0) {
      return null;
    }

    let displayColumn = matchStart + textBeforeCursor.length;
    return this.displayColumnToMarkdownColumn(markdownLine, displayColumn);
  }

  displayColumnToMarkdownColumn(
      markdownLine: string, displayColumn: number): number {
    if (displayColumn <= 0) {
      return 0;
    }

    for (let ch = 1; ch <= markdownLine.length; ch++) {
      if (this.normalizeDisplayText(markdownLine.slice(0, ch)).length >=
          displayColumn) {
        return ch;
      }
    }

    return markdownLine.length;
  }

  getClickedTextCandidates(evt: MouseEvent, lineEl?: HTMLElement|null):
      string[] {
    let candidates: string[] = [];
    let addCandidate = (text: string) => {
      let normalized = this.normalizeDisplayText(text);
      if (normalized && candidates.indexOf(normalized) == -1) {
        candidates.push(normalized);
      }
    };

    let range = this.getCaretRangeFromPoint(evt);
    if (range && (!lineEl || lineEl.contains(range.startContainer))) {
      addCandidate(range.startContainer.textContent || '');
    }

    let target = evt.target as Element;
    while (target && target != lineEl &&
           (!lineEl || lineEl.contains(target))) {
      if (this.isPreviewBoundary(target)) {
        break;
      }

      addCandidate(target.textContent || '');
      target = target.parentElement;
    }

    if (lineEl) {
      let lineText = lineEl.textContent || '';
      for (let textLine of lineText.split(/\n+/)) {
        addCandidate(textLine);
      }
      addCandidate(lineText);
    }

    return candidates.sort((a, b) => a.length - b.length);
  }

  isPreviewBoundary(el: Element): boolean {
    return el.classList.contains('markdown-preview-view') ||
        el.classList.contains('markdown-reading-view') ||
        el.classList.contains('view-content') ||
        el.classList.contains('workspace-leaf-content');
  }

  normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  normalizeDisplayText(text: string): string {
    return this.normalizeText(text)
        .replace(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, '$2$1')
        .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, '$2$1')
        .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/[`*_~>#-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
  }

  getEditableBodyStartLine(editor: any): number {
    if (editor.getLine(0) != '---') {
      return 0;
    }

    for (let line = 1; line < editor.lineCount(); line++) {
      if (editor.getLine(line) == '---') {
        return Math.min(line + 1, editor.lineCount() - 1);
      }
    }

    return 0;
  }

  estimatePreviewClickColumn(
      evt: MouseEvent, lineEl: HTMLElement, line: number,
      clickedTexts: string[]): number {
    let markdownLine = this.getMarkdownLine(line);

    if (markdownLine.length == 0) {
      return 0;
    }

    let textColumn = this.estimateTextClickColumn(evt, line, clickedTexts);
    if (textColumn !== null) {
      return textColumn;
    }

    let renderedLength = (lineEl.textContent || '').length;
    let renderedOffset = this.getRenderedTextOffset(evt, lineEl);

    if (renderedLength > 0 && renderedOffset !== null) {
      return this.clamp(
          Math.round((renderedOffset / renderedLength) * markdownLine.length),
          0, markdownLine.length);
    }

    let rect = lineEl.getBoundingClientRect();
    let horizontalRatio = rect.width > 0 ? (evt.clientX - rect.left) / rect.width : 0;
    return this.clamp(
        Math.round(horizontalRatio * markdownLine.length), 0,
        markdownLine.length);
  }

  getMarkdownLine(line: number): string {
    let editor = this.getEditor();

    if (!editor || !editor.getLine) {
      return '';
    }

    return editor.getLine(line) || '';
  }

  getRenderedTextOffset(evt: MouseEvent, lineEl: Element): number|null {
    let range = this.getCaretRangeFromPoint(evt);

    if (!range || !lineEl.contains(range.startContainer)) {
      return null;
    }

    let offsetRange = document.createRange();
    offsetRange.selectNodeContents(lineEl);
    offsetRange.setEnd(range.startContainer, range.startOffset);
    return offsetRange.toString().length;
  }

  getCaretRangeFromPoint(evt: MouseEvent): Range|null {
    let range: Range|null = null;
    let doc = document as any;

    if (doc.caretRangeFromPoint) {
      range = doc.caretRangeFromPoint(evt.clientX, evt.clientY);
    } else if (doc.caretPositionFromPoint) {
      let position = doc.caretPositionFromPoint(evt.clientX, evt.clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }

    return range;
  }

  getEphemeralState(): EphemeralState {
    // let state: EphemeralState =
    // this.app.workspace.getActiveViewOfType(MarkdownView)?.getEphemeralState();
    // //doesnt work properly

    let state: EphemeralState = {};
    state.scroll = Number(this.app.workspace.getActiveViewOfType(MarkdownView)
                              ?.currentMode?.getScroll()
                              ?.toFixed(4));

    let editor = this.getEditor();
    if (editor) {
      let from = editor.getCursor('anchor');
      let to = editor.getCursor('head');
      if (from && to) {
        state.cursor = {
          from: {ch: from.ch, line: from.line},
          to: {ch: to.ch, line: to.line}
        }
      }
    }

    return state;
  }

  private getEditor(): any {
    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return (view as any)?.editor || this.getSourceMode(view)?.cmEditor;
  }

  private getSourceMode(view?: MarkdownView): any {
    let markdownView =
        view || this.app.workspace.getActiveViewOfType(MarkdownView);
    return (markdownView as any)?.sourceMode;
  }

  getViewAnchorState(state: EphemeralState): ViewAnchorState|null {
    if (!state.cursor) {
      return null;
    }

    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return null;
    }

    let sourceScroller = this.getSourceScroller(view);
    let cursorLineOffset = this.getSourceCursorLineOffset(
        state.cursor.from, sourceScroller);

    if (cursorLineOffset === null) {
      cursorLineOffset = sourceScroller ? sourceScroller.clientHeight * 0.45 :
                                          0;
    }

    return {
      cursor: state.cursor,
      cursorLineOffset: cursorLineOffset,
      cursorLineText: this.getMarkdownLine(state.cursor.from.line),
      sourceScroll: this.getSourceScrollTop(sourceScroller, state)
    };
  }

  getSourceCursorLineOffset(
      position: {line: number, ch: number},
      sourceScroller: HTMLElement|null): number|null {
    if (!sourceScroller) {
      return null;
    }

    let coords = this.getEditorCursorWindowCoords(position);
    if (coords) {
      return this.clamp(
          coords.top - sourceScroller.getBoundingClientRect().top, 0,
          sourceScroller.clientHeight);
    }

    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    let lineEl = view ? this.findSourceActiveLineElement(view) : null;
    if (!lineEl) {
      return null;
    }

    return this.clamp(
        lineEl.getBoundingClientRect().top -
            sourceScroller.getBoundingClientRect().top,
        0, sourceScroller.clientHeight);
  }

  getEditorCursorWindowCoords(position: {line: number, ch: number}):
      {top: number, bottom: number}|null {
    let sourceMode = this.getSourceMode();
    let cmEditor = sourceMode?.cmEditor;

    if (cmEditor?.cursorCoords) {
      return cmEditor.cursorCoords(position, 'window');
    }

    return null;
  }

  getSourceScrollTop(
      sourceScroller: HTMLElement|null, state: EphemeralState): number|undefined {
    if (sourceScroller) {
      return sourceScroller.scrollTop;
    }

    return state.scroll;
  }

  getSourceScroller(view: MarkdownView): HTMLElement|null {
    return this.findFirstElement(view.containerEl, [
      '.cm-scroller',
      '.CodeMirror-scroll',
      '.markdown-source-view'
    ]);
  }

  findSourceActiveLineElement(view: MarkdownView): HTMLElement|null {
    return view.containerEl.querySelector(
               '.cm-active.cm-line, .cm-activeLine, .CodeMirror-activeline, .CodeMirror-activeline-background') as
        HTMLElement;
  }

  async saveEphemeralState(st: EphemeralState) {
    let fileName = this.app.workspace.getActiveFile()?.path;
    this.db[fileName] = st;
  }

  async backtopreview(a: number, markdownLeave: MarkdownView) {
    await this.delay(this.settings.timoutduration * 1000);
    if (a == this.lastTime) {
      if (markdownLeave.getMode() == 'source') {
        await this.switchToPreview(markdownLeave);
      }
    }
  }

  onunload() {
    console.log('unloading plugin');
  }

  setEphemeralState(state: EphemeralState) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (state.cursor) {
      let editor = this.getEditor();
      let from = state.cursor.from;
      let to = state.cursor.to;

      if (editor) {
        from = this.clampEditorPosition(editor, from);
        to = this.clampEditorPosition(editor, to);
      }

      if (view && (view as any).setEphemeralState) {
        (view as any).setEphemeralState({
          cursor: {from: from, to: to},
          scroll: state.scroll
        });
      }

      if (editor) {
        this.setEditorSelection(editor, from, to);
        this.scrollEditorIntoView(editor, from, to);
        editor.focus();
      }
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForNextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  async withViewOverlay(
      markdownView: MarkdownView, action: () => Promise<void>) {
    let el = markdownView.containerEl;
    let previousVisibility = el.style.visibility;
    let overlay = this.createViewOverlay(el);

    el.style.visibility = 'hidden';

    try {
      await action();
      await this.waitForNextFrame();
    } finally {
      el.style.visibility = previousVisibility;
      overlay.remove();
    }
  }

  createViewOverlay(el: HTMLElement): HTMLElement {
    let rect = el.getBoundingClientRect();
    let overlay = el.cloneNode(true) as HTMLElement;
    let computed = window.getComputedStyle(el);

    overlay.style.position = 'fixed';
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.margin = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.overflow = 'hidden';
    overlay.style.zIndex = '1000';
    overlay.style.background = computed.background;

    document.body.appendChild(overlay);
    return overlay;
  }

  async restoreEphemeralState() {
    let fileName = this.app.workspace.getActiveFile()?.path;

    if (fileName) {
      let st = this.db[fileName];
      if (st) {
        // waiting for load note
        let scroll: number;
        for (let i = 0; i < 20; i++) {
          scroll = this.app.workspace.getActiveViewOfType(MarkdownView)
                       ?.currentMode?.getScroll();
          if (scroll !== null) break;
          await this.delay(10);
        }
        this.setEphemeralState(st);
      }
    }
  }

  async waitForEditor() {
    for (let i = 0; i < 50; i++) {
      if (this.getEditor()) return;
      await this.delay(10);
    }
  }

  async scrollPreviewToAnchor(state: EphemeralState|ViewAnchorState) {
    if (!this.settings.rememberscroll || !state.cursor) {
      return;
    }

    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    let line = state.cursor.from.line;
    for (let i = 0; i < 20; i++) {
      let lineEl = this.findPreviewAnchorElement(view, line, state);
      let scroller = this.getPreviewScroller(view);
      if (lineEl && scroller) {
        await this.alignPreviewAnchorWhenStable(view, line, state);
        return;
      }
      await this.delay(10);
    }
  }

  async alignPreviewAnchorWhenStable(
      view: MarkdownView, line: number, state: EphemeralState|ViewAnchorState) {
    let lastMetrics: {
      top: number,
      height: number,
      scrollTop: number,
      scrollHeight: number,
      clientHeight: number
    }|null = null;
    let stableFrames = 0;

    for (let i = 0; i < 45; i++) {
      let target = this.findPreviewAnchorElement(view, line, state);
      let scroller = this.getPreviewScroller(view);

      if (!target || !scroller) {
        stableFrames = 0;
        await this.waitForNextFrame();
        continue;
      }

      this.scrollElementToPreviewLine(scroller, target, line, view, state);
      await this.waitForNextFrame();

      let rect = target.getBoundingClientRect();
      let metrics = {
        top: rect.top,
        height: rect.height,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight
      };

      if (lastMetrics && this.areScrollMetricsStable(lastMetrics, metrics)) {
        stableFrames++;
      } else {
        stableFrames = 0;
      }

      lastMetrics = metrics;

      if (stableFrames >= 2) {
        target = this.findPreviewAnchorElement(view, line, state) || target;
        scroller = this.getPreviewScroller(view) || scroller;
        this.scrollElementToPreviewLine(scroller, target, line, view, state);
        await this.waitForNextFrame();
        this.scrollElementToPreviewLine(scroller, target, line, view, state);
        return;
      }
    }

    let target = this.findPreviewAnchorElement(view, line, state);
    let scroller = this.getPreviewScroller(view);
    if (target && scroller) {
      this.scrollElementToPreviewLine(scroller, target, line, view, state);
    }
  }

  areScrollMetricsStable(
      a: {
        top: number,
        height: number,
        scrollTop: number,
        scrollHeight: number,
        clientHeight: number
      },
      b: {
        top: number,
        height: number,
        scrollTop: number,
        scrollHeight: number,
        clientHeight: number
      }): boolean {
    return Math.abs(a.top - b.top) < 0.5 &&
        Math.abs(a.height - b.height) < 0.5 &&
        Math.abs(a.scrollTop - b.scrollTop) < 0.5 &&
        Math.abs(a.scrollHeight - b.scrollHeight) < 0.5 &&
        Math.abs(a.clientHeight - b.clientHeight) < 0.5;
  }

  findPreviewAnchorElement(
      view: MarkdownView, line: number,
      state: EphemeralState|ViewAnchorState): HTMLElement|null {
    let textEl = this.findPreviewTextElement(view, state);
    if (textEl) {
      return textEl;
    }

    return this.findPreviewLineElement(view, line);
  }

  scrollElementToPreviewLine(
      scroller: HTMLElement, target: HTMLElement, line: number,
      view: MarkdownView, state: EphemeralState|ViewAnchorState) {
    let targetOffset = this.getPreviewAnchorOffset(target, line, view, state);
    let viewportOffset = this.getAnchorViewportOffset(state, scroller);
    let previousScrollBehavior = scroller.style.scrollBehavior;
    let targetScrollTop = scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top + targetOffset - viewportOffset;

    scroller.style.scrollBehavior = 'auto';
    scroller.scrollTop = this.clamp(
        targetScrollTop, 0, scroller.scrollHeight - scroller.clientHeight);
    scroller.style.scrollBehavior = previousScrollBehavior;
  }

  getPreviewAnchorOffset(
      target: HTMLElement, line: number, view: MarkdownView,
      state: EphemeralState|ViewAnchorState): number {
    let textOffset = this.getPreviewTextOffset(target, state);
    if (textOffset !== null) {
      return textOffset;
    }

    return this.getPreviewLineOffset(target, line, view);
  }

  getAnchorViewportOffset(
      state: EphemeralState|ViewAnchorState, scroller: HTMLElement): number {
    if ('cursorLineOffset' in state && !isNaN(state.cursorLineOffset)) {
      return this.clamp(state.cursorLineOffset, 0, scroller.clientHeight);
    }

    return scroller.clientHeight * 0.45;
  }

  findPreviewTextElement(
      view: MarkdownView, state: EphemeralState|ViewAnchorState):
      HTMLElement|null {
    if (!('cursorLineText' in state) || !state.cursorLineText) {
      return null;
    }

    let searchText = this.normalizeDisplayText(state.cursorLineText);
    if (!searchText) {
      return null;
    }

    let selectors = [
      'p',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'blockquote',
      'pre',
      'td',
      'th'
    ].join(',');
    let candidates = Array.from(
        view.containerEl.querySelectorAll(selectors)) as HTMLElement[];

    candidates = candidates.filter(el => {
      let text = this.normalizeDisplayText(el.innerText || el.textContent || '');
      let rect = el.getBoundingClientRect();
      return rect.height > 0 && text.includes(searchText);
    });

    if (candidates.length == 0) {
      return null;
    }

    return candidates.sort((a, b) => {
      let aRect = a.getBoundingClientRect();
      let bRect = b.getBoundingClientRect();
      let aText = (a.innerText || a.textContent || '').length;
      let bText = (b.innerText || b.textContent || '').length;

      if (aRect.height != bRect.height) {
        return aRect.height - bRect.height;
      }

      return aText - bText;
    })[0];
  }

  getPreviewTextOffset(
      target: HTMLElement, state: EphemeralState|ViewAnchorState):
      number|null {
    if (!('cursorLineText' in state) || !state.cursorLineText) {
      return null;
    }

    let searchText = this.normalizeDisplayText(state.cursorLineText);
    if (!searchText) {
      return null;
    }

    let renderedLines = (target.innerText || target.textContent || '')
                            .split(/\n+/)
                            .map(text => this.normalizeDisplayText(text))
                            .filter(text => text.length > 0);
    let lineIndex = renderedLines.findIndex(text => text.includes(searchText));

    if (lineIndex < 0) {
      return null;
    }

    let rect = target.getBoundingClientRect();
    return rect.height * (lineIndex / Math.max(renderedLines.length, 1));
  }

  getPreviewLineOffset(
      target: HTMLElement, line: number, view: MarkdownView): number {
    let startLine = this.getPreviewLineNumber(target);
    if (startLine === null) {
      return 0;
    }

    let nextLine = this.getNextPreviewLineNumber(view, startLine);
    if (nextLine === null || nextLine <= startLine) {
      return 0;
    }

    let ratio = this.clamp((line - startLine) / (nextLine - startLine), 0, 1);
    return target.getBoundingClientRect().height * ratio;
  }

  getNextPreviewLineNumber(view: MarkdownView, afterLine: number): number|null {
    let els = Array.from(
        view.containerEl.querySelectorAll('[data-line]')) as HTMLElement[];
    let nextLine: number|null = null;

    for (let el of els) {
      let line = this.getPreviewLineNumber(el);
      if (line !== null && line > afterLine &&
          (nextLine === null || line < nextLine)) {
        nextLine = line;
      }
    }

    return nextLine;
  }

  getPreviewScroller(view: MarkdownView): HTMLElement|null {
    return this.findScrollableElement(view.containerEl, [
      '.markdown-preview-view',
      '.markdown-reading-view',
      '.view-content'
    ]);
  }

  findScrollableElement(
      root: HTMLElement, selectors: string[]): HTMLElement|null {
    for (let selector of selectors) {
      let el = root.querySelector(selector) as HTMLElement;
      if (el && this.canScroll(el)) {
        return el;
      }
    }

    if (this.canScroll(root)) {
      return root;
    }

    let els = Array.from(root.querySelectorAll('*')) as HTMLElement[];
    for (let el of els) {
      if (this.canScroll(el)) {
        return el;
      }
    }

    return null;
  }

  findFirstElement(root: HTMLElement, selectors: string[]): HTMLElement|null {
    for (let selector of selectors) {
      let el = root.querySelector(selector) as HTMLElement;
      if (el) {
        return el;
      }
    }

    return null;
  }

  canScroll(el: HTMLElement): boolean {
    return el.clientHeight > 0 && el.scrollHeight > el.clientHeight;
  }

  findPreviewLineElement(view: MarkdownView, line: number): HTMLElement|null {
    let els = this.getSortedPreviewLineElements(view);
    let nearestEl: HTMLElement|null = null;
    let nearestDistance = Number.MAX_SAFE_INTEGER;

    for (let i = 0; i < els.length; i++) {
      let el = els[i];
      let elLine = this.getPreviewLineNumber(el);
      if (elLine === null) continue;

      let nextLine = i < els.length - 1 ? this.getPreviewLineNumber(els[i + 1]) :
                                         null;
      if (elLine <= line && (nextLine === null || line < nextLine)) {
        return el;
      }

      let distance = Math.abs(line - elLine);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEl = el;
      }
    }

    return nearestEl;
  }

  getSortedPreviewLineElements(view: MarkdownView): HTMLElement[] {
    let els = Array.from(
        view.containerEl.querySelectorAll('[data-line]')) as HTMLElement[];

    return els.sort((a, b) => {
      let aLine = this.getPreviewLineNumber(a);
      let bLine = this.getPreviewLineNumber(b);

      if (aLine === null && bLine === null) return 0;
      if (aLine === null) return 1;
      if (bLine === null) return -1;
      return aLine - bLine;
    });
  }

  findNearestPreviewLineElement(
      view: MarkdownView, clientY: number): HTMLElement|null {
    let els = Array.from(
        view.containerEl.querySelectorAll('[data-line]')) as HTMLElement[];
    let nearestEl: HTMLElement|null = null;
    let nearestDistance = Number.MAX_SAFE_INTEGER;

    for (let el of els) {
      let rect = el.getBoundingClientRect();

      if (clientY >= rect.top && clientY <= rect.bottom) {
        return el;
      }

      let distance = Math.min(
          Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEl = el;
      }
    }

    return nearestEl;
  }

  setEditorSelection(
      editor: any, from: {line: number, ch: number},
      to: {line: number, ch: number}) {
    if (editor.setSelection) {
      editor.setSelection(from, to);
    } else if (editor.setCursor) {
      editor.setCursor(from);
    }
  }

  scrollEditorIntoView(
      editor: any, from: {line: number, ch: number},
      to: {line: number, ch: number}) {
    if (editor.scrollIntoView) {
      editor.scrollIntoView({from: from, to: to}, 100);
    }
  }

  clampEditorPosition(
      editor: any,
      position: {line: number, ch: number}): {line: number, ch: number} {
    let line = this.clamp(position.line, 0, editor.lineCount() - 1);
    let ch = this.clamp(position.ch, 0, editor.getLine(line).length);
    return {line: line, ch: ch};
  }

  clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let {containerEl} = this;

    containerEl.empty();

    containerEl.createEl('h2', {text: 'Settings for AutoView.'});

    new Setting(containerEl)
        .setName('Timeout Duration')
        .setDesc(
            'The amount of time in seconds that the plugin waits after the last keystroke before switching over to preview mode. ')
        .addText(
            text =>
                text.setPlaceholder('10')
                    .setValue(this.plugin.settings.timoutduration.toString())
                    .onChange(async (value) => {
                      if (Number(value) > 0) {
                        this.plugin.settings.timoutduration = Number(value);
                        await this.plugin.saveSettings();
                      } else {
                        this.plugin.settings.timoutduration = 10;
                        text.setValue('');
                        await this.plugin.saveSettings();
                      }
                    }));

    new Setting(containerEl)
        .setName('Scroll back to previous editing location')
        .setDesc(
            'Should the editor scroll back to it\'s previous location when switching from edit to preview mode? ')
        .addToggle(
            toggle => toggle.setValue(this.plugin.settings.rememberscroll)
                          .onChange(async (value) => {
                            this.plugin.settings.rememberscroll = value;
                            await this.plugin.saveSettings();
                          }));
  }
}
function theresult(curState: any, tresult: any) {
  // console.log(tresult);
}
