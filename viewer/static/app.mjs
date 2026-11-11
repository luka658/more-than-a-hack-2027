import { LABELS, parsePredictions, frameAtTime, historyFrames, findDisagreement, timecode } from './core.mjs';
import { createMatchDataView } from './match-data.mjs';

const $ = id => document.getElementById(id);
const video = $('video');
const models = [];
const matchData = createMatchDataView({ onSeek: frame => seekFrame(frame, true) });
let config, currentFrame = 0, primary = null, nextId = 0, historyRows = [], ready = false;
let pendingFrame = null;

function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function focusModel() { return models.find(model => model.id === primary); }
function orderedModels() {
  const focus = focusModel();
  return focus ? [focus, ...models.filter(model => model !== focus)] : [];
}
function paintLabel(node, code) {
  node.style.setProperty('--label-color', LABELS[code]?.color || '#87949b');
}
function refreshOptions() {
  const selected = $('repo-model').value;
  $('repo-model').replaceChildren(...config.models.map(name => new Option(name, name)));
  if (config.models.includes(selected)) $('repo-model').value = selected;
  $('add-repo').disabled = !config.models.length;
}
async function fetchConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Could not read the viewer configuration. Restart the Python server.');
  return response.json();
}
function addModel(name, source, labels) {
  const existing = models.find(model => model.source === source);
  if (existing) {
    existing.labels = labels;
    primary = existing.id;
  } else {
    const model = { id: String(++nextId), name, source, labels };
    models.push(model);
    if (!primary) primary = model.id;
  }
  rebuildModels();
}
async function loadRepo(name) {
  if (!name) return;
  const response = await fetch(`/api/models/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Could not load ${name}. Refresh the file list and try again.`);
  addModel(name.replace(/\.csv$/i, ''), `repo:${name}`, parsePredictions(await response.text(), config.frames));
}

function drawTimeline(model) {
  const canvas = model.canvas;
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
  canvas.height = 24;
  const context = canvas.getContext('2d');
  // Draw contiguous runs, preserving brief changes as at least a pixel.
  let start = 0;
  while (start < config.frames) {
    const label = model.labels[start];
    let end = start + 1;
    while (end < config.frames && model.labels[end] === label) end++;
    context.fillStyle = LABELS[label].color;
    context.fillRect(start / config.frames * canvas.width, 0,
      Math.max(1, (end - start) / config.frames * canvas.width), canvas.height);
    start = end;
  }
}

function rebuildModels() {
  $('model-count').textContent = models.length;
  $('primary-model').replaceChildren(...models.map(model => new Option(model.name, model.id)));
  $('primary-model').value = primary || '';
  $('primary-model').disabled = !models.length;
  $('model-list').replaceChildren();
  for (const model of models) {
    const row = element('div', `model-row${model.id === primary ? ' active' : ''}`);
    const heading = element('div', 'model-row-head');
    const name = element('button', 'model-name', model.name);
    name.title = `Focus ${model.name}`;
    name.onclick = () => { primary = model.id; rebuildModels(); };
    model.badge = element('span', 'current-badge');
    const remove = element('button', 'remove-model', '×');
    remove.setAttribute('aria-label', `Remove ${model.name}`);
    remove.onclick = () => {
      models.splice(models.indexOf(model), 1);
      if (primary === model.id) primary = models[0]?.id || null;
      rebuildModels();
    };
    heading.append(name, model.badge, remove);
    const lane = element('div', 'timeline');
    lane.tabIndex = 0;
    lane.setAttribute('role', 'slider');
    lane.setAttribute('aria-label', `${model.name} timeline`);
    lane.setAttribute('aria-valuemin', '0');
    lane.setAttribute('aria-valuemax', String(config.frames - 1));
    lane.onclick = event => {
      const rect = lane.getBoundingClientRect();
      seekFrame(Math.round((event.clientX - rect.left) / rect.width * (config.frames - 1)));
    };
    lane.onkeydown = event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        seekFrame(currentFrame + (event.key === 'ArrowLeft' ? -1 : 1));
      }
    };
    model.lane = lane;
    model.canvas = element('canvas');
    model.playhead = element('span', 'playhead');
    lane.append(model.canvas, model.playhead);
    row.append(heading, lane);
    $('model-list').append(row);
    drawTimeline(model);
  }
  if (!models.length) $('model-list').append(element('p', 'empty-models', 'Add a prediction CSV to inspect possession and compare models on the same video timeline.'));
  const ordered = orderedModels();
  const head = element('tr');
  head.append(element('th', '', 'FRAME'));
  for (const [index, model] of ordered.entries()) {
    const cell = element('th', '', index === 0 ? `● ${model.name}` : model.name);
    cell.title = model.name;
    head.append(cell);
  }
  $('history').tHead.replaceChildren(head);
  const body = $('history').tBodies[0];
  body.replaceChildren();
  historyRows = Array.from({ length: 9 }, (_, index) => {
    const row = element('tr');
    const frameCell = element('td');
    const number = element('span');
    frameCell.append(element('small', '', `−${index + 1}`), number);
    row.append(frameCell);
    const badges = ordered.map((model, column) => {
      const cell = element('td');
      const badge = element('span', 'history-badge');
      const code = element('b');
      const label = element('span');
      badge.append(code);
      if (column === 0) badge.append(label);
      cell.append(badge); row.append(cell);
      return { model, badge, code, label };
    });
    body.append(row);
    return { row, number, badges };
  });
  $('prev-diff').disabled = $('next-diff').disabled = models.length < 2;
  renderFrame(currentFrame, true);
}

