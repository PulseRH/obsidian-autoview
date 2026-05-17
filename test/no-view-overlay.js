const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf8');

assert(
  !source.includes('withViewOverlay('),
  'switching to reading mode should not hide the live view behind a cloned overlay'
);

assert(
  !source.includes('createViewOverlay('),
  'switching to reading mode should not render a cloned overlay outside the Obsidian workspace'
);

assert(
  source.includes("document, 'click'"),
  'reading mode should listen for single clicks so typing can start at the clicked preview position'
);

assert(
  source.includes('pendingPreviewClickState'),
  'typing from reading mode should use the last single-click preview cursor state'
);

assert(
  source.includes('let pendingState = this.consumePendingPreviewClickState(markdownView);') &&
      source.includes('await this.switchToSource(pendingState, true);'),
  'typing from reading mode should switch to source at the last clicked preview position'
);

assert(
  source.includes('autoPreviewActive: boolean;'),
  'plugin should track whether edit mode was entered from reading mode by Autoview'
);

assert(
  source.includes("await this.switchToSource(clickedState, true);") &&
      source.includes('await this.switchToSource(pendingState, true);'),
  'only reading-mode double-click and typing switches should enable the auto-preview timeout'
);

assert(
  /if \(markdownView\.getMode\(\) == 'source'\) {\s*if \(this\.autoPreviewActive\) {\s*this\.resetPreviewTimer\(\);\s*}\s*return;\s*}/.test(source),
  'normal typing in source mode should not start or reset the auto-preview timeout'
);

assert(
  /async switchToPreview\(markdownView: MarkdownView\)[\s\S]*this\.autoPreviewActive = false;[\s\S]*await this\.scrollPreviewToAnchor/.test(source),
  'returning to reading mode should clear the auto-preview timeout state'
);
