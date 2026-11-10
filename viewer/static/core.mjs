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
