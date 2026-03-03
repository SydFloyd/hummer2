const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_MODES = [
  { id: "chromatic", label: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], detectable: false },
  { id: "major", label: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11], detectable: true },
  { id: "minor", label: "Natural Minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10], detectable: true },
  { id: "dorian", label: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10], detectable: true },
  { id: "phrygian", label: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10], detectable: true },
  { id: "lydian", label: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11], detectable: true },
  { id: "mixolydian", label: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10], detectable: true },
  { id: "locrian", label: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10], detectable: true },
  { id: "harmonicMinor", label: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11], detectable: true },
  { id: "majorPentatonic", label: "Major Pentatonic", intervals: [0, 2, 4, 7, 9], detectable: true },
  { id: "minorPentatonic", label: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10], detectable: true },
  { id: "blues", label: "Blues", intervals: [0, 3, 5, 6, 7, 10], detectable: true },
  { id: "arabic", label: "Arabic (Double Harmonic)", intervals: [0, 1, 4, 5, 7, 8, 11], detectable: true }
];
const SCALE_BY_ID = Object.fromEntries(SCALE_MODES.map((mode) => [mode.id, mode]));
const AUTO_DETECT_MODE_IDS = SCALE_MODES.filter((mode) => mode.detectable).map((mode) => mode.id);

const PITCH_MAX_MIDI = 76; // E5
const APP_CONFIG = {
  controls: {
    gateMultiplier: { min: 1.2, max: 6, step: 0.1, defaultValue: 2.5 },
    minNoteMs: { min: 20, max: 300, step: 5, defaultValue: 25 },
    bendSmoothing: { min: 0, max: 100, step: 1, defaultValue: 35 }
  },
  pitch: {
    minHz: 70,
    minMidi: Math.floor(69 + (12 * Math.log2(70 / 440))),
    maxMidi: PITCH_MAX_MIDI,
    maxHz: 440 * Math.pow(2, (PITCH_MAX_MIDI - 69) / 12),
    maxLabel: midiToNoteName(PITCH_MAX_MIDI)
  },
  analysis: {
    pitchFrameSize: 2048,
    pitchHopSize: 256,
    spectrogramFrameSize: 1024,
    spectrogramHopSize: 256,
    spectrogramMaxFreq: 4500,
    minF0Correlation: 0.35,
    minFrameEnergy: 1e-7
  },
  detection: {
    gateOffset: 0.0015,
    noiseQuietFraction: 0.2,
    noiseQuietMinFrames: 4,
    endHoldFrames: 1,
    pitchRecoverySearchRadius: 4,
    rawPitchReducer: "median"
  },
  autotune: {
    defaultRoot: 0,
    defaultModeId: "auto",
    autoMinVoicedFrames: 8,
    complexityPenaltyPerExtraDegree: 0.008
  },
  playback: {
    rawBend: {
      releaseMs: 30,
      maxGain: 0.5,
      gainPower: 0.75,
      gapFillFrames: 2,
      maxGravityPullSemitones: 0.8,
      scaleGravityBase: 0.08,
      scaleGravityBoost: 0.28
    }
  },
  midiTimeline: {
    defaultMin: 48,
    defaultMax: 72,
    boundsPadding: 3
  }
};

const state = {
  mediaRecorder: null,
  mediaStream: null,
  audioContext: null,
  recordedChunks: [],
  analysis: null,
  derived: null,
  playbackContext: null,
  playbackEndTimer: null,
  autotuneConfig: {
    keyRoot: APP_CONFIG.autotune.defaultRoot,
    modeId: APP_CONFIG.autotune.defaultModeId
  }
};

const els = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  playRawBendBtn: document.getElementById("playRawBendBtn"),
  playRawBtn: document.getElementById("playRawBtn"),
  playAutoBtn: document.getElementById("playAutoBtn"),
  playScaleBtn: document.getElementById("playScaleBtn"),
  gateMultiplier: document.getElementById("gateMultiplier"),
  gateMultiplierValue: document.getElementById("gateMultiplierValue"),
  minNoteMs: document.getElementById("minNoteMs"),
  minNoteMsValue: document.getElementById("minNoteMsValue"),
  bendSmoothing: document.getElementById("bendSmoothing"),
  bendSmoothingValue: document.getElementById("bendSmoothingValue"),
  noteDerivation: document.getElementById("noteDerivation"),
  scaleRoot: document.getElementById("scaleRoot"),
  scaleMode: document.getElementById("scaleMode"),
  statusText: document.getElementById("statusText"),
  durationValue: document.getElementById("durationValue"),
  noiseFloorValue: document.getElementById("noiseFloorValue"),
  thresholdValue: document.getElementById("thresholdValue"),
  noteCountValue: document.getElementById("noteCountValue"),
  scaleInfoValue: document.getElementById("scaleInfoValue"),
  waveCanvas: document.getElementById("waveCanvas"),
  specCanvas: document.getElementById("specCanvas"),
  midiCanvas: document.getElementById("midiCanvas"),
  notesBody: document.getElementById("notesBody")
};

bootstrap();

function bootstrap() {
  applyControlConfig();
  populateScaleControls();
  wireEvents();
  syncControlLabels();
  drawPlaceholder(els.waveCanvas, "Record audio to view waveform and RMS.");
  drawPlaceholder(els.specCanvas, "Stop recording to generate spectrogram and F0.");
  drawPlaceholder(els.midiCanvas, "Derived MIDI timeline appears after processing.");
}

function applyControlConfig() {
  applyRangeConfig(els.gateMultiplier, APP_CONFIG.controls.gateMultiplier);
  applyRangeConfig(els.minNoteMs, APP_CONFIG.controls.minNoteMs);
  applyRangeConfig(els.bendSmoothing, APP_CONFIG.controls.bendSmoothing);
  els.noteDerivation.value = APP_CONFIG.detection.rawPitchReducer;
}

function applyRangeConfig(input, config) {
  input.min = String(config.min);
  input.max = String(config.max);
  input.step = String(config.step);
  input.value = String(config.defaultValue);
}

function populateScaleControls() {
  for (let root = 0; root < NOTE_NAMES.length; root++) {
    const option = document.createElement("option");
    option.value = String(root);
    option.textContent = NOTE_NAMES[root];
    els.scaleRoot.appendChild(option);
  }

  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = "Auto Detect";
  els.scaleMode.appendChild(autoOption);
  for (const mode of SCALE_MODES) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.label;
    els.scaleMode.appendChild(option);
  }

  els.scaleRoot.value = String(state.autotuneConfig.keyRoot);
  els.scaleMode.value = state.autotuneConfig.modeId;
  syncScaleControlState();
}