function renderFrame(frame, force = false) {
  if (!force && currentFrame === frame) return;
  currentFrame = frame;
  matchData.update(frame);
  const time = frame / config.fps;
  $('frame-number').textContent = `#${String(frame).padStart(6, '0')}`;
  $('elapsed').textContent = timecode(time);
  $('seek').value = frame;
  if (document.activeElement !== $('frame-input')) $('frame-input').value = frame;
  $('frame-time').textContent = `${timecode(time)}.${String(Math.round(frame % config.fps * 1000 / config.fps)).padStart(3, '0')}`;
  const code = focusModel()?.labels[frame];
  const info = LABELS[code];
  $('hero-code').textContent = code || '—';
  $('hero-name').textContent = info?.name || 'No model loaded';
  $('hero-detail').textContent = info?.detail || 'Add a prediction CSV below the video';
  paintLabel($('hero'), code);
  const disagree = models.length > 1 && models.some(model => model.labels[frame] !== models[0].labels[frame]);
  $('agreement').textContent = models.length < 2 ? (models.length ? 'Add another model to compare' : 'Load predictions to compare') : disagree ? '● Models disagree on this frame' : '● All models agree on this frame';
  $('agreement').className = models.length < 2 ? '' : disagree ? 'agreement-diff' : 'agreement-ok';
  for (const model of models) {
    const label = model.labels[frame];
    model.badge.textContent = `${label} · ${LABELS[label].name}`;
    paintLabel(model.badge, label);
    model.playhead.style.left = `${frame / (config.frames - 1) * 100}%`;
    model.lane.setAttribute('aria-valuenow', String(frame));
    model.lane.setAttribute('aria-valuetext', `Frame ${frame}, ${LABELS[label].name}`);
  }
  historyFrames(frame).forEach((previous, index) => {
    const { row, number, badges } = historyRows[index] || {};
    if (!row) return;
    number.textContent = previous >= 0 ? String(previous).padStart(6, '0') : '—';
    row.classList.toggle('history-diff', previous >= 0 && models.length > 1 && models.some(model => model.labels[previous] !== models[0].labels[previous]));
    badges.forEach(({ model, badge, code, label }) => {
      const prediction = previous >= 0 ? model.labels[previous] : null;
      code.textContent = prediction || '—';
      label.textContent = prediction ? LABELS[prediction].name : 'Before video start';
      badge.title = prediction ? `${model.name}: ${LABELS[prediction].name}` : 'No earlier frame';
      paintLabel(badge, prediction);
    });
  });
}

function seekFrame(frame, pause = false) {
  if (!ready || !Number.isFinite(frame)) return;
  const target = Math.max(0, Math.min(config.frames - 1, Math.round(frame)));
  if (pause) video.pause();
  pendingFrame = target;
  // Seek inside the frame interval, away from floating point boundary ambiguity.
  video.currentTime = (target + 0.25) / config.fps;
}
function syncStatus() {
  const seeking = video.seeking;
  matchData.setSeeking(seeking);
  $('sync-status').textContent = seeking ? 'SEEKING…' : video.paused ? 'PAUSED · FRAME SYNC' : 'PLAYING · FRAME SYNC';
  $('inspector-state').textContent = seeking ? 'SEEKING' : video.paused ? 'PAUSED' : 'PLAYING';
  $('play').textContent = video.paused ? '▶' : 'Ⅱ';
  $('play').setAttribute('aria-label', video.paused ? 'Play video' : 'Pause video');
  $('stage-play').hidden = !video.paused || !ready;
}
async function togglePlay() {
  if (!ready) return;
  if (video.paused) {
    try { await video.play(); } catch (error) { notice(`Playback could not start: ${error.message}`); }
  } else video.pause();
}
function skipDisagreement(direction) {
  const frame = findDisagreement(models, currentFrame, direction, config.frames);
  if (frame === null) notice(`No ${direction > 0 ? 'later' : 'earlier'} disagreement between the loaded models.`);
  else { notice(); seekFrame(frame, true); }
}

