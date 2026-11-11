import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parsePredictions, frameAtTime, historyFrames, findDisagreement, activeEvents, trackingChunkStart, trackingFrame } from '../static/core.mjs';

test('CSV accepts contract normalization, quoted cells, BOM and Windows newlines', () => {
  assert.deepEqual(parsePredictions('\uFEFF Frame , Label\r\n"0"," h "\r\n1,A\r\n2,D\r\n3,X\r\n', 4), ['H', 'A', 'D', 'X']);
});
test('CSV rejects missing, duplicated, shuffled, one-based and invalid predictions', () => {
  for (const input of [
    'frame,label\n0,H', 'frame,label\n0,H\n0,A', 'frame,label\n1,H\n0,A',
    'frame,label\n1,H\n2,A', 'frame,label\n0,H\n1,Z', 'frame,label\n0,H\n1,',
    'frame,label\n0,H\n1,A,0.8', 'index,label\n0,H\n1,A',
  ]) assert.throws(() => parsePredictions(input, 2));
});
test('media timestamps map to zero-based frames across both halves and boundaries', () => {
  for (const frame of [0, 1, 24, 25, 11185, 11186, 90651, 110808, 113741, 199318]) {
    assert.equal(frameAtTime(frame / 25, 25, 199319), frame);
    assert.equal(frameAtTime((frame + 0.25) / 25, 25, 199319), frame);
    assert.equal(frameAtTime((frame + 0.99) / 25, 25, 199319), frame);
  }
  assert.equal(frameAtTime(7972.76, 25, 199319), 199318);
  assert.equal(frameAtTime(-1, 25, 199319), 0);
});
test('history always means the nine preceding frames after forward or backward seeking', () => {
  for (const frame of [11185, 113741, 25, 0]) {
    assert.deepEqual(historyFrames(frame), [1, 2, 3, 4, 5, 6, 7, 8, 9].map(offset => frame - offset));
  }
});
test('disagreement navigation scans in either direction without wrapping', () => {
  const models = [{ labels: ['H', 'A', 'D', 'X'] }, { labels: ['H', 'D', 'D', 'H'] }];
  assert.equal(findDisagreement(models, 0, 1, 4), 1);
  assert.equal(findDisagreement(models, 2, 1, 4), 3);
  assert.equal(findDisagreement(models, 3, -1, 4), 1);
  assert.equal(findDisagreement(models, 3, 1, 4), null);
  assert.equal(findDisagreement(models.slice(0, 1), 0, 1, 4), null);
});
test('all repository model exports load at the match frame count', () => {
  const folder = new URL('../../evaluation/results/', import.meta.url);
  for (const name of readdirSync(folder).filter(name => name.endsWith('.csv'))) {
    assert.equal(parsePredictions(readFileSync(new URL(name, folder), 'utf8'), 199319).length, 199319, name);
  }
});

test('tags include overlapping phases and obey half-open boundaries after rewinding', () => {
  const a = { start_frame: 10, end_frame: 20 }, b = { start_frame: 15, end_frame: 25 };
  const events = [a, b];
  assert.deepEqual(activeEvents(events, 9), []);
  assert.deepEqual(activeEvents(events, 10), [a]);
  assert.deepEqual(activeEvents(events, 19), [a, b]);
  assert.deepEqual(activeEvents(events, 20), [b]);
  assert.deepEqual(activeEvents(events, 25), []);
  assert.deepEqual(activeEvents(events, 15), [a, b]);
});

test('tracking selection never returns stale frames across chunk boundaries or backward seeks', () => {
  const chunk = { start: 500, frames: [{ frame: 500, ball: null }, { frame: 501, ball: [0.5, 0.5, null] }] };
  assert.equal(trackingChunkStart(499, 500), 0);
  assert.equal(trackingChunkStart(500, 500), 500);
  assert.equal(trackingChunkStart(199318, 500), 199000);
  assert.equal(trackingFrame(chunk, 500).ball, null);
  assert.deepEqual(trackingFrame(chunk, 501).ball, [0.5, 0.5, null]);
  assert.equal(trackingFrame(chunk, 499), null);
  assert.equal(trackingFrame(chunk, 502), null);
  assert.equal(trackingFrame(undefined, 0), null);
  assert.equal(trackingFrame({ start: 500, frames: [{ frame: 501 }] }, 500), null);
});