function wireEvents() {
  els.startBtn.addEventListener("click", startRecording);
  els.stopBtn.addEventListener("click", stopRecording);
  els.playRawBendBtn.addEventListener("click", playRawBend);
  els.playRawBtn.addEventListener("click", () => playNotes("raw"));
  els.playAutoBtn.addEventListener("click", () => playNotes("auto"));
  els.playScaleBtn.addEventListener("click", playSelectedScale);

  els.gateMultiplier.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivation();
  });
  els.minNoteMs.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivation();
  });
  els.bendSmoothing.addEventListener("input", syncControlLabels);
  els.noteDerivation.addEventListener("change", rerunDerivation);
  els.scaleRoot.addEventListener("change", rerunDerivation);
  els.scaleMode.addEventListener("change", () => {
    syncScaleControlState();
    rerunDerivation();
  });
}

function syncControlLabels() {
  els.gateMultiplierValue.textContent = `${Number(els.gateMultiplier.value).toFixed(1)}x`;
  els.minNoteMsValue.textContent = String(Number(els.minNoteMs.value));
  els.bendSmoothingValue.textContent = `${Math.round(Number(els.bendSmoothing.value))}%`;
}

function syncScaleControlState() {
  els.scaleRoot.disabled = els.scaleMode.value === "auto";
}

async function startRecording() {
  try {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      return;
    }

    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    state.mediaRecorder = new MediaRecorder(state.mediaStream);
    state.recordedChunks = [];
    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };
    state.mediaRecorder.onstop = handleRecordingStopped;

    state.mediaRecorder.start();
    setStatus("Recording... hum or sing a phrase, then stop.");
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.playRawBtn.disabled = true;
    els.playRawBendBtn.disabled = true;
    els.playAutoBtn.disabled = true;
    els.playScaleBtn.disabled = true;
  } catch (error) {
    setStatus(`Microphone error: ${error.message}`);
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state !== "recording") {
    return;
  }
  state.mediaRecorder.stop();
  els.stopBtn.disabled = true;
  setStatus("Processing sample...");
}

async function handleRecordingStopped() {
  try {
    if (!state.audioContext || state.audioContext.state === "closed") {
      state.audioContext = createAudioContext();
    }

    const blob = new Blob(state.recordedChunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
    const monoSamples = toMono(decoded);
    state.analysis = analyzeAudio(monoSamples, decoded.sampleRate);

    rerunDerivation();
    renderVisuals();
    const activeScale = state.derived && state.derived.resolvedScale
      ? formatScaleName(state.derived.resolvedScale.keyRoot, state.derived.resolvedScale.modeId)
      : "n/a";
    setStatus(`Processing complete. Pitch cap is ${APP_CONFIG.pitch.maxLabel}. Active scale: ${activeScale}.`);
  } catch (error) {
    setStatus(`Decode/analysis error: ${error.message}`);
  } finally {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
    }
    els.startBtn.disabled = false;
    els.playScaleBtn.disabled = false;
  }
}

function rerunDerivation() {
  if (!state.analysis) {
    return;
  }

  state.autotuneConfig = readAutotuneConfigFromUi();
  const gateMultiplier = Number(els.gateMultiplier.value);
  const minNoteMs = Number(els.minNoteMs.value);
  const threshold = state.analysis.noiseFloor * gateMultiplier + APP_CONFIG.detection.gateOffset;
  const rawNotes = deriveRawNotes(state.analysis, threshold, minNoteMs, els.noteDerivation.value);
  const resolvedScale = resolveAutotuneScale(state.analysis, threshold, state.autotuneConfig);
  const autoNotes = deriveAutotunedNotes(rawNotes, resolvedScale.keyRoot, resolvedScale.modeId);

  state.derived = {
    threshold,
    rawNotes,
    autoNotes,
    resolvedScale
  };

  updateStats();
  updateScaleInfo(resolvedScale);
  renderTable();
  renderWaveform();
  renderMidiTimeline();

  els.playRawBtn.disabled = rawNotes.length === 0;
  els.playRawBendBtn.disabled = !hasBendPlayableData();
  els.playAutoBtn.disabled = autoNotes.length === 0;
}

function readAutotuneConfigFromUi() {
  const parsedRoot = Number(els.scaleRoot.value);
  const keyRoot = Number.isFinite(parsedRoot)
    ? clamp(parsedRoot, 0, NOTE_NAMES.length - 1)
    : APP_CONFIG.autotune.defaultRoot;
  const modeId = els.scaleMode.value || APP_CONFIG.autotune.defaultModeId;
  return { keyRoot, modeId };
}

function resolveAutotuneScale(analysis, threshold, autotuneConfig) {
  if (autotuneConfig.modeId !== "auto") {
    return {
      keyRoot: autotuneConfig.keyRoot,
      modeId: autotuneConfig.modeId,
      source: "manual",
      confidence: 1
    };
  }
  return detectBestScaleFromFrames(analysis, threshold);
}

function detectBestScaleFromFrames(analysis, threshold) {
  const voicedFrames = [];
  for (let i = 0; i < analysis.frameTimes.length; i++) {
    const midiValue = analysis.midiFrames[i];
    if (analysis.rmsFrames[i] < threshold || !Number.isFinite(midiValue)) {
      continue;
    }
    voicedFrames.push({
      midi: midiValue,
      weight: 1 + analysis.rmsFrames[i] * 8
    });
  }

  if (voicedFrames.length < APP_CONFIG.autotune.autoMinVoicedFrames) {
    return {
      keyRoot: APP_CONFIG.autotune.defaultRoot,
      modeId: "major",
      source: "auto",
      confidence: 0
    };
  }

  let best = {
    keyRoot: APP_CONFIG.autotune.defaultRoot,
    modeId: "major",
    score: Number.POSITIVE_INFINITY
  };

  for (let root = 0; root < NOTE_NAMES.length; root++) {
    for (const modeId of AUTO_DETECT_MODE_IDS) {
      const mode = SCALE_BY_ID[modeId];
      const fitError = scaleFitError(voicedFrames, root, mode.intervals);
      const complexityPenalty = Math.max(0, mode.intervals.length - 7) * APP_CONFIG.autotune.complexityPenaltyPerExtraDegree;
      const score = fitError + complexityPenalty;
      if (score < best.score) {
        best = { keyRoot: root, modeId, score };
      }
    }
  }

  const confidence = 1 / (1 + best.score);
  return {
    keyRoot: best.keyRoot,
    modeId: best.modeId,
    source: "auto",
    confidence
  };
}

