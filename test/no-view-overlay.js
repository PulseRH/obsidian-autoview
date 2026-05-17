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
      source.includes('await this.switchToSource(pendingState);'),
  'typing from reading mode should switch to source at the last clicked preview position'
);
