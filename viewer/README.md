# Tactical possession viewer

From the repository root:

```bash
python viewer/server.py
```

Open **http://127.0.0.1:8765** in a current Chrome, Edge, Firefox or Safari browser.
No extra packages or frontend build are required (Python 3.8+).
Stop the server with Ctrl+C. Use `--port 8766` if the default port is occupied.

The viewer uses `games.py` for the tactical video path, frame count, frame rate and
kickoff anchors. It respects `MTAH_DATA_DIR`. You can also select a recording with
`python viewer/server.py --video /path/to/BAR-ATH_tactical.mp4`; it must use the same
25 fps, zero-based tactical timeline as the predictions.

## Inspect and compare

- Opens at first-half kickoff, paused, with `evaluation/results/my_first.csv` when
  present; otherwise defaults to `baseline_smooth50.csv` or the first available CSV.
- The top-right inspector shows the focus model's current prediction and the nine
  preceding frames, newest first. At the start of the video, unavailable earlier
  frames are shown as dashes.
- Play, scrub, skip 10 seconds, step one frame, enter a frame number, or jump to
  either kickoff. Frame stepping pauses playback. History is always derived from
  the current video frame, including after seeking backward.
- Add saved models from `evaluation/results/`, or use **Add CSV** to select one or
  more files from anywhere on your computer. **Refresh** discovers newly exported
  files. Adding the same filename again reloads that model's predictions.
- Each loaded model has a current label and a clickable full-match timeline. All
  loaded models also appear in the history table; scroll it horizontally when needed.
  Choose **Focus model** (or click a model name) to change the large prediction.
- The disagreement arrows seek to the nearest earlier/later frame where any loaded
  model differs from the others. They pause playback. This compares predictions,
  not accuracy against ground truth.
- Labels: **H** Barcelona (home), **A** Athletic Club (away), **D** dead ball,
  **X** model abstention. No confidence is shown because the export contains no
  probabilities.

Keyboard shortcuts, when not editing or focused on a control:

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Left / right | Back / forward 10 seconds |
| Comma / period | Previous / next frame (pauses) |

## Prediction contract and synchronization

Use the repository's `frame,label` CSV format: exactly 199,319 ordered rows,
frames `0..199318`, labels `H/A/D/X`. Header/label case, whitespace, quoted cells,
UTF-8 BOM and CRLF are accepted. Missing, duplicate or out-of-order frames and
invalid labels are rejected with an error, avoiding silent alignment mistakes.

Playback uses `requestVideoFrameCallback` and its `mediaTime`, aligned to the
25 fps tactical recording. Older browsers fall back to sampling `currentTime`
on display refresh. Seeking uses the video timeline, with HTTP byte-range support
so the whole video does not need to download. No tracking-counter or per-half ATD
offset is applied to submission CSVs. During a seek the inspector says SEEKING
until playback reaches the requested position. At high speed a browser can skip
displaying frames; history still shows all nine preceding source-frame predictions.

Files selected with **Add CSV** are read in the browser only and kept for that tab's
session; they are not uploaded, written into the repo, or retained after reload.
The server binds only to `127.0.0.1` and serves the viewer, selected video, and results
CSVs. Video and prediction files stay in their existing locations.

## Checks

```bash
python -m unittest discover -s viewer/tests -p "test_*.py"
node --test viewer/tests/core.test.mjs
```

The Python checks cover HTTP byte ranges, seeking responses and route isolation.
The JavaScript checks cover CSV alignment, frame timestamps, history, disagreements,
and loading the available repository predictions. Node is only needed for these
development checks, not for running the viewer.