function scaleFitError(voicedFrames, keyRoot, intervals) {
  let weightedError = 0;
  let totalWeight = 0;
  for (const frame of voicedFrames) {
    const distance = semitoneDistanceToScale(frame.midi, keyRoot, intervals);
    weightedError += distance * distance * frame.weight;
    totalWeight += frame.weight;
  }
  return weightedError / Math.max(1e-9, totalWeight);
}

function semitoneDistanceToScale(midiValue, keyRoot, intervals) {
  let best = Number.POSITIVE_INFINITY;
  const centerOctave = Math.floor(midiValue / 12);
  for (let oct = centerOctave - 2; oct <= centerOctave + 2; oct++) {
    for (const interval of intervals) {
      const candidate = oct * 12 + ((keyRoot + interval) % 12);
      const diff = Math.abs(candidate - midiValue);
      if (diff < best) {
        best = diff;
      }
    }
  }
  return best;
}

function analyzeAudio(samples, sampleRate) {
  const frameSize = APP_CONFIG.analysis.pitchFrameSize;
  const hopSize = APP_CONFIG.analysis.pitchHopSize;
  const win = hannWindow(frameSize);

  const frameTimes = [];
  const rmsFrames = [];
  const f0Hz = [];
  const midiFrames = [];

  for (let start = 0; start + frameSize < samples.length; start += hopSize) {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = samples[start + i] * win[i];
    }
    const rms = computeRms(frame);
    const f0 = estimateF0(frame, sampleRate);

    frameTimes.push((start + frameSize * 0.5) / sampleRate);
    rmsFrames.push(rms);
    f0Hz.push(f0);
    midiFrames.push(f0 > 0 ? clampPitchMidi(hzToMidi(f0)) : null);
  }

  return {
    samples,
    sampleRate,
    duration: samples.length / sampleRate,
    frameSize,
    hopSize,
    frameTimes,
    rmsFrames,
    f0Hz,
    midiFrames,
    noiseFloor: detectNoiseFloor(rmsFrames),
    spectrogram: computeSpectrogram(samples, sampleRate)
  };
}

function detectNoiseFloor(rmsFrames) {
  if (!rmsFrames.length) {
    return 0;
  }
  const sorted = [...rmsFrames].sort((a, b) => a - b);
  const quietCount = Math.max(
    APP_CONFIG.detection.noiseQuietMinFrames,
    Math.floor(sorted.length * APP_CONFIG.detection.noiseQuietFraction)
  );
  let sum = 0;
  for (let i = 0; i < quietCount; i++) {
    sum += sorted[i];
  }
  return sum / quietCount;
}

function deriveRawNotes(analysis, threshold, minNoteMs, pitchReducer) {
  const notes = [];
  const endHoldFrames = APP_CONFIG.detection.endHoldFrames;
  let active = false;
  let startIndex = -1;
  let endHold = 0;
  let pitchPool = [];

  const flushNote = (endIndex) => {
    if (startIndex < 0 || endIndex < startIndex) {
      return;
    }
    const framePad = analysis.hopSize / analysis.sampleRate;
    const start = Math.max(0, analysis.frameTimes[startIndex] - framePad);
    const end = Math.min(analysis.duration, analysis.frameTimes[endIndex] + framePad);
    const durationMs = (end - start) * 1000;
    if (durationMs < minNoteMs) {
      return;
    }
    const rawMidi = pitchPool.length
      ? reducePitchPool(pitchPool, pitchReducer || APP_CONFIG.detection.rawPitchReducer)
      : recoverSegmentMidi(analysis, startIndex, endIndex);
    if (!Number.isFinite(rawMidi)) {
      return;
    }
    const clampedRawMidi = clampPitchMidi(rawMidi);
    notes.push({
      start,
      end,
      rawMidi: clampedRawMidi,
      midi: clampedRawMidi,
      frameStart: startIndex,
      frameEnd: endIndex
    });
  };

  for (let i = 0; i < analysis.frameTimes.length; i++) {
    const gateOpen = analysis.rmsFrames[i] >= threshold;
    if (gateOpen) {
      if (!active) {
        active = true;
        startIndex = i;
        endHold = 0;
        pitchPool = [];
      }
      if (Number.isFinite(analysis.midiFrames[i])) {
        pitchPool.push(analysis.midiFrames[i]);
      }
      endHold = 0;
    } else if (active) {
      endHold += 1;
      if (endHold > endHoldFrames) {
        const endIndex = i - endHold;
        flushNote(endIndex);
        active = false;
        startIndex = -1;
        endHold = 0;
        pitchPool = [];
      }
    }
  }

  if (active) {
    flushNote(analysis.frameTimes.length - 1);
  }
  return notes;
}

function recoverSegmentMidi(analysis, frameStart, frameEnd) {
  const nearby = [];
  const searchRadius = APP_CONFIG.detection.pitchRecoverySearchRadius;
  for (let i = frameStart; i <= frameEnd; i++) {
    if (Number.isFinite(analysis.midiFrames[i])) {
      nearby.push(analysis.midiFrames[i]);
    }
  }
  if (nearby.length) {
    return median(nearby);
  }

  for (let offset = 1; offset <= searchRadius; offset++) {
    const left = frameStart - offset;
    const right = frameEnd + offset;
    if (left >= 0 && Number.isFinite(analysis.midiFrames[left])) {
      nearby.push(analysis.midiFrames[left]);
    }
    if (right < analysis.midiFrames.length && Number.isFinite(analysis.midiFrames[right])) {
      nearby.push(analysis.midiFrames[right]);
    }
    if (nearby.length >= 2) {
      return median(nearby);
    }
  }
  return null;
}

function deriveAutotunedNotes(rawNotes, keyRoot, modeId) {
  return rawNotes.map((raw) => ({
    ...raw,
    midi: quantizeMidi(raw.rawMidi, keyRoot, modeId)
  }));
}

