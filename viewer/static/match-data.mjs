import { activeEvents, LABELS, timecode, trackingChunkStart, trackingFrame, parseBallHeight } from './core.mjs';

const $ = id => document.getElementById(id);

async function getJSON(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}). Restart viewer/server.py and refresh the page.`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Could not load ${url}`);
  return data;
}

export function createMatchDataView({ onSeek = () => {} } = {}) {
  let frame = 0, fps = 25, events = null, eventError = '', eventKey = '';
  let enabled = false, seeking = false, metadata = null, metaError = '', metaPromise = null;
  let speedEnabled = false, timeline = null, timelineError = '', timelinePromise = null;
  let totalFrames = 199319, heightData = null, heightName = '';
  const cache = new Map(), pending = new Map(), errors = new Map();
  const canvas = $('tracking-canvas');
  const ctx = canvas.getContext('2d');

  function renderEvents() {
    const active = events ? activeEvents(events, frame) : [];
    const key = seeking ? 'seeking' : eventError || (events ? JSON.stringify(active) : 'loading');
    if (key === eventKey) return;
    eventKey = key;
    $('event-list').replaceChildren();
    if (seeking || !active.length) {
      $('event-list').textContent = seeking ? 'Seeking…' : eventError || (events ? 'No active tag' : 'Loading tags…');
      return;
    }
    for (const event of active) {
      const chip = document.createElement('span');
      chip.className = 'event-chip';
      const team = event.tags.Team;
      const side = /barcelona/i.test(team || '') ? 'H' : /at(?:h)?letic/i.test(team || '') ? 'A' : null;
      if (side) chip.style.setProperty('--event-color', LABELS[side].color);
      const title = document.createElement('strong');
      title.textContent = event.tags.Type ? `${event.code} · ${event.tags.Type}` : event.code;
      chip.append(title);
      if (team && team !== 'N/A') {
        const teamText = document.createElement('span');
        teamText.textContent = team;
        chip.append(teamText);
      }
      chip.title = `${timecode(event.start_frame / fps)}–${timecode(event.end_frame / fps)} | frames ${event.start_frame}–${event.end_frame - 1}\n${Object.entries(event.tags).map(([key, value]) => `${key}: ${value}`).join('\n')}`;
      $('event-list').append(chip);
    }
  }

  function drawPitch(row = null) {
    const width = Math.max(260, canvas.clientWidth);
    const height = width * 0.69;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const [length, breadth] = metadata?.pitch || [105.3, 68];
    const padding = 14, scale = Math.min((width - 2 * padding) / length, (height - 2 * padding) / breadth);
    const pw = length * scale, ph = breadth * scale;
    const left = (width - pw) / 2, top = (height - ph) / 2;
    // Rotate the previously mirrored view 180 degrees; source coordinates stay unchanged.
    // Display origin is top-left, with x increasing right and y increasing down.
    const xy = (x, y) => [left + x * pw, top + y * ph];
    ctx.fillStyle = '#244b39'; ctx.fillRect(left, top, pw, ph);
    for (let i = 0; i < 10; i += 2) {
      ctx.fillStyle = '#2a5540'; ctx.fillRect(left + i * pw / 10, top, pw / 10, ph);
    }
    ctx.strokeStyle = '#adceae'; ctx.lineWidth = 1;
    ctx.strokeRect(left, top, pw, ph);
    ctx.beginPath(); ctx.moveTo(left + pw / 2, top); ctx.lineTo(left + pw / 2, top + ph); ctx.stroke();
    ctx.beginPath(); ctx.arc(left + pw / 2, top + ph / 2, 9.15 * scale, 0, Math.PI * 2); ctx.stroke();
    for (const side of [0, 1]) {
      for (const [depth, boxWidth] of [[16.5, 40.3], [5.5, 18.3]]) {
        ctx.strokeRect(left + (side ? length - depth : 0) * scale, top + (breadth - boxWidth) * scale / 2, depth * scale, boxWidth * scale);
      }
    }
    ctx.fillStyle = '#a8bcb0'; ctx.font = '8px monospace';
    ctx.fillText(`${length} × ${breadth} m`, left, height - 2);
    ctx.fillText('(0,0)', left, top - 4);
    if (!row) return;
    const slots = new Map(metadata.slots.map(slot => [slot.id, slot.team]));
    function dot(x, y, color, radius, id) {
      const [px, py] = xy(x, y);
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#0b1712'; ctx.lineWidth = 1.4; ctx.stroke();
      if (id && $('tracking-ids').checked) {
        ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.lineWidth = 2; ctx.strokeStyle = '#102019'; ctx.strokeText(String(id), px, py - 7);
        ctx.fillStyle = '#fff'; ctx.fillText(String(id), px, py - 7); ctx.textAlign = 'left';
      }
    }
    for (const [id, x, y] of row.players) dot(x, y, LABELS[slots.get(id)]?.color || '#bbb', 4.3, id);
    if (row.ball) dot(row.ball[0], row.ball[1], '#fff', 4.2);
  }

  function requestChunk(start) {
    if (cache.has(start) || pending.has(start) || errors.has(start)) return;
    const controller = new AbortController();
    pending.set(start, controller);
    getJSON(`/api/tracking/chunk/${start}`, controller.signal).then(data => {
      cache.set(start, data);
      while (cache.size > 6) cache.delete(cache.keys().next().value);
    }).catch(error => {
      if (error.name !== 'AbortError') {
        errors.set(start, error.message);
        while (errors.size > 6) errors.delete(errors.keys().next().value);
      }
    }).finally(() => {
      if (pending.get(start) === controller) pending.delete(start);
      if ((enabled || speedEnabled) && !seeking && metadata && trackingChunkStart(frame, metadata.chunkSize) === start) renderTracking();
    });
  }

  function renderTracking() {
    if (!enabled && !speedEnabled) return;
    $('tracking-frame').textContent = seeking ? 'SEEKING' : `#${String(frame).padStart(6, '0')}`;
    const start = metadata ? trackingChunkStart(frame, metadata.chunkSize) : 0;
    const row = !seeking && metadata ? trackingFrame(cache.get(start), frame) : null;
    if (enabled) drawPitch(row);
    const status = seeking ? 'Seeking…' : metaError || errors.get(start) || 'Loading tracking…';
    if (speedEnabled) {
      for (const key of ['mean', 'median', 'total', 'min', 'max']) $('speed-' + key).textContent = row?.speed?.[key] == null ? '—' : row.speed[key].toFixed(2);
      $('speed-unit').textContent = metadata?.speedUnit || 'source units';
      $('speed-coverage').textContent = row?.speed ? `${row.speed.count} / ${row.players.length} slots with speed` : row ? 'Restart the viewer server to enable speed data.' : status;
    }
    if (!row) {
      $('tracking-counts').textContent = 'H — · A —';
      $('tracking-status').textContent = seeking ? 'Seeking…' : metaError || errors.get(start) || (metadata ? 'Loading tracking…' : 'Reading ATD metadata…');
      if (metadata && !seeking && !errors.has(start)) requestChunk(start);
      return;
    }
    const slots = new Map(metadata.slots.map(slot => [slot.id, slot.team]));
    const home = row.players.filter(player => slots.get(player[0]) === 'H').length;
    $('tracking-counts').textContent = `H ${home} · A ${row.players.length - home}`;
    const outside = row.players.filter(([, x, y]) => x < 0 || x > 1 || y < 0 || y > 1).length;
    const ballOutside = row.ball && (row.ball[0] < 0 || row.ball[0] > 1 || row.ball[1] < 0 || row.ball[1] > 1);
    $('tracking-status').textContent = (row.ball ? (ballOutside ? 'Ball tracked outside pitch' : 'Ball tracked') : 'Ball not tracked') + (outside ? ` · ${outside} players outside pitch` : '') + (!row.players.length ? ' · No players tracked' : '');
    // Prepare the next 20-second chunk without downloading the whole match.
    if (frame - start >= metadata.chunkSize * 0.6 && start + metadata.chunkSize < metadata.frames) requestChunk(start + metadata.chunkSize);
  }

  async function enableTracking() {
    enabled = $('tracking-toggle').checked;
    $('tracking-panel').hidden = !enabled;
    $('feed-layout').classList.toggle('with-tracking', enabled);
    if (!enabled && !speedEnabled) {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
      return;
    }
    errors.clear(); metaError = '';
    renderTracking();
    if (!metadata) {
      if (!metaPromise) metaPromise = getJSON('/api/tracking/meta').then(data => { metadata = data; })
        .catch(error => { metaError = error.message; }).finally(() => { metaPromise = null; });
      await metaPromise;
    }
    renderTracking();
  }
  $('tracking-toggle').onchange = enableTracking;
  $('tracking-ids').onchange = renderTracking;
  new ResizeObserver(() => { if (enabled) renderTracking(); }).observe(canvas);

  function chartWindow() {
    if ($('speed-window').value === 'match') return [0, totalFrames];
    const span = 60 * fps;
    const start = Math.max(0, Math.min(totalFrames - span, frame - span / 2));
    return [start, Math.min(totalFrames, start + span)];
  }

  function drawSpeedCharts() {
    if (!speedEnabled) return;
    const [start, end] = chartWindow();
    for (const [id, keys, colors] of [
      ['speed-average-chart', ['max', 'min', 'mean', 'median'], ['#74c5a1', '#e49cc5', '#69a9ff', '#e6c170']],
      ['speed-total-chart', ['total'], ['#c29bff']],
    ]) {
      const chart = $(id), context = chart.getContext('2d');
      const width = Math.max(200, chart.clientWidth), height = 95, ratio = window.devicePixelRatio || 1;
      chart.width = width * ratio; chart.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const left = 34, right = width - 8, top = 10, bottom = 73;
      const rows = timeline?.bins.filter(bin => bin.end > start && bin.start < end) || [];
      const max = Math.max(1, ...rows.flatMap(row => keys.map(key => row[key] ?? 0))) * 1.1;
      context.strokeStyle = '#354339'; context.lineWidth = 1;
      for (const y of [top, bottom]) { context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke(); }
      context.font = '9px monospace'; context.fillStyle = '#94a29b'; context.textAlign = 'left';
      context.fillText(max.toFixed(1), 1, top + 3); context.fillText('0', 20, bottom + 3);
      context.fillText(timecode(start / fps), left, 91);
      context.textAlign = 'right'; context.fillText(timecode(end / fps), right, 91); context.textAlign = 'left';
      keys.forEach((key, index) => {
        context.strokeStyle = colors[index]; context.lineWidth = 1.5; context.beginPath();
        let connected = false;
        for (const row of rows) {
          if (row[key] == null) { connected = false; continue; }
          const x = left + (Math.min(end, Math.max(start, (row.start + row.end) / 2)) - start) / (end - start) * (right - left);
          const y = bottom - row[key] / max * (bottom - top);
          if (connected) context.lineTo(x, y); else context.moveTo(x, y);
          connected = true;
        }
        context.stroke();
      });
      if (!seeking) {
        const x = left + (frame - start) / (end - start) * (right - left);
        context.strokeStyle = '#d4ed91'; context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
      }
    }
    $('speed-chart-status').textContent = timeline ? '1 s averages · click a graph to seek · no observations = gap' : timelineError || 'Reading full-match speeds…';
  }

  function placeSpeedPanel() {
    const right = $('speed-placement').value === 'right';
    const slot = $(right ? 'speed-side-slot' : 'speed-inline-slot');
    if ($('speed-panel').parentElement !== slot) slot.append($('speed-panel'));
    $('speed-side-slot').hidden = !right || !speedEnabled;
    document.querySelector('.workspace').classList.toggle('speed-on-right', right && speedEnabled);
    drawSpeedCharts();
  }
  $('speed-placement').onchange = placeSpeedPanel;

  $('speed-toggle').onchange = async () => {
    speedEnabled = $('speed-toggle').checked;
    $('speed-panel').hidden = !speedEnabled;
    placeSpeedPanel();
    await enableTracking();
    if (!speedEnabled) return;
    drawSpeedCharts();
    if (!timeline && !timelinePromise) {
      timelineError = '';
      timelinePromise = getJSON('/api/speeds').then(data => { timeline = data; })
        .catch(error => { timelineError = error.message; }).finally(() => { timelinePromise = null; drawSpeedCharts(); });
    }
  };
  $('speed-window').onchange = drawSpeedCharts;
  for (const id of ['speed-average-chart', 'speed-total-chart']) {
    $(id).onclick = event => {
      if (!timeline) return;
      const rect = $(id).getBoundingClientRect(), [start, end] = chartWindow();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - 34) / (rect.width - 42)));
      onSeek(Math.min(totalFrames - 1, Math.round(start + fraction * (end - start))));
    };
    new ResizeObserver(drawSpeedCharts).observe($(id));
  }

  function renderHeight() {
    if (!$('height-toggle').checked) return;
    const z = !seeking ? heightData?.values.get(frame) : undefined;
    const maximum = Math.max(5, Math.ceil((heightData?.maximum || 0) / 5) * 5);
    $('height-value').textContent = z === undefined ? '— m' : `${z.toFixed(2)} m`;
    $('height-bar').classList.toggle('unknown', z === undefined);
    $('height-fill').style.width = z === undefined ? '0%' : `${100 * z / maximum}%`;
    $('height-scale').textContent = `0–${maximum} m`;
    $('height-bar').setAttribute('aria-label', z === undefined ? 'Ball height unavailable' : `Ball height ${z.toFixed(2)} metres; scale zero to ${maximum} metres`);
    $('height-source').textContent = seeking ? 'Seeking…' : !heightData ? 'ATD has x, y, speed; no z. Load a frame,z CSV in metres.' : z === undefined ? `${heightName} · no height for this frame` : heightName;
    $('height-clear').hidden = !heightData;
  }
  $('height-toggle').onchange = () => { $('height-panel').hidden = !$('height-toggle').checked; renderHeight(); };
  $('height-upload').onclick = () => $('height-file').click();
  $('height-clear').onclick = () => { heightData = null; heightName = ''; $('height-error').textContent = ''; renderHeight(); };
  $('height-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('Height CSV exceeds 20 MB.');
      heightData = parseBallHeight(await file.text(), totalFrames);
      heightName = file.name;
      $('height-error').textContent = '';
      renderHeight();
    } catch (error) { $('height-error').textContent = error.message; }
    event.target.value = '';
  };

  return {
    async load(rate, frames) {
      fps = rate;
      totalFrames = frames;
      try { events = (await getJSON('/api/events')).events; }
      catch (error) { eventError = `Tags unavailable: ${error.message}`; }
      renderEvents();
    },
    update(currentFrame) {
      frame = currentFrame;
      if (metadata) {
        const start = trackingChunkStart(frame, metadata.chunkSize);
        for (const [key, controller] of pending) {
          if (key !== start && key !== start + metadata.chunkSize) {
            controller.abort(); pending.delete(key);
          }
        }
      }
      renderEvents(); renderTracking(); drawSpeedCharts(); renderHeight();
    },
    setSeeking(value) { seeking = value; renderEvents(); renderTracking(); drawSpeedCharts(); renderHeight(); },
  };
}
