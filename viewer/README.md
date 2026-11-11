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

Smart Tagging appears in a compact strip directly below the video. All active phases
are shown, including overlapping tags, with team and event type where available.
Hover a tag for its interval and full metadata. These are automatic annotations,
not ground truth. Intervals include their start frame and exclude their end frame.

Enable **Tracking pitch** beside the jump controls to view the raw ATD on a top-down
field, as in `02_tracking_atd.ipynb`. It follows playback, frame stepping and seeking.
Barcelona is blue, Athletic is pink, and the ball is white, matching the viewer legend.
The plot uses normalized field coordinates and the pitch dimensions from `games.py`.
The display origin is at the upper-left corner, with x increasing right and y
increasing down (a 180-degree rotation of the previous horizontally mirrored view).
Labels remain upright and the underlying ATD coordinates stay unchanged. Missing players vanish;
missing balls are explicitly reported. Nothing is interpolated or manually corrected.
**Slot IDs** shows track slots, not persistent player identities or shirt numbers.

Tracking is read in 500-frame chunks with bounded caches and next-chunk prefetch.
The first request indexes the raw file once; loading and seeking clear the markers
until data for the current frame is ready. Restart the server after replacing source
ATD or tagging files. Missing source files produce a message in the relevant panel
and do not prevent video/prediction playback. All assets use `games.asset_paths()`
and respect `MTAH_DATA_DIR`; a custom `--video` must match these tactical annotations.

Enable **Player speed** to show the exact current-frame mean, median, highest, lowest, and sum of
player speeds, plus the number of visible slots with valid speed. Two clickable
timelines show mean/median/highest/lowest and total: choose a nearby 60-second window or the full
match. Graphs average the per-frame statistics in one-second bins; the readouts
are always the current frame. Highest/lowest curves average the per-frame maximum/minimum,
so they are not the absolute extremes of the entire second. Missing, negative or non-finite speeds are excluded;
no valid speeds means unavailable, not zero. Both teams are combined. The total is
a sum of scalar speeds, not a velocity, and depends on tracking coverage.

In the speed panel, choose **Position → Right of video** to stack the two graphs
above the frame inspector, or **Below video** for the original layout. The pitch,
inspector, Smart Tagging, ball height and model comparison remain available in either
layout. Narrow screens stack the right column below the video.

Units follow the ATD XML (`kph`, displayed as **km/h**), despite the m/s description
in DATA.md; no conversion is guessed. The exact same aggregation helper powers
[`starter/04_player_speed.ipynb`](../starter/04_player_speed.ipynb), which produces
the two Matplotlib graphs using the repo's analysis libraries. Neither view uses
ground truth, tunes a threshold, or makes a dead-ball decision.

**Ball height** shows a compact z readout and bar. The supplied export has no z
channel: Kloppy creates `ball_z` but fills it with None. The third raw ball value
is speed. The bar therefore shows unavailable (striped), never a fabricated zero.
To inspect a separately produced height signal, load a `frame,z` CSV: zero-based,
strictly increasing unique frame IDs and nonnegative heights in metres. Sparse
frames and blank/NaN/null z values are allowed; missing observations are not
interpolated. The bar has a fixed per-file scale covering the largest height,
rounded up to a multiple of 5 m (minimum 5 m). File data stays in the browser tab.

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

The Python checks cover HTTP byte ranges, seeking responses, route isolation, ATD
alignment, missing observations, and annotation endpoints. The JavaScript checks
cover CSV alignment, frame timestamps, history, disagreements, event boundaries,
tracking chunk selection, and loading the available repository predictions. Node is only needed for these
development checks, not for running the viewer.