function quantizeMidi(midiValue, keyRoot, modeId) {
  if (modeId === "chromatic") {
    return clampPitchMidi(Math.round(midiValue));
  }
  const mode = SCALE_BY_ID[modeId] || SCALE_BY_ID.major;
  const intervals = mode.intervals;
  let best = 60;
  let bestDiff = Number.POSITIVE_INFINITY;
  const centerOctave = Math.floor(midiValue / 12);

  for (let oct = centerOctave - 2; oct <= centerOctave + 2; oct++) {
    for (const interval of intervals) {
      const candidate = oct * 12 + ((keyRoot + interval) % 12);
      const diff = Math.abs(candidate - midiValue);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
  }
  return clampPitchMidi(best);
}

function renderVisuals() {
  renderWaveform();
  renderSpectrogram();
  renderMidiTimeline();
}

function renderWaveform() {
  if (!state.analysis) {
    drawPlaceholder(els.waveCanvas, "No waveform available.");
    return;
  }

  const canvas = els.waveCanvas;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, width, height);

  const notes = getDisplayNotes();
  for (const note of notes) {
    const x0 = (note.start / state.analysis.duration) * width;
    const x1 = (note.end / state.analysis.duration) * width;
    ctx.fillStyle = "rgba(54, 190, 157, 0.16)";
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
  }

  const samples = state.analysis.samples;
  const step = Math.max(1, Math.floor(samples.length / width));
  ctx.strokeStyle = "rgba(92, 195, 255, 0.95)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x++) {
    const start = x * step;
    const end = Math.min(samples.length, start + step);
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      const sample = samples[i];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    const yMin = (1 - ((min + 1) * 0.5)) * height;
    const yMax = (1 - ((max + 1) * 0.5)) * height;
    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);
  }
  ctx.stroke();

  const maxRms = Math.max(...state.analysis.rmsFrames, state.derived ? state.derived.threshold * 1.3 : 0.02, 0.02);
  ctx.strokeStyle = "rgba(123, 255, 176, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < state.analysis.frameTimes.length; i++) {
    const x = (state.analysis.frameTimes[i] / state.analysis.duration) * width;
    const y = height - (state.analysis.rmsFrames[i] / maxRms) * (height * 0.96);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (state.derived) {
    const thresholdY = height - (state.derived.threshold / maxRms) * (height * 0.96);
    ctx.strokeStyle = "rgba(92, 195, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(0, thresholdY);
    ctx.lineTo(width, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function renderSpectrogram() {
  if (!state.analysis) {
    drawPlaceholder(els.specCanvas, "No spectrogram available.");
    return;
  }

  const canvas = els.specCanvas;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const spec = state.analysis.spectrogram;
  const image = ctx.createImageData(width, height);

  for (let x = 0; x < width; x++) {
    const frameIndex = Math.floor((x / (width - 1)) * (spec.frames.length - 1));
    const frame = spec.frames[frameIndex];
    for (let y = 0; y < height; y++) {
      const binIndex = Math.floor(((height - 1 - y) / (height - 1)) * (frame.length - 1));
      const db = frame[binIndex];
      const norm = clamp((db - spec.minDb) / (spec.maxDb - spec.minDb), 0, 1);
      const color = colorMap(norm);
      const idx = (y * width + x) * 4;
      image.data[idx] = color[0];
      image.data[idx + 1] = color[1];
      image.data[idx + 2] = color[2];
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  ctx.strokeStyle = "rgba(123, 255, 176, 0.96)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let hasStarted = false;
  for (let i = 0; i < state.analysis.frameTimes.length; i++) {
    const f0 = state.analysis.f0Hz[i];
    if (!f0) {
      hasStarted = false;
      continue;
    }
    const x = (state.analysis.frameTimes[i] / state.analysis.duration) * width;
    const y = height - (Math.min(spec.maxFreq, f0) / spec.maxFreq) * height;
    if (!hasStarted) {
      ctx.moveTo(x, y);
      hasStarted = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function renderMidiTimeline() {
  if (!state.analysis) {
    drawPlaceholder(els.midiCanvas, "No MIDI data available.");
    return;
  }

  const canvas = els.midiCanvas;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, width, height);

  const bounds = getMidiBounds(state.analysis, state.derived);
  const minMidi = bounds.min;
  const maxMidi = bounds.max;
  const totalRange = Math.max(1, maxMidi - minMidi);
  const leftPad = 44;
  const rightPad = 8;
  const innerWidth = width - leftPad - rightPad;

  ctx.font = "12px Space Grotesk";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const y = midiToY(midi, minMidi, totalRange, height);
    const isOctave = midi % 12 === 0;
    ctx.strokeStyle = isOctave ? "rgba(92, 195, 255, 0.28)" : "rgba(92, 195, 255, 0.12)";
    ctx.lineWidth = isOctave ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(leftPad, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    if (isOctave) {
      ctx.fillStyle = "rgba(168, 218, 239, 0.92)";
      ctx.fillText(midiToNoteName(midi), leftPad - 6, y);
    }
  }

  if (state.derived) {
    drawNoteBars(ctx, state.derived.rawNotes, {
      color: "rgba(92, 195, 255, 0.3)",
      stroke: "rgba(92, 195, 255, 0.8)",
      leftPad,
      innerWidth,
      minMidi,
      totalRange,
      height,
      pitchAccessor: (note) => note.rawMidi
    });

    drawNoteBars(ctx, state.derived.autoNotes, {
      color: "rgba(54, 190, 157, 0.36)",
      stroke: "rgba(123, 255, 176, 0.95)",
      leftPad,
      innerWidth,
      minMidi,
      totalRange,
      height,
      pitchAccessor: (note) => note.midi
    });
  }

  const midiFrames = state.analysis.midiFrames;
  ctx.fillStyle = "rgba(92, 195, 255, 0.9)";
  for (let i = 0; i < midiFrames.length; i++) {
    if (!Number.isFinite(midiFrames[i])) {
      continue;
    }
    const x = leftPad + (state.analysis.frameTimes[i] / state.analysis.duration) * innerWidth;
    const y = midiToY(midiFrames[i], minMidi, totalRange, height);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  ctx.fillStyle = "rgba(209, 242, 234, 0.95)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("raw notes", leftPad + 10, 8);
  ctx.fillStyle = "rgba(139, 255, 194, 0.95)";
  ctx.fillText("autotuned notes", leftPad + 84, 8);
  ctx.fillStyle = "rgba(120, 212, 255, 0.95)";
  ctx.fillText("frame-level MIDI", leftPad + 206, 8);
}

function drawNoteBars(ctx, notes, options) {
  const {
    color,
    stroke,
    leftPad,
    innerWidth,
    minMidi,
    totalRange,
    height,
    pitchAccessor
  } = options;

  for (const note of notes) {
    const x0 = leftPad + (note.start / state.analysis.duration) * innerWidth;
    const x1 = leftPad + (note.end / state.analysis.duration) * innerWidth;
    const midiValue = pitchAccessor(note);
    if (!Number.isFinite(midiValue)) {
      continue;
    }
    const y = midiToY(midiValue, minMidi, totalRange, height);
    const barHeight = Math.max(6, height / (totalRange + 2));
    ctx.fillStyle = color;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y - barHeight * 0.5, Math.max(2, x1 - x0), barHeight);
    ctx.strokeRect(x0, y - barHeight * 0.5, Math.max(2, x1 - x0), barHeight);
  }
}

function midiToY(midi, minMidi, totalRange, height) {
  const topPad = 22;
  const bottomPad = 8;
  const usable = height - topPad - bottomPad;
  return topPad + (1 - (midi - minMidi) / totalRange) * usable;
}

function getMidiBounds(analysis, derived) {
  let minMidi = Number.POSITIVE_INFINITY;
  let maxMidi = Number.NEGATIVE_INFINITY;

  for (const midi of analysis.midiFrames) {
    if (!Number.isFinite(midi)) {
      continue;
    }
    if (midi < minMidi) minMidi = midi;
    if (midi > maxMidi) maxMidi = midi;
  }

  if (derived) {
    const allNotes = [...derived.rawNotes, ...derived.autoNotes];
    for (const note of allNotes) {
      if (Number.isFinite(note.rawMidi)) {
        if (note.rawMidi < minMidi) minMidi = note.rawMidi;
        if (note.rawMidi > maxMidi) maxMidi = note.rawMidi;
      }
      if (Number.isFinite(note.midi)) {
        if (note.midi < minMidi) minMidi = note.midi;
        if (note.midi > maxMidi) maxMidi = note.midi;
      }
    }
  }

  if (!Number.isFinite(minMidi) || !Number.isFinite(maxMidi)) {
    return { min: APP_CONFIG.midiTimeline.defaultMin, max: APP_CONFIG.midiTimeline.defaultMax };
  }
  const pad = APP_CONFIG.midiTimeline.boundsPadding;
  return {
    min: clampPitchMidi(Math.floor(minMidi) - pad),
    max: clampPitchMidi(Math.ceil(maxMidi) + pad)
  };
}

function computeSpectrogram(samples, sampleRate) {
  const frameSize = APP_CONFIG.analysis.spectrogramFrameSize;
  const hopSize = APP_CONFIG.analysis.spectrogramHopSize;
  const maxFreq = APP_CONFIG.analysis.spectrogramMaxFreq;
  const maxBin = Math.min((frameSize >> 1) - 1, Math.floor((maxFreq * frameSize) / sampleRate));
  const win = hannWindow(frameSize);
  const frames = [];
  let minDb = Number.POSITIVE_INFINITY;
  let maxDb = Number.NEGATIVE_INFINITY;

  for (let start = 0; start + frameSize < samples.length; start += hopSize) {
    const frame = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      frame[i] = samples[start + i] * win[i];
    }
    const mags = fftMagnitudes(frame);
    const dbFrame = new Float32Array(maxBin + 1);
    for (let b = 0; b <= maxBin; b++) {
      const db = 20 * Math.log10(mags[b] + 1e-9);
      dbFrame[b] = db;
      if (db < minDb) minDb = db;
      if (db > maxDb) maxDb = db;
    }
    frames.push(dbFrame);
  }

  if (!frames.length) {
    frames.push(new Float32Array(maxBin + 1));
    minDb = -100;
    maxDb = -20;
  }

  return {
    frames,
    minDb: Number.isFinite(minDb) ? minDb : -100,
    maxDb: Number.isFinite(maxDb) ? maxDb : -20,
    maxFreq
  };
}

function fftMagnitudes(input) {
  const n = input.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = input[i];
  }

  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tmpRe = re[i];
      re[i] = re[j];
      re[j] = tmpRe;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (Math.PI * 2) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = -k * step;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const evenIndex = i + k;
        const oddIndex = evenIndex + half;
        const tr = re[oddIndex] * cos - im[oddIndex] * sin;
        const ti = re[oddIndex] * sin + im[oddIndex] * cos;
        re[oddIndex] = re[evenIndex] - tr;
        im[oddIndex] = im[evenIndex] - ti;
        re[evenIndex] += tr;
        im[evenIndex] += ti;
      }
    }
  }

  const mags = new Float32Array(n >> 1);
  for (let i = 0; i < mags.length; i++) {
    mags[i] = Math.hypot(re[i], im[i]);
  }
  return mags;
}

function estimateF0(frame, sampleRate) {
  const n = frame.length;
  let meanValue = 0;
  for (let i = 0; i < n; i++) {
    meanValue += frame[i];
  }
  meanValue /= n;

  const centered = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const v = frame[i] - meanValue;
    centered[i] = v;
    energy += v * v;
  }

  if (energy / n < APP_CONFIG.analysis.minFrameEnergy) {
    return 0;
  }

  const minFreq = APP_CONFIG.pitch.minHz;
  const maxFreq = APP_CONFIG.pitch.maxHz;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.min(n - 2, Math.floor(sampleRate / minFreq));

  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const corr = normalizedAutocorrelation(centered, lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorr < APP_CONFIG.analysis.minF0Correlation) {
    return 0;
  }

  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = normalizedAutocorrelation(centered, bestLag - 1);
    const right = normalizedAutocorrelation(centered, bestLag + 1);
    const denominator = left - (2 * bestCorr) + right;
    if (Math.abs(denominator) > 1e-7) {
      const shift = 0.5 * (left - right) / denominator;
      if (Math.abs(shift) < 1) {
        refinedLag += shift;
      }
    }
  }

  const f0 = sampleRate / refinedLag;
  if (f0 < minFreq || f0 > maxFreq) {
    return 0;
  }
  return f0;
}

