export const LABELS = {
  H: { name: 'Barcelona', detail: 'Home possession', color: '#69a9ff' },
  A: { name: 'Athletic Club', detail: 'Away possession', color: '#ff8590' },
  D: { name: 'Dead ball', detail: 'Ball out of play', color: '#e6c170' },
  X: { name: 'Abstained', detail: 'No possession assigned', color: '#87949b' },
};

// The submission contract is zero-based, continuous video frames; no ATD offset.
export function parsePredictions(text, frameCount) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cells = line => line.split(',').map(value => value.trim().replace(/^"(.*)"$/, '$1').trim());
  if (cells(lines[0]).map(x => x.toLowerCase()).join(',') !== 'frame,label') {
    throw new Error('Expected the CSV header frame,label.');
  }
  if (lines.length - 1 !== frameCount) {
    throw new Error(`Expected ${frameCount.toLocaleString()} frames; found ${(lines.length - 1).toLocaleString()}. Export one row per tactical video frame.`);
  }
  const labels = new Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const row = cells(lines[frame + 1]);
    if (row.length !== 2 || !/^\d+$/.test(row[0]) || Number(row[0]) !== frame) {
      throw new Error(`CSV row ${frame + 2}: expected frame ${frame}. Frames must start at 0 and be in order.`);
    }
    const label = row[1].toUpperCase();
    if (!LABELS[label]) throw new Error(`Frame ${frame}: invalid label "${row[1]}". Use H, A, D or X.`);
    labels[frame] = label;
  }
  return labels;
}

export function frameAtTime(time, fps, count) {
  return Math.max(0, Math.min(count - 1, Math.floor(time * fps + 1e-5)));
}

export function historyFrames(frame) {
  return Array.from({ length: 9 }, (_, index) => frame - index - 1);
}

export function findDisagreement(models, frame, direction, count) {
  if (models.length < 2) return null;
  for (let i = frame + direction; i >= 0 && i < count; i += direction) {
    if (models.some(model => model.labels[i] !== models[0].labels[i])) return i;
  }
  return null;
}

export function timecode(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function activeEvents(events, frame) {
  // The loader defines half-open intervals. Recompute on seek, including backward.
  return events.filter(event => event.start_frame <= frame && frame < event.end_frame);
}

export function trackingChunkStart(frame, size) {
  return Math.floor(frame / size) * size;
}

export function trackingFrame(chunk, frame) {
  const row = chunk?.frames[frame - chunk.start];
  return row?.frame === frame ? row : null;
}

export function parseBallHeight(text, frameCount) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cells = line => line.split(',').map(value => value.trim().replace(/^"(.*)"$/, '$1').trim());
  if (cells(lines[0]).map(value => value.toLowerCase()).join(',') !== 'frame,z') {
    throw new Error('Expected frame,z CSV: zero-based video frame and height in metres.');
  }
  const values = new Map();
  let previous = -1, maximum = 0;
  for (let index = 1; index < lines.length; index++) {
    const row = cells(lines[index]);
    const frame = Number(row[0]);
    if (row.length !== 2 || !/^\d+$/.test(row[0]) || !Number.isSafeInteger(frame) || frame <= previous || frame >= frameCount) {
      throw new Error(`Height row ${index + 1}: frames must be unique, increasing, and between 0 and ${frameCount - 1}.`);
    }
    previous = frame;
    if (row[1] === '' || /^(nan|null)$/i.test(row[1])) continue;
    const height = Number(row[1]);
    if (!Number.isFinite(height) || height < 0) throw new Error(`Height row ${index + 1}: z must be a nonnegative height in metres.`);
    values.set(frame, height);
    maximum = Math.max(maximum, height);
  }
  if (!values.size) throw new Error('Height CSV has no finite height observations.');
  return { values, maximum };
}
