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

    this.registerDomEvent(document, 'keydown', () => this.resetPreviewTimer());

    this.registerDomEvent(
        document, 'dblclick',
        (evt: MouseEvent) => this.handlePreviewDoubleClick(evt));
  }

  async handlePreviewDoubleClick(evt: MouseEvent) {
    let markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!markdownView || markdownView.getMode() != 'preview') {
      return;
    }

    if (!markdownView.containerEl.contains(evt.target as Node)) {
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();

    let clickedState = this.getPreviewClickState(evt, markdownView);
    await this.switchToSource(clickedState);
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
        await this.delay(100);
        this.setEphemeralState(state);
      } else {
        await this.restoreEphemeralState();
      }
    }

    this.resetPreviewTimer();
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

  async saveEphemeralState(st: EphemeralState) {
    let fileName = this.app.workspace.getActiveFile()?.path;
    this.db[fileName] = st;
  }

  async backtopreview(a: number, markdownLeave: MarkdownView) {
    await this.delay(this.settings.timoutduration * 1000);
    if (a == this.lastTime) {
      if (markdownLeave.getMode() == 'source') {
        let st = this.getEphemeralState();
        this.saveEphemeralState(st);
        var curState = markdownLeave.getState();
        curState.mode = 'preview';
        await markdownLeave.setState(curState, theresult);
        await this.scrollPreviewToCursor(st);
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
        this.scrollEditorIntoView(editor, from, to);
        editor?.focus();
        return;
      }

      if (this.settings.rememberscroll) {
        if (editor) {
          this.setEditorSelection(editor, from, to);
          this.scrollEditorIntoView(editor, from, to);
          editor.focus();
        }
      } else {
        if (editor) {
          this.setEditorSelection(editor, from, to);
          this.scrollEditorIntoView(editor, from, to);
          editor.focus();
        }
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

  async scrollPreviewToCursor(state: EphemeralState) {
    if (!this.settings.rememberscroll || !state.cursor) {
      return;
    }

    let view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    let line = state.cursor.from.line;
    for (let i = 0; i < 20; i++) {
      let lineEl = this.findPreviewLineElement(view, line);
      if (lineEl) {
        lineEl.scrollIntoView({block: 'center'});
        return;
      }
      await this.delay(10);
    }
  }

  findPreviewLineElement(view: MarkdownView, line: number): HTMLElement|null {
    let els = Array.from(
        view.containerEl.querySelectorAll('[data-line]')) as HTMLElement[];
    let nearestEl: HTMLElement|null = null;
    let nearestDistance = Number.MAX_SAFE_INTEGER;

    for (let el of els) {
      let value = el.getAttribute('data-line');
      let match = value?.match(/\d+/);
      if (!match) continue;

      let elLine = Number(match[0]);
      let distance = Math.abs(line - elLine);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEl = el;
      }
    }

    return nearestEl;
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