function normalizedAutocorrelation(signal, lag) {
  let cross = 0;
  let e1 = 0;
  let e2 = 0;
  for (let i = 0; i < signal.length - lag; i++) {
    const x = signal[i];
    const y = signal[i + lag];
    cross += x * y;
    e1 += x * x;
    e2 += y * y;
  }
  return cross / (Math.sqrt(e1 * e2) + 1e-12);
}

function updateStats() {
  const duration = state.analysis.duration;
  els.durationValue.textContent = `${duration.toFixed(2)} s`;
  els.noiseFloorValue.textContent = state.analysis.noiseFloor.toFixed(4);
  els.thresholdValue.textContent = state.derived.threshold.toFixed(4);
  els.noteCountValue.textContent = String(getDisplayNotes().length);
}

function updateScaleInfo(resolvedScale) {
  if (!resolvedScale) {
    els.scaleInfoValue.textContent = "-";
    return;
  }
  const label = formatScaleName(resolvedScale.keyRoot, resolvedScale.modeId);
  els.scaleInfoValue.textContent = resolvedScale.source === "auto" ? `Auto: ${label}` : label;
}

function formatScaleName(keyRoot, modeId) {
  const mode = SCALE_BY_ID[modeId] || SCALE_BY_ID.major;
  return `${NOTE_NAMES[keyRoot]} ${mode.label}`;
}

