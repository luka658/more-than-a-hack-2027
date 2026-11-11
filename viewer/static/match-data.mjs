import { activeEvents, LABELS, timecode, trackingChunkStart, trackingFrame } from './core.mjs';

const $ = id => document.getElementById(id);

async function getJSON(url, signal) {
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Could not load ${url}`);
  return data;
}

export function createMatchDataView() {
  let frame = 0, fps = 25, events = null, eventError = '', eventKey = '';
  let enabled = false, seeking = false, metadata = null, metaError = '', metaPromise = null;
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
      if (enabled && !seeking && metadata && trackingChunkStart(frame, metadata.chunkSize) === start) renderTracking();
    });
  }

  function renderTracking() {
    if (!enabled) return;
    $('tracking-frame').textContent = seeking ? 'SEEKING' : `#${String(frame).padStart(6, '0')}`;
    const start = metadata ? trackingChunkStart(frame, metadata.chunkSize) : 0;
    const row = !seeking && metadata ? trackingFrame(cache.get(start), frame) : null;
    drawPitch(row);
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
    if (!enabled) {
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

  return {
    async load(rate) {
      fps = rate;
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
      renderEvents(); renderTracking();
    },
    setSeeking(value) { seeking = value; renderEvents(); renderTracking(); },
  };
}
