# Changelog

Everyone contributing to this repo, including coding assistants, should update this file
when implementing changes. Keep entries concise and describe what changed for users or
developers. Add the newest date first and include your name or handle on each bullet.
Only record work you implemented; do not attribute someone else's changes to yourself.

Format: `- Added/Changed/Fixed/Removed <short description>. — <author>`

## 2026-11-11

- Added highest/lowest player speeds to the notebook and viewer graphs and current-frame readouts, plus optional graph placement to the right of the video without removing other metrics. — Codex
- Prevented duplicate viewer processes from silently sharing a Windows port and serving stale endpoints after restart. — Codex
- Added player-speed mean/median and total timelines, a runnable analysis notebook, and compact synchronized viewer readouts with tracking coverage; preserved source XML speed units. — Codex
- Added a ball-height toggle and scaled bar with optional frame,z CSV import; supplied ATD has no z channel, so missing height is explicitly unavailable. — Codex
- Made the frame inspector narrower with denser history rows and a smaller current-frame card, keeping all nine previous predictions visible. — Codex
- Added synchronized Smart Tagging events and a toggleable ATD pitch view with team positions, ball visibility, and optional track-slot IDs; compacted the viewer layout. — Codex

## 2026-11-10

- Added a local tactical video viewer with synchronized possession predictions, the previous nine frames, seeking, and frame stepping. Added model CSV loading, comparison timelines, focus-model selection, and navigation to prediction disagreements. — Codex
- Added viewer setup documentation and automated checks for CSV validation, frame alignment, and HTTP video seeking. — Codex
- Added this shared changelog and contribution format. — Codex