function renderTable() {
  const notes = getDisplayNotes();
  const rows = notes.map((note, index) => {
    const rawName = `${note.rawMidi.toFixed(2)} (${midiToNoteName(note.rawMidi)})`;
    const tunedText = Number.isFinite(note.midi) ? `${note.midi.toFixed(2)} (${midiToNoteName(note.midi)})` : "-";
    return `<tr>
      <td>${index + 1}</td>
      <td>${note.start.toFixed(3)}</td>
      <td>${note.end.toFixed(3)}</td>
      <td>${Math.round((note.end - note.start) * 1000)}</td>
      <td>${rawName}</td>
      <td>${tunedText}</td>
    </tr>`;
  }).join("");

  els.notesBody.innerHTML = rows || `<tr><td colspan="6">No notes detected with current gate/settings.</td></tr>`;
}

function getDisplayNotes() {
  return state.derived ? state.derived.autoNotes : [];
}

function hasBendPlayableData() {
  if (!state.analysis || !state.derived) {
    return false;
  }
  for (let i = 0; i < state.analysis.frameTimes.length; i++) {
    if (state.analysis.rmsFrames[i] >= state.derived.threshold && Number.isFinite(state.analysis.midiFrames[i])) {
      return true;
    }
  }
  return false;
}

function playNotes(mode) {
  if (!state.derived) {
    return;
  }
  const notes = mode === "raw" ? state.derived.rawNotes : state.derived.autoNotes;
  if (!notes.length) {
    setStatus("No notes available for playback.");
    return;
  }

  stopPlayback();
  const ctx = createAudioContext();
  state.playbackContext = ctx;
  const master = createPlaybackChain(ctx);

  const startAt = ctx.currentTime + 0.05;
  let maxEnd = 0;
  for (const note of notes) {
    const start = startAt + note.start;
    const end = startAt + note.end;
    if (end > maxEnd) maxEnd = end;

    const midiValue = mode === "raw" ? note.rawMidi : note.midi;
    triggerSynthVoice(ctx, midiToHz(midiValue), start, end, master, mode);
  }

  const totalMs = Math.max(150, (maxEnd - ctx.currentTime) * 1000);
  state.playbackEndTimer = setTimeout(() => {
    stopPlayback();
    setStatus("Playback complete.");
  }, totalMs + 100);

  setStatus(mode === "raw" ? "Playing raw vocal pitch..." : "Playing autotuned note sequence...");
}

function playRawBend() {
  if (!state.analysis || !state.derived) {
    return;
  }
  const smoothingAmount = clamp((Number(els.bendSmoothing.value) || 0) / 100, 0, 1);
  const scaleForGravity = getScaleForRawBendGravity();
  const segments = buildRawBendSegments(state.analysis, state.derived.threshold, {
    smoothingAmount,
    scaleForGravity
  });
  if (!segments.length) {
    setStatus("No bend-capable raw frames available.");
    return;
  }

  stopPlayback();
  const ctx = createAudioContext();
  state.playbackContext = ctx;
  const master = createPlaybackChain(ctx);

  const startAt = ctx.currentTime + 0.05;
  let maxEnd = 0;
  for (const segment of segments) {
    triggerBendVoice(ctx, segment, startAt, master);
    maxEnd = Math.max(maxEnd, startAt + segment.endTime);
  }

  const totalMs = Math.max(200, (maxEnd - ctx.currentTime) * 1000);
  state.playbackEndTimer = setTimeout(() => {
    stopPlayback();
    setStatus("Playback complete.");
  }, totalMs + 120);

  const gravityLabel = scaleForGravity ? formatScaleName(scaleForGravity.keyRoot, scaleForGravity.modeId) : "off";
  setStatus(`Playing raw pitch + bend (${Math.round(smoothingAmount * 100)}% smooth, gravity ${gravityLabel})...`);
}

function getScaleForRawBendGravity() {
  if (state.derived && state.derived.resolvedScale) {
    return {
      keyRoot: state.derived.resolvedScale.keyRoot,
      modeId: state.derived.resolvedScale.modeId
    };
  }
  return resolveScaleForPreview();
}

function playSelectedScale() {
  const scale = resolveScaleForPreview();
  const notes = buildScaleMidiSequence(scale.keyRoot, scale.modeId, 60);
  if (!notes.length) {
    setStatus("Unable to build a scale preview.");
    return;
  }

  stopPlayback();
  const ctx = createAudioContext();
  state.playbackContext = ctx;
  const master = createPlaybackChain(ctx);

  const startAt = ctx.currentTime + 0.03;
  const stepSeconds = 0.22;
  const noteSeconds = 0.18;
  let maxEnd = 0;

  for (let i = 0; i < notes.length; i++) {
    const start = startAt + i * stepSeconds;
    const end = start + noteSeconds;
    triggerSynthVoice(ctx, midiToHz(notes[i]), start, end, master, "auto");
    maxEnd = Math.max(maxEnd, end);
  }

  const totalMs = Math.max(200, (maxEnd - ctx.currentTime) * 1000);
  state.playbackEndTimer = setTimeout(() => {
    stopPlayback();
    setStatus("Playback complete.");
  }, totalMs + 110);

  setStatus(`Playing scale: ${formatScaleName(scale.keyRoot, scale.modeId)}`);
}

function resolveScaleForPreview() {
  const selection = readAutotuneConfigFromUi();
  if (selection.modeId !== "auto") {
    return selection;
  }
  if (state.derived && state.derived.resolvedScale) {
    return {
      keyRoot: state.derived.resolvedScale.keyRoot,
      modeId: state.derived.resolvedScale.modeId
    };
  }
  return { keyRoot: APP_CONFIG.autotune.defaultRoot, modeId: "major" };
}

