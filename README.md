# Obsidian AutoView Plugin

This is a plugin for Obsidian (https://obsidian.md).

This plugin will auto-switch the active window from reading mode to edit mode when you double-click the reading view, placing the edit cursor near the clicked text. It then switches back to reading mode after a delay from the last keystroke and keeps the reading view aligned with the edit cursor location. This quick switching allows for a kind of WYSIWYG.

## Local Installation
The codebase is written in TypeScript and uses `rollup` / `node` for compilation; for a first time set up, all you
should need to do is pull, install, and build:

```console
foo@bar:~$ git clone https://github.com/mmhobi7/obsidian-autoview.git
foo@bar:~$ cd obsidian-autoview
foo@bar:~/obsidian-autoview$ npm install
foo@bar:~/obsidian-autoview$ npm run dev
```

## Settings

* Timeout Duration: The amount of time in seconds that the plugin waits after the last keystroke before swtiching over to preview mode.
* Scroll back to previous editing location: Whether the editor should scroll back to it's previous location when switching from edit to preview mode (verus just auto scrolling to where editing is happening)