$('play').onclick = $('stage-play').onclick = togglePlay;
video.onclick = togglePlay;
$('back-ten').onclick = () => seekFrame(currentFrame - 10 * config.fps);
$('forward-ten').onclick = () => seekFrame(currentFrame + 10 * config.fps);
$('prev-frame').onclick = () => seekFrame((pendingFrame ?? currentFrame) - 1, true);
$('next-frame').onclick = () => seekFrame((pendingFrame ?? currentFrame) + 1, true);
$('seek').oninput = event => seekFrame(Number(event.target.value));
$('speed').onchange = event => { video.playbackRate = Number(event.target.value); };
$('frame-form').onsubmit = event => { event.preventDefault(); seekFrame(Number($('frame-input').value), true); };
$('first-half').onclick = () => seekFrame(config.kickoffs[0], true);
$('second-half').onclick = () => seekFrame(config.kickoffs[1], true);
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.workspace').requestFullscreen(); }
  catch { notice('Fullscreen is unavailable in this browser.'); }
};
$('primary-model').onchange = event => { primary = event.target.value; rebuildModels(); };
$('prev-diff').onclick = () => skipDisagreement(-1);
$('next-diff').onclick = () => skipDisagreement(1);
$('refresh').onclick = async () => {
  try { config.models = (await fetchConfig()).models; refreshOptions(); notice(); }
  catch (error) { notice(error.message); }
};
$('add-repo').onclick = async () => {
  $('add-repo').disabled = true;
  try { await loadRepo($('repo-model').value); notice(); }
  catch (error) { notice(error.message); }
  finally { $('add-repo').disabled = !config.models.length; }
};
$('upload').onclick = () => $('file-input').click();
$('file-input').onchange = async event => {
  const errors = [];
  for (const file of event.target.files) {
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('CSV exceeds 20 MB. Use a frame,label export.');
      addModel(file.name.replace(/\.csv$/i, ''), `local:${file.name}`, parsePredictions(await file.text(), config.frames));
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  notice(errors.join('\n'));
  event.target.value = '';
};
document.addEventListener('keydown', event => {
  if (!ready || event.ctrlKey || event.metaKey || event.altKey || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
  const actions = {
    ' ': togglePlay,
    ArrowLeft: () => seekFrame(currentFrame - config.fps * 10),
    ArrowRight: () => seekFrame(currentFrame + config.fps * 10),
    ',': () => seekFrame((pendingFrame ?? currentFrame) - 1, true),
    '.': () => seekFrame((pendingFrame ?? currentFrame) + 1, true),
  };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
});
for (const event of ['play', 'pause', 'seeking', 'seeked', 'ended']) video.addEventListener(event, syncStatus);
video.addEventListener('seeked', () => {
  pendingFrame = null;
  renderFrame(frameAtTime(video.currentTime, config.fps, config.frames), true);
});
video.addEventListener('loadedmetadata', () => {
  ready = true;
  const actualFrames = Math.round(video.duration * config.fps);
  if (Math.abs(actualFrames - config.frames) > 1) notice(`This video's duration does not match the ${config.frames.toLocaleString()}-frame tactical recording. Check the video path before comparing predictions.`);
  seekFrame(config.kickoffs[0], true);
  syncStatus();
});
video.addEventListener('error', () => {
  ready = false;
  $('stage-play').hidden = true;
  $('video-error').textContent = 'Unable to play the tactical video. Check that the match assets are in data/tactical/ (or MTAH_DATA_DIR), then reload. The browser must support H.264 MP4.';
  $('video-error').hidden = false;
  $('sync-status').textContent = 'VIDEO UNAVAILABLE';
});

function onVideoFrame(now, metadata) {
  if (config && !video.seeking) renderFrame(frameAtTime(metadata.mediaTime, config.fps, config.frames));
  video.requestVideoFrameCallback(onVideoFrame);
}
if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onVideoFrame);
else {
  // Older browsers: sample the media clock on display refresh, never wall time.
  const tick = () => {
    if (ready && !video.seeking) renderFrame(frameAtTime(video.currentTime, config.fps, config.frames));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
new ResizeObserver(() => models.forEach(drawTimeline)).observe($('model-list'));

async function init() {
  try {
    config = await fetchConfig();
    matchData.load(config.fps, config.frames);
    $('seek').max = $('frame-input').max = config.frames - 1;
    $('frame-count').textContent = `${config.frames.toLocaleString()} frames`;
    $('duration').textContent = timecode(config.frames / config.fps);
    $('timeline-end').textContent = timecode(config.frames / config.fps);
    refreshOptions();
    rebuildModels();
    if (config.defaultModel) {
      $('repo-model').value = config.defaultModel;
      try { await loadRepo(config.defaultModel); }
      catch (error) { notice(error.message); }
    }
    video.src = '/video';
    if (!config.videoAvailable) notice('Tactical video not found. Unpack the match assets into data/ or set MTAH_DATA_DIR, then restart the viewer.');
  } catch (error) { notice(error.message); }
}
init();