function buildScaleMidiSequence(keyRoot, modeId, referenceMidi) {
  const mode = SCALE_BY_ID[modeId] || SCALE_BY_ID.major;
  const intervals = mode.intervals;
  if (!intervals || !intervals.length) {
    return [];
  }

  const startRootMidi = closestRootMidiToReference(referenceMidi, keyRoot);
  const uniqueIntervals = [...new Set(intervals.map((step) => ((step % 12) + 12) % 12))].sort((a, b) => a - b);
  const sequence = [];

  for (const interval of uniqueIntervals) {
    const midi = startRootMidi + interval;
    sequence.push(clampPitchMidi(midi));
  }

  const octaveRoot = clampPitchMidi(startRootMidi + 12);
  sequence.push(octaveRoot);

  if (!sequence.length) {
    sequence.push(clampPitchMidi(startRootMidi));
  }
  return sequence;
}

function closestRootMidiToReference(referenceMidi, keyRoot) {
  let bestMidi = referenceMidi;
  let bestDistance = Number.POSITIVE_INFINITY;
  const centerOctave = Math.floor(referenceMidi / 12);
  for (let oct = centerOctave - 3; oct <= centerOctave + 3; oct++) {
    const midi = oct * 12 + (keyRoot % 12);
    const distance = Math.abs(midi - referenceMidi);
    if (distance < bestDistance || (distance === bestDistance && midi < bestMidi)) {
      bestDistance = distance;
      bestMidi = midi;
    }
  }
  return bestMidi;
}

function stopPlayback() {
  if (state.playbackEndTimer) {
    clearTimeout(state.playbackEndTimer);
    state.playbackEndTimer = null;
  }
  if (state.playbackContext && state.playbackContext.state !== "closed") {
    state.playbackContext.close().catch(() => {});
  }
  state.playbackContext = null;
}

function createPlaybackChain(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.95;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.22;
  master.connect(compressor).connect(ctx.destination);
  return master;
}

function triggerSynthVoice(ctx, freqHz, start, end, destination, mode) {
  const voiceFilter = ctx.createBiquadFilter();
  voiceFilter.type = "lowpass";
  voiceFilter.frequency.setValueAtTime(mode === "raw" ? 2400 : 2800, start);
  voiceFilter.Q.value = 0.7;

  const voiceGain = ctx.createGain();
  const peak = mode === "raw" ? 0.25 : 0.22;
  const releaseAt = Math.max(start + 0.06, end);
  voiceGain.gain.setValueAtTime(0.0001, start);
  voiceGain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  voiceGain.gain.exponentialRampToValueAtTime(0.001, releaseAt);

  const bright = ctx.createOscillator();
  bright.type = mode === "raw" ? "sawtooth" : "square";
  bright.frequency.setValueAtTime(freqHz, start);
  bright.detune.setValueAtTime(-3, start);

  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(freqHz * 0.5, start);

  const brightGain = ctx.createGain();
  brightGain.gain.value = 0.82;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.24;

  bright.connect(brightGain).connect(voiceFilter);
  body.connect(bodyGain).connect(voiceFilter);
  voiceFilter.connect(voiceGain).connect(destination);

  bright.start(start);
  body.start(start);
  bright.stop(end + 0.06);
  body.stop(end + 0.06);
}

function buildRawBendSegments(analysis, threshold, options) {
  const frameCount = analysis.frameTimes.length;
  const gateOpen = new Array(frameCount).fill(false);
  const midiTrack = new Array(frameCount).fill(null);

  for (let i = 0; i < frameCount; i++) {
    gateOpen[i] = analysis.rmsFrames[i] >= threshold;
    if (gateOpen[i] && Number.isFinite(analysis.midiFrames[i])) {
      midiTrack[i] = clampPitchMidi(analysis.midiFrames[i]);
    }
  }
  fillShortPitchGaps(midiTrack, gateOpen, APP_CONFIG.playback.rawBend.gapFillFrames);
  const smoothedMidiTrack = smoothMidiTrackWithGravity(
    midiTrack,
    gateOpen,
    options ? options.smoothingAmount : 0,
    options ? options.scaleForGravity : null
  );
  const hasSmoothedMidi = smoothedMidiTrack.map((value) => Number.isFinite(value));

  const voicedRms = [];
  for (let i = 0; i < frameCount; i++) {
    if (Number.isFinite(smoothedMidiTrack[i])) {
      voicedRms.push(analysis.rmsFrames[i]);
    }
  }
  const rmsReference = Math.max(1e-6, percentile(voicedRms, 0.95));
  const gainTrack = new Array(frameCount).fill(0);
  for (let i = 0; i < frameCount; i++) {
    if (!Number.isFinite(smoothedMidiTrack[i])) {
      continue;
    }
    const normalized = clamp(analysis.rmsFrames[i] / rmsReference, 0, 1);
    gainTrack[i] = Math.pow(normalized, APP_CONFIG.playback.rawBend.gainPower) * APP_CONFIG.playback.rawBend.maxGain;
  }
  const smoothedGainTrack = smoothScalarTrackBidirectional(
    gainTrack,
    hasSmoothedMidi,
    (options ? options.smoothingAmount : 0) * 0.7
  );

  const segments = [];
  let segmentStart = -1;
  const framePad = analysis.hopSize / analysis.sampleRate;
  for (let i = 0; i < frameCount; i++) {
    const voiced = Number.isFinite(smoothedMidiTrack[i]);
    if (voiced && segmentStart < 0) {
      segmentStart = i;
    } else if (!voiced && segmentStart >= 0) {
      pushBendSegment(segments, analysis, smoothedMidiTrack, smoothedGainTrack, segmentStart, i - 1, framePad);
      segmentStart = -1;
    }
  }
  if (segmentStart >= 0) {
    pushBendSegment(segments, analysis, smoothedMidiTrack, smoothedGainTrack, segmentStart, frameCount - 1, framePad);
  }
  return segments;
}

function fillShortPitchGaps(midiTrack, gateOpen, maxGap) {
  let i = 0;
  while (i < midiTrack.length) {
    if (Number.isFinite(midiTrack[i])) {
      i += 1;
      continue;
    }
    const gapStart = i;
    while (i < midiTrack.length && !Number.isFinite(midiTrack[i])) {
      i += 1;
    }
    const gapEnd = i - 1;
    const gapLength = gapEnd - gapStart + 1;
    const left = gapStart - 1;
    const right = i;
    if (
      gapLength <= maxGap &&
      left >= 0 &&
      right < midiTrack.length &&
      Number.isFinite(midiTrack[left]) &&
      Number.isFinite(midiTrack[right]) &&
      gateOpen[left] &&
      gateOpen[right]
    ) {
      const leftMidi = midiTrack[left];
      const rightMidi = midiTrack[right];
      for (let k = 0; k < gapLength; k++) {
        const ratio = (k + 1) / (gapLength + 1);
        midiTrack[gapStart + k] = leftMidi + (rightMidi - leftMidi) * ratio;
      }
    }
  }
}

function smoothMidiTrackWithGravity(midiTrack, gateOpen, smoothingAmount, scaleForGravity) {
  const smoothed = smoothScalarTrackBidirectional(midiTrack, gateOpen, smoothingAmount);
  if (!scaleForGravity || smoothingAmount <= 0) {
    return smoothed;
  }

  const gravityStrength = APP_CONFIG.playback.rawBend.scaleGravityBase
    + smoothingAmount * APP_CONFIG.playback.rawBend.scaleGravityBoost;
  const maxPull = APP_CONFIG.playback.rawBend.maxGravityPullSemitones;
  const output = new Array(smoothed.length).fill(null);

  for (let i = 0; i < smoothed.length; i++) {
    const currentMidi = smoothed[i];
    if (!Number.isFinite(currentMidi)) {
      continue;
    }
    const targetMidi = quantizeMidi(currentMidi, scaleForGravity.keyRoot, scaleForGravity.modeId);
    const pull = clamp(targetMidi - currentMidi, -maxPull, maxPull);
    output[i] = clampPitchMidi(currentMidi + pull * gravityStrength);
  }
  return output;
}

function smoothScalarTrackBidirectional(track, validMask, smoothingAmount) {
  const amount = clamp(smoothingAmount || 0, 0, 1);
  if (amount <= 0) {
    return track.map((value, index) => (validMask[index] && Number.isFinite(value) ? value : null));
  }

  const alpha = clamp(1 - amount * 0.9, 0.08, 1);
  const forward = new Array(track.length).fill(null);
  let prev = null;
  for (let i = 0; i < track.length; i++) {
    if (!validMask[i] || !Number.isFinite(track[i])) {
      prev = null;
      continue;
    }
    const current = track[i];
    const next = prev === null ? current : prev + alpha * (current - prev);
    forward[i] = next;
    prev = next;
  }

  const backward = new Array(track.length).fill(null);
  prev = null;
  for (let i = track.length - 1; i >= 0; i--) {
    if (!validMask[i] || !Number.isFinite(track[i])) {
      prev = null;
      continue;
    }
    const current = track[i];
    const next = prev === null ? current : prev + alpha * (current - prev);
    backward[i] = next;
    prev = next;
  }

  const output = new Array(track.length).fill(null);
  for (let i = 0; i < track.length; i++) {
    if (!validMask[i]) {
      continue;
    }
    const left = forward[i];
    const right = backward[i];
    if (Number.isFinite(left) && Number.isFinite(right)) {
      output[i] = (left + right) * 0.5;
    } else if (Number.isFinite(left)) {
      output[i] = left;
    } else if (Number.isFinite(right)) {
      output[i] = right;
    }
  }
  return output;
}

function pushBendSegment(segments, analysis, midiTrack, gainTrack, startFrame, endFrame, framePad) {
  const startTime = Math.max(0, analysis.frameTimes[startFrame] - framePad);
  const endTime = Math.min(analysis.duration, analysis.frameTimes[endFrame] + framePad);
  const points = [];
  for (let i = startFrame; i <= endFrame; i++) {
    if (!Number.isFinite(midiTrack[i])) {
      continue;
    }
    points.push({
      time: analysis.frameTimes[i],
      midi: midiTrack[i],
      gain: Math.max(0.0001, gainTrack[i])
    });
  }
  if (!points.length) {
    return;
  }
  const first = points[0];
  const last = points[points.length - 1];
  points.unshift({ time: startTime, midi: first.midi, gain: first.gain });
  points.push({ time: endTime, midi: last.midi, gain: last.gain });
  segments.push({ startTime, endTime, points });
}

function triggerBendVoice(ctx, segment, startAt, destination) {
  const start = startAt + segment.startTime;
  const end = startAt + segment.endTime;
  const releaseMs = APP_CONFIG.playback.rawBend.releaseMs / 1000;

  const voiceFilter = ctx.createBiquadFilter();
  voiceFilter.type = "lowpass";
  voiceFilter.frequency.setValueAtTime(3400, start);
  voiceFilter.Q.value = 0.45;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);

  const bright = ctx.createOscillator();
  bright.type = "sawtooth";
  const body = ctx.createOscillator();
  body.type = "triangle";

  const brightGain = ctx.createGain();
  brightGain.gain.value = 0.8;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.26;

  const firstFreq = midiToHz(segment.points[0].midi);
  bright.frequency.setValueAtTime(firstFreq, start);
  body.frequency.setValueAtTime(firstFreq * 0.5, start);
  amp.gain.linearRampToValueAtTime(segment.points[0].gain, Math.min(start + 0.01, end));

  for (let i = 1; i < segment.points.length; i++) {
    const point = segment.points[i];
    const t = startAt + point.time;
    const hz = midiToHz(point.midi);
    bright.frequency.linearRampToValueAtTime(hz, t);
    body.frequency.linearRampToValueAtTime(hz * 0.5, t);
    amp.gain.linearRampToValueAtTime(Math.max(0.0001, point.gain), t);
  }

  amp.gain.linearRampToValueAtTime(0.0001, end + releaseMs);

  bright.connect(brightGain).connect(voiceFilter);
  body.connect(bodyGain).connect(voiceFilter);
  voiceFilter.connect(amp).connect(destination);

  bright.start(start);
  body.start(start);
  bright.stop(end + releaseMs + 0.03);
  body.stop(end + releaseMs + 0.03);
}

function toMono(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  if (channels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

function hannWindow(size) {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return out;
}

function computeRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const pitch = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pitch]}${octave}`;
}

function colorMap(t) {
  const eased = Math.pow(t, 0.82);
  const r = Math.round(8 + 95 * eased);
  const g = Math.round(22 + 205 * eased);
  const b = Math.round(40 + 185 * (1 - eased * 0.5));
  return [r, g, b];
}

function drawPlaceholder(canvas, text) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(180, 224, 211, 0.85)";
  ctx.font = "18px Space Grotesk";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function createAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  return new Ctx();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampPitchMidi(midi) {
  return clamp(midi, APP_CONFIG.pitch.minMidi, APP_CONFIG.pitch.maxMidi);
}

function reducePitchPool(values, reducerMode) {
  return reducerMode === "median" ? median(values) : mean(values);
}

function percentile(values, fraction) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
  return sorted[index];
}

function mean(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) * 0.5;
  }
  return sorted[mid];
}
