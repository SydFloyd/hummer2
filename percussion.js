const hummerCore = window.HummerCore;
if (!hummerCore) {
  throw new Error("HummerCore is missing. Ensure audio-core.js is loaded before percussion.js.");
}

const { toMono, trimAudioBufferTail, createAudioContext, clamp, percentile, median } = hummerCore;

const CLASS_DEFS = [
  { id: 0, label: "Kick", color: "#47d6a9" },
  { id: 1, label: "Snare", color: "#7dc9ff" },
  { id: 2, label: "Hi-Hat", color: "#f8d06f" }
];

const STORAGE_KEY = "hummer.percussion.prototypes.v1";

const APP_CONFIG = {
  analysis: {
    sampleRate: 16000,
    frameLength: 512,
    hopLength: 128,
    trimTailMs: 110,
    autoReanalyzeDelayMs: 180,
    waveformPreviewPoints: 1800,
    targetRms: 0.1,
    maxInputGain: 6,
    minInputGain: 0.6,
    featureWindowPre: 1,
    featureWindowPost: 2
  },
  controls: {
    onsetSensitivity: 1.4,
    noiseFloor: 0.11,
    minGapMs: 90,
    attackWeight: 0.68,
    highWeight: 0.32,
    rejectDistance: 2.15
  },
  prototype: {
    maxPerClass: 5,
    captureMs: 950
  }
};

const state = {
  mediaRecorder: null,
  mediaStream: null,
  recordStopTimer: null,
  audioContext: null,
  playbackContext: null,
  playbackStopTimer: null,
  recordMode: null,
  recordedChunks: [],
  lastSamples: null,
  lastSampleRate: 0,
  analysis: null,
  prototypes: { 0: [], 1: [], 2: [] },
  autoReanalyzeTimer: null,
  autoReanalyzeInFlight: false,
  autoReanalyzePending: false
};

const els = {
  startBtn: document.getElementById("startPercBtn"),
  stopBtn: document.getElementById("stopPercBtn"),
  playBtn: document.getElementById("playPercBtn"),
  clearBtn: document.getElementById("clearPercBtn"),
  resetControlsBtn: document.getElementById("percResetControlsBtn"),
  onsetSensitivity: document.getElementById("percOnsetSensitivity"),
  onsetSensitivityValue: document.getElementById("percOnsetSensitivityValue"),
  noiseFloor: document.getElementById("percNoiseFloor"),
  noiseFloorValue: document.getElementById("percNoiseFloorValue"),
  minGapMs: document.getElementById("percMinGapMs"),
  minGapMsValue: document.getElementById("percMinGapMsValue"),
  attackWeight: document.getElementById("percAttackWeight"),
  attackWeightValue: document.getElementById("percAttackWeightValue"),
  highWeight: document.getElementById("percHighWeight"),
  highWeightValue: document.getElementById("percHighWeightValue"),
  rejectDistance: document.getElementById("percRejectDistance"),
  rejectDistanceValue: document.getElementById("percRejectDistanceValue"),
  captureKickBtn: document.getElementById("captureKickBtn"),
  captureSnareBtn: document.getElementById("captureSnareBtn"),
  captureHatBtn: document.getElementById("captureHatBtn"),
  clearKickBtn: document.getElementById("clearKickBtn"),
  clearSnareBtn: document.getElementById("clearSnareBtn"),
  clearHatBtn: document.getElementById("clearHatBtn"),
  clearAllProtoBtn: document.getElementById("clearAllProtoBtn"),
  kickProtoCount: document.getElementById("kickProtoCount"),
  snareProtoCount: document.getElementById("snareProtoCount"),
  hatProtoCount: document.getElementById("hatProtoCount"),
  statusText: document.getElementById("percStatusText"),
  durationValue: document.getElementById("percDurationValue"),
  hitCountValue: document.getElementById("percHitCountValue"),
  labeledCountValue: document.getElementById("percLabeledCountValue"),
  protoPoolValue: document.getElementById("percProtoPoolValue"),
  timelineCanvas: document.getElementById("percTimelineCanvas"),
  debugCanvas: document.getElementById("percDebugCanvas"),
  classSummary: document.getElementById("percClassSummary"),
  debugSummary: document.getElementById("percDebugSummary")
};

bootstrap();

function bootstrap() {
  loadPrototypesFromStorage();
  wireEvents();
  syncControlLabels();
  renderPrototypeSummary();
  renderAnalysis(null);
  setStatus("Idle");
  syncButtons();
}

function wireEvents() {
  els.startBtn.addEventListener("click", startMainRecording);
  els.stopBtn.addEventListener("click", handleStopButtonPress);
  els.playBtn.addEventListener("click", playDetectedPattern);
  els.clearBtn.addEventListener("click", clearClipAndAnalysis);
  els.resetControlsBtn.addEventListener("click", resetPercussionControls);
  els.captureKickBtn.addEventListener("click", () => startPrototypeCapture(0));
  els.captureSnareBtn.addEventListener("click", () => startPrototypeCapture(1));
  els.captureHatBtn.addEventListener("click", () => startPrototypeCapture(2));
  els.clearKickBtn.addEventListener("click", () => clearClassPrototypes(0));
  els.clearSnareBtn.addEventListener("click", () => clearClassPrototypes(1));
  els.clearHatBtn.addEventListener("click", () => clearClassPrototypes(2));
  els.clearAllProtoBtn.addEventListener("click", clearAllPrototypes);

  const analysisControls = [
    els.onsetSensitivity,
    els.noiseFloor,
    els.minGapMs,
    els.attackWeight,
    els.highWeight,
    els.rejectDistance
  ];
  for (const control of analysisControls) {
    control.addEventListener("input", handleAnalysisControlInput);
    control.addEventListener("change", handleAnalysisControlInput);
  }
}

function handleAnalysisControlInput() {
  syncControlLabels();
  scheduleAutoReanalyze();
}

function syncControlLabels() {
  els.onsetSensitivityValue.textContent = Number(els.onsetSensitivity.value).toFixed(2);
  els.noiseFloorValue.textContent = Number(els.noiseFloor.value).toFixed(2);
  els.minGapMsValue.textContent = String(Math.round(Number(els.minGapMs.value)));
  els.attackWeightValue.textContent = Number(els.attackWeight.value).toFixed(2);
  els.highWeightValue.textContent = Number(els.highWeight.value).toFixed(2);
  els.rejectDistanceValue.textContent = Number(els.rejectDistance.value).toFixed(2);
}

function syncButtons() {
  const isRecording = Boolean(state.mediaRecorder && state.mediaRecorder.state === "recording");
  const isPlaying = Boolean(state.playbackContext);
  const hasEvents = Boolean(state.analysis && state.analysis.events && state.analysis.events.length > 0);
  const hasClip = Boolean(state.lastSamples && state.lastSamples.length > 0);
  const totalPrototypes = getPrototypePoolSize();

  els.startBtn.disabled = isRecording || isPlaying;
  els.stopBtn.disabled = !isRecording && !isPlaying;
  els.playBtn.disabled = isRecording || !hasEvents;
  els.clearBtn.disabled = !hasClip && !state.analysis;
  els.resetControlsBtn.disabled = isRecording;

  const disableCalibration = isRecording || isPlaying;
  els.captureKickBtn.disabled = disableCalibration;
  els.captureSnareBtn.disabled = disableCalibration;
  els.captureHatBtn.disabled = disableCalibration;
  els.clearKickBtn.disabled = disableCalibration || state.prototypes[0].length === 0;
  els.clearSnareBtn.disabled = disableCalibration || state.prototypes[1].length === 0;
  els.clearHatBtn.disabled = disableCalibration || state.prototypes[2].length === 0;
  els.clearAllProtoBtn.disabled = disableCalibration || totalPrototypes === 0;
}

function resetPercussionControls() {
  els.onsetSensitivity.value = String(APP_CONFIG.controls.onsetSensitivity);
  els.noiseFloor.value = String(APP_CONFIG.controls.noiseFloor);
  els.minGapMs.value = String(APP_CONFIG.controls.minGapMs);
  els.attackWeight.value = String(APP_CONFIG.controls.attackWeight);
  els.highWeight.value = String(APP_CONFIG.controls.highWeight);
  els.rejectDistance.value = String(APP_CONFIG.controls.rejectDistance);
  syncControlLabels();
  setStatus("Percussion controls reset to defaults.");
  scheduleAutoReanalyze();
}

function setStatus(text) {
  els.statusText.textContent = text;
}

async function startMainRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    return;
  }
  stopPlayback();
  state.recordMode = "clip";
  state.recordedChunks = [];
  const started = await beginRecordingSession();
  if (!started) {
    return;
  }
  setStatus("Recording percussion clip...");
  syncButtons();
}

async function startPrototypeCapture(classId) {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    return;
  }
  stopPlayback();
  state.recordMode = `prototype-${classId}`;
  state.recordedChunks = [];
  const started = await beginRecordingSession();
  if (!started) {
    return;
  }
  const classLabel = CLASS_DEFS[classId].label;
  setStatus(`Capturing ${classLabel} prototype...`);
  state.recordStopTimer = setTimeout(() => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      state.mediaRecorder.stop();
    }
  }, APP_CONFIG.prototype.captureMs);
  syncButtons();
}

async function beginRecordingSession() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    state.mediaStream = stream;
    state.mediaRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    });
    recorder.addEventListener("stop", handleRecorderStopped);
    recorder.start();
    return true;
  } catch (error) {
    setStatus(`Microphone error: ${error.message}`);
    syncButtons();
    return false;
  }
}

function handleStopButtonPress() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
    return;
  }
  if (state.playbackContext) {
    stopPlayback();
    setStatus("Playback stopped.");
  }
}

async function handleRecorderStopped() {
  clearRecordStopTimer();
  try {
    await ensureAudioContext();
    const blob = new Blob(state.recordedChunks, { type: state.mediaRecorder?.mimeType || "audio/webm" });
    const buffer = await blob.arrayBuffer();
    const decoded = await state.audioContext.decodeAudioData(buffer.slice(0));
    if (state.recordMode && state.recordMode.startsWith("prototype-")) {
      const classId = clamp(Number(state.recordMode.split("-")[1]) || 0, 0, 2);
      await handlePrototypeDecoded(decoded, classId);
    } else {
      await analyzeDecodedClip(decoded);
    }
  } catch (error) {
    setStatus(`Decode/analysis error: ${error.message}`);
  } finally {
    state.recordMode = null;
    state.recordedChunks = [];
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
      state.mediaStream = null;
    }
    state.mediaRecorder = null;
    syncButtons();
  }
}

function clearRecordStopTimer() {
  if (state.recordStopTimer) {
    clearTimeout(state.recordStopTimer);
    state.recordStopTimer = null;
  }
}

async function ensureAudioContext() {
  if (!state.audioContext || state.audioContext.state === "closed") {
    state.audioContext = createAudioContext();
  }
}

async function analyzeDecodedClip(decoded) {
  const trimmed = trimAudioBufferTail(decoded, APP_CONFIG.analysis.trimTailMs, state.audioContext);
  const mono = toMono(trimmed);
  state.lastSamples = mono;
  state.lastSampleRate = trimmed.sampleRate;
  await runAnalysis(mono, trimmed.sampleRate);
}

async function handlePrototypeDecoded(decoded, classId) {
  const mono = toMono(decoded);
  if (!mono.length) {
    setStatus("Prototype capture failed: empty audio.");
    return;
  }
  const settings = readAnalysisSettingsFromUi();
  const prototype = extractPrototypeVector(mono, decoded.sampleRate, settings);
  if (!prototype) {
    setStatus(`Prototype capture failed for ${CLASS_DEFS[classId].label}: no reliable onset found.`);
    return;
  }
  addPrototype(classId, prototype);
  renderPrototypeSummary();
  syncButtons();
  setStatus(
    `${CLASS_DEFS[classId].label} prototype captured (${state.prototypes[classId].length}/${APP_CONFIG.prototype.maxPerClass}).`
  );
  if (state.lastSamples && state.lastSamples.length && state.lastSampleRate > 0) {
    scheduleAutoReanalyze(true);
  }
}

async function runAnalysis(samples, sampleRate) {
  const settings = readAnalysisSettingsFromUi();
  state.analysis = analyzePercussionClip(samples, sampleRate, settings, state.prototypes);
  renderAnalysis(state.analysis);
  const total = state.analysis.events.length;
  const labeled = state.analysis.events.filter((event) => event.classId >= 0).length;
  const mode = state.analysis.classifierMode === "prototype" ? "prototype" : "heuristic";
  setStatus(`Analysis complete: ${total} hits (${labeled} labeled) using ${mode} classification.`);
  syncButtons();
}

function scheduleAutoReanalyze(immediate = false) {
  if (!state.lastSamples || !state.lastSamples.length || state.lastSampleRate <= 0) {
    return;
  }
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    return;
  }
  if (state.autoReanalyzeTimer) {
    clearTimeout(state.autoReanalyzeTimer);
    state.autoReanalyzeTimer = null;
  }
  const delay = immediate ? 0 : APP_CONFIG.analysis.autoReanalyzeDelayMs;
  state.autoReanalyzeTimer = setTimeout(() => {
    state.autoReanalyzeTimer = null;
    void rerunLastClipAnalysis();
  }, delay);
}

async function rerunLastClipAnalysis() {
  if (!state.lastSamples || !state.lastSamples.length || state.lastSampleRate <= 0) {
    return;
  }
  if (state.autoReanalyzeInFlight) {
    state.autoReanalyzePending = true;
    return;
  }
  state.autoReanalyzeInFlight = true;
  state.autoReanalyzePending = false;
  try {
    setStatus("Reanalyzing clip...");
    await runAnalysis(state.lastSamples, state.lastSampleRate);
  } catch (error) {
    setStatus(`Reanalysis failed: ${error.message}`);
  } finally {
    state.autoReanalyzeInFlight = false;
    if (state.autoReanalyzePending) {
      state.autoReanalyzePending = false;
      void rerunLastClipAnalysis();
    }
  }
}

function readAnalysisSettingsFromUi() {
  const attackWeight = clamp(Number(els.attackWeight.value) || 0.68, 0, 1);
  const highWeight = clamp(Number(els.highWeight.value) || 0.32, 0, 1);
  const sum = Math.max(1e-6, attackWeight + highWeight);
  return {
    onsetSensitivity: clamp(Number(els.onsetSensitivity.value) || APP_CONFIG.controls.onsetSensitivity, 0.6, 2.8),
    noiseFloor: clamp(Number(els.noiseFloor.value) || APP_CONFIG.controls.noiseFloor, 0, 0.7),
    minGapMs: clamp(Number(els.minGapMs.value) || APP_CONFIG.controls.minGapMs, 30, 260),
    attackWeight: attackWeight / sum,
    highWeight: highWeight / sum,
    rejectDistance: clamp(Number(els.rejectDistance.value) || APP_CONFIG.controls.rejectDistance, 0.4, 6),
    sampleRate: APP_CONFIG.analysis.sampleRate,
    frameLength: APP_CONFIG.analysis.frameLength,
    hopLength: APP_CONFIG.analysis.hopLength
  };
}

function analyzePercussionClip(samples, sampleRate, settings, prototypes) {
  const targetRate = settings.sampleRate;
  const resampled = sampleRate === targetRate ? new Float32Array(samples) : resampleLinear(samples, sampleRate, targetRate);
  const gainInfo = estimateInputGain(
    resampled,
    APP_CONFIG.analysis.targetRms,
    APP_CONFIG.analysis.minInputGain,
    APP_CONFIG.analysis.maxInputGain
  );
  const working = applyGain(resampled, gainInfo.gain);
  const waveformPreview = buildWaveformPreview(working, APP_CONFIG.analysis.waveformPreviewPoints);
  const frameData = buildFrameData(working, targetRate, settings.frameLength, settings.hopLength);
  const onsetData = detectOnsets(frameData, settings);
  const prototypeModel = buildPrototypeModel(prototypes);
  const classifierMode = prototypeModel ? "prototype" : "heuristic";
  const events = [];
  for (const frameIndex of onsetData.acceptedFrames) {
    const feature = eventFeaturesFromFrame(frameData, frameIndex);
    let classification;
    if (prototypeModel) {
      classification = classifyFromPrototypes(feature.vector, prototypeModel, settings.rejectDistance, feature);
    } else {
      classification = classifyHeuristically(feature);
    }
    events.push({
      timeSec: frameData.frameTimes[frameIndex] || 0,
      frameIndex,
      classId: classification.classId,
      label: classification.classId >= 0 ? CLASS_DEFS[classification.classId].label : "Unknown",
      confidence: classification.confidence,
      distance: classification.distance,
      margin: classification.margin,
      classThreshold: classification.classThreshold ?? 0,
      classPrior: classification.prior ?? 0,
      onset: onsetData.onsetEnvelope[frameIndex] || 0,
      strength: frameData.rmsNorm[frameIndex] || 0,
      lowRatio: feature.lowRatio,
      midRatio: feature.midRatio,
      highRatio: feature.highRatio,
      zcr: feature.zcrNorm
    });
  }

  const classCounts = { 0: 0, 1: 0, 2: 0, unknown: 0 };
  for (const event of events) {
    if (event.classId >= 0) {
      classCounts[event.classId] += 1;
    } else {
      classCounts.unknown += 1;
    }
  }

  return {
    sampleRate: targetRate,
    durationSec: working.length / targetRate,
    waveformPreview,
    frameData,
    onsetData,
    events,
    classCounts,
    classifierMode,
    classifierInfo: prototypeModel ? {
      classCounts: prototypeModel.classCounts,
      classThresholds: prototypeModel.classThresholds,
      inputGain: gainInfo.gain
    } : {
      classCounts: { 0: 0, 1: 0, 2: 0 },
      classThresholds: { 0: 0, 1: 0, 2: 0 },
      inputGain: gainInfo.gain
    }
  };
}

function extractPrototypeVector(samples, sampleRate, settings) {
  const targetRate = settings.sampleRate;
  const resampled = sampleRate === targetRate ? new Float32Array(samples) : resampleLinear(samples, sampleRate, targetRate);
  const gainInfo = estimateInputGain(
    resampled,
    APP_CONFIG.analysis.targetRms,
    APP_CONFIG.analysis.minInputGain,
    APP_CONFIG.analysis.maxInputGain
  );
  const working = applyGain(resampled, gainInfo.gain);
  const frameData = buildFrameData(working, targetRate, settings.frameLength, settings.hopLength);
  const prototypeSettings = {
    ...settings,
    onsetSensitivity: clamp(settings.onsetSensitivity + 0.25, 0.6, 2.8),
    noiseFloor: clamp(settings.noiseFloor * 0.8, 0, 0.7)
  };
  const onsetData = detectOnsets(frameData, prototypeSettings);

  let frameIndex = -1;
  if (onsetData.acceptedFrames.length) {
    frameIndex = onsetData.acceptedFrames.reduce((best, idx) => {
      if (best < 0) return idx;
      return onsetData.onsetEnvelope[idx] > onsetData.onsetEnvelope[best] ? idx : best;
    }, -1);
  }
  if (frameIndex < 0 && onsetData.candidateFrames.length) {
    frameIndex = onsetData.candidateFrames.reduce((best, idx) => {
      if (best < 0) return idx;
      return onsetData.onsetEnvelope[idx] > onsetData.onsetEnvelope[best] ? idx : best;
    }, -1);
  }
  if (frameIndex < 0 && frameData.rmsNorm.length) {
    frameIndex = argMax(frameData.rmsNorm);
  }
  if (frameIndex < 0) {
    return null;
  }

  const feature = eventFeaturesFromFrame(frameData, frameIndex);
  return {
    vector: feature.vector,
    capturedAt: Date.now(),
    frameIndex,
    strength: frameData.rmsNorm[frameIndex] || 0,
    inputGain: gainInfo.gain
  };
}

function buildFrameData(samples, sampleRate, frameLength, hopLength) {
  const low = onePoleLowPass(samples, 300, sampleRate);
  const high = onePoleHighPass(samples, 2000, sampleRate);
  const mid = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    mid[i] = samples[i] - low[i] - high[i];
  }

  const frameCount = Math.max(1, Math.floor(Math.max(0, samples.length - frameLength) / hopLength) + 1);
  const rms = new Float32Array(frameCount);
  const lowEnergy = new Float32Array(frameCount);
  const midEnergy = new Float32Array(frameCount);
  const highEnergy = new Float32Array(frameCount);
  const zcr = new Float32Array(frameCount);
  const crest = new Float32Array(frameCount);
  const frameTimes = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopLength;
    const end = Math.min(samples.length, start + frameLength);
    let e = 0;
    let eLow = 0;
    let eMid = 0;
    let eHigh = 0;
    let maxAbs = 0;
    let zeroCrossCount = 0;
    let prev = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      const lv = low[i];
      const mv = mid[i];
      const hv = high[i];
      e += v * v;
      eLow += lv * lv;
      eMid += mv * mv;
      eHigh += hv * hv;
      const abs = Math.abs(v);
      if (abs > maxAbs) {
        maxAbs = abs;
      }
      if (i > start) {
        if ((v >= 0 && prev < 0) || (v < 0 && prev >= 0)) {
          zeroCrossCount += 1;
        }
      }
      prev = v;
    }
    const denom = Math.max(1, end - start);
    rms[frame] = Math.sqrt(e / denom);
    lowEnergy[frame] = eLow / denom;
    midEnergy[frame] = eMid / denom;
    highEnergy[frame] = eHigh / denom;
    zcr[frame] = zeroCrossCount / Math.max(1, denom - 1);
    crest[frame] = rms[frame] > 1e-6 ? maxAbs / rms[frame] : 0;
    frameTimes[frame] = start / sampleRate;
  }

  const rmsNorm = robustNormalize01(rms);
  const highNorm = robustNormalize01(sqrtArray(highEnergy));
  const zcrNorm = robustNormalize01(zcr);
  const crestNorm = robustNormalize01(clipArray(crest, 0, 12));
  const lowRatio = new Float32Array(frameCount);
  const midRatio = new Float32Array(frameCount);
  const highRatio = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const total = Math.max(1e-8, lowEnergy[i] + midEnergy[i] + highEnergy[i]);
    lowRatio[i] = lowEnergy[i] / total;
    midRatio[i] = midEnergy[i] / total;
    highRatio[i] = highEnergy[i] / total;
  }

  return {
    sampleRate,
    frameLength,
    hopLength,
    frameTimes,
    rms,
    rmsNorm,
    lowEnergy,
    midEnergy,
    highEnergy,
    lowRatio,
    midRatio,
    highRatio,
    highNorm,
    zcr,
    zcrNorm,
    crestNorm
  };
}

function detectOnsets(frameData, settings) {
  const rmsNorm = frameData.rmsNorm;
  const highNorm = frameData.highNorm;
  const attack = positiveDiff(rmsNorm);
  const highAttack = positiveDiff(highNorm);
  const attackNorm = robustNormalize01(attack);
  const highAttackNorm = robustNormalize01(highAttack);

  const onsetEnvelopeRaw = new Float32Array(rmsNorm.length);
  for (let i = 0; i < onsetEnvelopeRaw.length; i++) {
    onsetEnvelopeRaw[i] = settings.attackWeight * attackNorm[i] + settings.highWeight * highAttackNorm[i];
  }
  const onsetEnvelope = movingAverage(onsetEnvelopeRaw, 3);
  const threshold = adaptiveThreshold(onsetEnvelope, settings.onsetSensitivity, settings.noiseFloor);
  const minGapFrames = Math.max(1, Math.round((settings.minGapMs / 1000) * (frameData.sampleRate / frameData.hopLength)));

  const candidateFrames = [];
  const acceptedFrames = [];
  const rejectedPeaks = [];

  for (let i = 1; i < onsetEnvelope.length - 1; i++) {
    const value = onsetEnvelope[i];
    if (value < onsetEnvelope[i - 1] || value < onsetEnvelope[i + 1]) {
      continue;
    }
    candidateFrames.push(i);
    const rmsValue = rmsNorm[i];
    const thresholdValue = threshold[i];
    if (rmsValue < settings.noiseFloor) {
      rejectedPeaks.push({
        frameIndex: i,
        timeSec: frameData.frameTimes[i],
        reason: "noise_floor",
        onset: value,
        threshold: thresholdValue,
        rmsNorm: rmsValue
      });
      continue;
    }
    if (value < thresholdValue) {
      rejectedPeaks.push({
        frameIndex: i,
        timeSec: frameData.frameTimes[i],
        reason: "below_threshold",
        onset: value,
        threshold: thresholdValue,
        rmsNorm: rmsValue
      });
      continue;
    }
    if (!acceptedFrames.length) {
      acceptedFrames.push(i);
      continue;
    }
    const last = acceptedFrames[acceptedFrames.length - 1];
    if (i - last < minGapFrames) {
      if (onsetEnvelope[i] > onsetEnvelope[last]) {
        rejectedPeaks.push({
          frameIndex: last,
          timeSec: frameData.frameTimes[last],
          reason: "replaced_by_stronger",
          onset: onsetEnvelope[last],
          threshold: threshold[last],
          rmsNorm: rmsNorm[last]
        });
        acceptedFrames[acceptedFrames.length - 1] = i;
      } else {
        rejectedPeaks.push({
          frameIndex: i,
          timeSec: frameData.frameTimes[i],
          reason: "refractory",
          onset: value,
          threshold: thresholdValue,
          rmsNorm: rmsValue
        });
      }
      continue;
    }
    acceptedFrames.push(i);
  }

  return {
    onsetEnvelope: arrayToNumberArray(onsetEnvelope),
    threshold: arrayToNumberArray(threshold),
    rmsNorm: arrayToNumberArray(rmsNorm),
    candidateFrames,
    acceptedFrames,
    rejectedPeaks
  };
}

function eventFeaturesFromFrame(frameData, frameIndex) {
  const idx = clamp(Math.round(frameIndex), 0, frameData.frameTimes.length - 1);
  const pre = APP_CONFIG.analysis.featureWindowPre;
  const post = APP_CONFIG.analysis.featureWindowPost;
  const start = Math.max(0, idx - pre);
  const end = Math.min(frameData.frameTimes.length - 1, idx + post);
  const next = Math.min(frameData.frameTimes.length - 1, idx + 1);
  const prev = Math.max(0, idx - 1);

  let lowRatioSum = 0;
  let midRatioSum = 0;
  let highRatioSum = 0;
  let zcrSum = 0;
  let crestSum = 0;
  let rmsPeak = 0;
  let attackPeak = 0;
  let highAttackPeak = 0;
  let count = 0;
  let preRmsSum = 0;
  let preCount = 0;

  for (let i = start; i <= end; i++) {
    lowRatioSum += frameData.lowRatio[i];
    midRatioSum += frameData.midRatio[i];
    highRatioSum += frameData.highRatio[i];
    zcrSum += frameData.zcrNorm[i];
    crestSum += frameData.crestNorm[i];
    rmsPeak = Math.max(rmsPeak, frameData.rmsNorm[i]);
    if (i > 0) {
      attackPeak = Math.max(attackPeak, Math.max(0, frameData.rmsNorm[i] - frameData.rmsNorm[i - 1]));
      highAttackPeak = Math.max(highAttackPeak, Math.max(0, frameData.highNorm[i] - frameData.highNorm[i - 1]));
    }
    if (i < idx) {
      preRmsSum += frameData.rmsNorm[i];
      preCount += 1;
    }
    count += 1;
  }

  const lowRatio = lowRatioSum / Math.max(1, count);
  const midRatio = midRatioSum / Math.max(1, count);
  const highRatio = highRatioSum / Math.max(1, count);
  const zcrNorm = zcrSum / Math.max(1, count);
  const crestNorm = crestSum / Math.max(1, count);
  const preRms = preCount > 0 ? preRmsSum / preCount : frameData.rmsNorm[prev];
  const burst = Math.max(0, rmsPeak - preRms);
  const decay = clamp(frameData.rmsNorm[next] / Math.max(1e-6, frameData.rmsNorm[idx]), 0, 2.5);
  const logRms = Math.log1p(frameData.rms[idx] + 0.4 * rmsPeak);

  return {
    lowRatio,
    midRatio,
    highRatio,
    zcrNorm,
    vector: [
      logRms,
      lowRatio,
      midRatio,
      highRatio,
      zcrNorm,
      crestNorm,
      attackPeak + burst * 0.35,
      highAttackPeak,
      decay
    ]
  };
}

function buildPrototypeModel(prototypesByClass) {
  const byClass = { 0: [], 1: [], 2: [] };
  let featureDim = -1;
  for (const classDef of CLASS_DEFS) {
    const classList = prototypesByClass[classDef.id] || [];
    for (const entry of classList) {
      if (!entry || !Array.isArray(entry.vector) || entry.vector.length === 0) {
        continue;
      }
      const vector = entry.vector.map((value) => Number(value) || 0);
      if (featureDim < 0) {
        featureDim = vector.length;
      }
      if (vector.length !== featureDim) {
        continue;
      }
      byClass[classDef.id].push(vector);
    }
  }
  if (featureDim <= 0) {
    return null;
  }

  const allVectors = [];
  for (const classDef of CLASS_DEFS) {
    for (const vector of byClass[classDef.id]) {
      allVectors.push(vector);
    }
  }
  if (!allVectors.length) {
    return null;
  }

  const mean = new Array(featureDim).fill(0);
  for (const vector of allVectors) {
    for (let d = 0; d < featureDim; d++) {
      mean[d] += vector[d];
    }
  }
  for (let d = 0; d < featureDim; d++) {
    mean[d] /= allVectors.length;
  }

  const std = new Array(featureDim).fill(0);
  for (const vector of allVectors) {
    for (let d = 0; d < featureDim; d++) {
      const diff = vector[d] - mean[d];
      std[d] += diff * diff;
    }
  }
  for (let d = 0; d < featureDim; d++) {
    std[d] = Math.sqrt(std[d] / allVectors.length);
    std[d] = Math.max(std[d], 0.12);
  }

  const classStats = [];
  const classCounts = { 0: 0, 1: 0, 2: 0 };
  const classThresholds = { 0: 0, 1: 0, 2: 0 };
  for (const classDef of CLASS_DEFS) {
    const vectors = byClass[classDef.id];
    classCounts[classDef.id] = vectors.length;
    if (!vectors.length) {
      continue;
    }
    const normalizedVectors = vectors.map((vector) => normalizeVector(vector, mean, std));
    const classMean = new Array(featureDim).fill(0);
    for (const vector of normalizedVectors) {
      for (let d = 0; d < featureDim; d++) {
        classMean[d] += vector[d];
      }
    }
    for (let d = 0; d < featureDim; d++) {
      classMean[d] /= normalizedVectors.length;
    }

    const classVar = new Array(featureDim).fill(1);
    if (normalizedVectors.length >= 2) {
      for (let d = 0; d < featureDim; d++) {
        let variance = 0;
        for (const vector of normalizedVectors) {
          const diff = vector[d] - classMean[d];
          variance += diff * diff;
        }
        variance /= normalizedVectors.length;
        classVar[d] = Math.max(variance, 0.22);
      }
    }

    const distances = normalizedVectors.map((vector) => diagonalMahalanobisDistance(vector, classMean, classVar));
    const sortedDistances = distances.slice().sort((a, b) => a - b);
    const distP50 = percentileFromSorted(sortedDistances, 0.5);
    const distP90 = percentileFromSorted(sortedDistances, 0.9);
    const baseThreshold = normalizedVectors.length >= 2
      ? Math.max(0.9, distP90 * 1.15 + 0.08, distP50 * 1.45 + 0.05)
      : 2.1;
    classThresholds[classDef.id] = baseThreshold;
    classStats.push({
      classId: classDef.id,
      count: normalizedVectors.length,
      mean: classMean,
      variance: classVar,
      baseThreshold
    });
  }

  if (!classStats.length) {
    return null;
  }

  return {
    mean,
    std,
    featureDim,
    classStats,
    classCounts,
    classThresholds
  };
}

function classifyFromPrototypes(vector, model, rejectDistance, featureHint) {
  if (!model || !Array.isArray(model.classStats) || vector.length !== model.featureDim) {
    return {
      classId: -1,
      distance: Number.POSITIVE_INFINITY,
      margin: 0,
      confidence: 0,
      classThreshold: 0,
      prior: 0
    };
  }

  const normalized = normalizeVector(vector, model.mean, model.std);
  const scored = model.classStats
    .map((classStat) => ({
      classId: classStat.classId,
      count: classStat.count,
      distance: diagonalMahalanobisDistance(normalized, classStat.mean, classStat.variance),
      classThreshold: classStat.baseThreshold * Math.max(0.35, Number(rejectDistance) || 1),
      prior: classPriorLikelihood(classStat.classId, featureHint)
    }));
  if (!scored.length) {
    return {
      classId: -1,
      distance: Number.POSITIVE_INFINITY,
      margin: 0,
      confidence: 0,
      classThreshold: 0,
      prior: 0
    };
  }

  const ranked = scored
    .map((item) => {
      const normalizedDistance = item.distance / Math.max(1e-6, item.classThreshold);
      const adjustedScore = normalizedDistance - 0.42 * item.prior;
      return {
        ...item,
        normalizedDistance,
        adjustedScore
      };
    })
    .sort((a, b) => a.adjustedScore - b.adjustedScore);

  const best = ranked[0];
  const secondScore = ranked.length > 1 ? ranked[1].adjustedScore : best.adjustedScore + 1;
  const margin = clamp((secondScore - best.adjustedScore) / Math.max(1e-6, secondScore), 0, 1);
  const confidence = clamp(
    Math.exp(-0.9 * best.normalizedDistance) * 0.72 + margin * 0.2 + best.prior * 0.08,
    0,
    1
  );
  const hardReject = best.distance > best.classThreshold * 1.28;
  const softReject = best.distance > best.classThreshold && margin < 0.12 && best.prior < 0.42 && ranked.length > 1;
  const sparseReject = best.count <= 1 && best.distance > best.classThreshold * 1.12 && margin < 0.28;
  const ambiguousReject = best.normalizedDistance > 1.02 && margin < 0.07;
  if (hardReject || softReject || sparseReject || ambiguousReject) {
    return {
      classId: -1,
      distance: best.distance,
      margin,
      confidence,
      classThreshold: best.classThreshold,
      prior: best.prior
    };
  }
  return {
    classId: best.classId,
    distance: best.distance,
    margin,
    confidence,
    classThreshold: best.classThreshold,
    prior: best.prior
  };
}

function classifyHeuristically(feature) {
  const low = feature.lowRatio;
  const high = feature.highRatio;
  const zcr = feature.zcrNorm;
  if (low >= 0.42 && zcr < 0.4) {
    return { classId: 0, distance: 0, margin: 0.2, confidence: 0.5, classThreshold: 0 };
  }
  if (high >= 0.36 && zcr >= 0.35) {
    return { classId: 2, distance: 0, margin: 0.2, confidence: 0.5, classThreshold: 0 };
  }
  return { classId: 1, distance: 0, margin: 0.2, confidence: 0.5, classThreshold: 0 };
}

function classPriorLikelihood(classId, featureHint) {
  const low = clamp(Number(featureHint?.lowRatio) || 0, 0, 1);
  const mid = clamp(Number(featureHint?.midRatio) || 0, 0, 1);
  const high = clamp(Number(featureHint?.highRatio) || 0, 0, 1);
  const zcr = clamp(Number(featureHint?.zcrNorm) || 0, 0, 1);
  if (classId === 0) {
    return clamp(0.68 * low + 0.22 * (1 - zcr) + 0.1 * (1 - high), 0, 1);
  }
  if (classId === 2) {
    return clamp(0.72 * high + 0.2 * zcr + 0.08 * (1 - low), 0, 1);
  }
  return clamp(0.52 * mid + 0.24 * zcr + 0.24 * (1 - Math.abs(low - high)), 0, 1);
}

function renderAnalysis(analysis) {
  if (!analysis) {
    els.durationValue.textContent = "-";
    els.hitCountValue.textContent = "-";
    els.labeledCountValue.textContent = "-";
    renderTimelinePlaceholder("Detected percussion timeline appears after recording.");
    renderDebugPlaceholder("Onset debug traces appear after analysis.");
    els.classSummary.innerHTML = "";
    els.debugSummary.innerHTML = "";
    return;
  }

  const labeledCount = analysis.events.filter((event) => event.classId >= 0).length;
  els.durationValue.textContent = `${analysis.durationSec.toFixed(2)} s`;
  els.hitCountValue.textContent = String(analysis.events.length);
  els.labeledCountValue.textContent = String(labeledCount);
  renderClassSummary(analysis);
  renderTimeline(analysis);
  renderDebugPlot(analysis);
}

function renderClassSummary(analysis) {
  const chips = [];
  for (const classDef of CLASS_DEFS) {
    const count = analysis.classCounts[classDef.id] || 0;
    chips.push(`${classDef.label}: ${count}`);
  }
  chips.push(`Unknown: ${analysis.classCounts.unknown || 0}`);
  chips.push(`Classifier: ${analysis.classifierMode}`);
  if (analysis.classifierInfo && analysis.classifierMode === "prototype") {
    const thresholds = analysis.classifierInfo.classThresholds || {};
    chips.push(
      `Thr K/S/H: ${
        Number(thresholds[0] || 0).toFixed(2)
      }/${
        Number(thresholds[1] || 0).toFixed(2)
      }/${
        Number(thresholds[2] || 0).toFixed(2)
      }`
    );
    chips.push(`Input gain: x${Number(analysis.classifierInfo.inputGain || 1).toFixed(2)}`);
    chips.push(
      `Proto K/S/H: ${
        Number(analysis.classifierInfo.classCounts?.[0] || 0)
      }/${
        Number(analysis.classifierInfo.classCounts?.[1] || 0)
      }/${
        Number(analysis.classifierInfo.classCounts?.[2] || 0)
      }`
    );
  }
  renderChipContainer(els.classSummary, chips);
}

function renderDebugPlot(analysis) {
  const canvas = els.debugCanvas;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const onset = analysis.onsetData.onsetEnvelope;
  if (!onset.length) {
    renderDebugPlaceholder("No frames available.");
    return;
  }
  const threshold = analysis.onsetData.threshold;
  const rmsNorm = analysis.onsetData.rmsNorm;
  const frameTimes = analysis.frameData.frameTimes;
  const waveform = Array.isArray(analysis.waveformPreview) ? analysis.waveformPreview : [];
  const duration = Math.max(analysis.durationSec, frameTimes[frameTimes.length - 1] || 0.1, 0.1);

  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 46, right: 14, top: 20, bottom: 26 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = Math.max(1, height - pad.top - pad.bottom);

  const xForTime = (timeSec) => pad.left + (clamp(timeSec, 0, duration) / duration) * plotWidth;
  const yForValue = (value) => pad.top + (1 - clamp(value, 0, 1)) * plotHeight;

  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, width, height);
  if (waveform.length > 1) {
    const midY = pad.top + plotHeight * 0.5;
    const amp = plotHeight * 0.42;
    ctx.strokeStyle = "rgba(150, 180, 205, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < waveform.length; i++) {
      const t = (i / (waveform.length - 1)) * duration;
      const x = xForTime(t);
      const y = midY - clamp(waveform[i], -1, 1) * amp;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(108, 205, 182, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  drawSeries(ctx, frameTimes, onset, "#67d8ff", xForTime, yForValue);
  drawSeries(ctx, frameTimes, threshold, "#f4d46f", xForTime, yForValue);
  drawSeries(ctx, frameTimes, rmsNorm, "#61d5a1", xForTime, yForValue);

  ctx.strokeStyle = "rgba(170, 192, 205, 0.26)";
  for (const frameIndex of analysis.onsetData.candidateFrames) {
    const x = xForTime(frameTimes[frameIndex] || 0);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotHeight);
    ctx.stroke();
  }

  ctx.fillStyle = "#6df0c4";
  for (const frameIndex of analysis.onsetData.acceptedFrames) {
    const x = xForTime(frameTimes[frameIndex] || 0);
    const y = yForValue(onset[frameIndex] || 0);
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "#ff8f92";
  ctx.lineWidth = 1.2;
  for (const peak of analysis.onsetData.rejectedPeaks) {
    const x = xForTime(peak.timeSec || 0);
    const y = yForValue(peak.onset || 0);
    ctx.beginPath();
    ctx.moveTo(x - 2.8, y - 2.8);
    ctx.lineTo(x + 2.8, y + 2.8);
    ctx.moveTo(x + 2.8, y - 2.8);
    ctx.lineTo(x - 2.8, y + 2.8);
    ctx.stroke();
  }

  drawDebugLegend(ctx, width, pad);
  const rejectedByReason = {};
  for (const item of analysis.onsetData.rejectedPeaks) {
    const reason = String(item.reason || "other");
    rejectedByReason[reason] = (rejectedByReason[reason] || 0) + 1;
  }
  const chips = [
    `Candidates: ${analysis.onsetData.candidateFrames.length}`,
    `Accepted: ${analysis.onsetData.acceptedFrames.length}`,
    `Rejected: ${analysis.onsetData.rejectedPeaks.length}`,
    `Classifier: ${analysis.classifierMode}`
  ];
  const classedDistances = analysis.events
    .filter((event) => event.classId >= 0 && Number.isFinite(event.distance))
    .map((event) => Number(event.distance));
  const classedThresholds = analysis.events
    .filter((event) => event.classId >= 0 && Number.isFinite(event.classThreshold) && event.classThreshold > 0)
    .map((event) => Number(event.classThreshold));
  const classedPriors = analysis.events
    .filter((event) => event.classId >= 0 && Number.isFinite(event.classPrior))
    .map((event) => Number(event.classPrior));
  if (classedDistances.length) {
    const sorted = classedDistances.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    chips.push(`Distance p50: ${p50.toFixed(2)}`);
  }
  if (classedThresholds.length) {
    const sorted = classedThresholds.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    chips.push(`Threshold p50: ${p50.toFixed(2)}`);
  }
  if (classedPriors.length) {
    const sorted = classedPriors.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    chips.push(`Prior p50: ${p50.toFixed(2)}`);
  }
  for (const [reason, count] of Object.entries(rejectedByReason)) {
    chips.push(`${reason}: ${count}`);
  }
  renderChipContainer(els.debugSummary, chips);
}

function drawDebugLegend(ctx, width, pad) {
  const items = [
    { color: "#67d8ff", label: "Onset envelope" },
    { color: "#f4d46f", label: "Adaptive threshold" },
    { color: "#61d5a1", label: "RMS (norm)" }
  ];
  const legendWidth = 205;
  const rowHeight = 14;
  const legendX = width - legendWidth - 12;
  const legendY = pad.top + 6;
  const legendHeight = 12 + items.length * rowHeight + 4;

  ctx.fillStyle = "rgba(7, 20, 30, 0.78)";
  ctx.strokeStyle = "rgba(108, 205, 182, 0.28)";
  ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
  ctx.strokeRect(legendX, legendY, legendWidth, legendHeight);

  ctx.font = "11px Space Grotesk";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const y = legendY + 10 + i * rowHeight + 2;
    const sx = legendX + 10;
    const ex = sx + 24;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(ex, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(220, 241, 235, 0.92)";
    ctx.fillText(item.label, ex + 8, y);
  }
}

function drawSeries(ctx, frameTimes, values, color, xForTime, yForValue) {
  if (!Array.isArray(values) || values.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = xForTime(frameTimes[i] || 0);
    const y = yForValue(values[i] || 0);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function renderTimeline(analysis) {
  const canvas = els.timelineCanvas;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 88, right: 20, top: 18, bottom: 22 };
  const plotWidth = Math.max(1, width - pad.left - pad.right);
  const plotHeight = Math.max(1, height - pad.top - pad.bottom);
  const laneCount = CLASS_DEFS.length;
  const laneAreaHeight = plotHeight * 0.8;
  const laneTop = pad.top + (plotHeight - laneAreaHeight) * 0.5;
  const laneBottom = laneTop + laneAreaHeight;
  const laneHeight = laneAreaHeight / laneCount;
  const duration = Math.max(analysis.durationSec, 0.1);
  const xForTime = (timeSec) => pad.left + (clamp(timeSec, 0, duration) / duration) * plotWidth;

  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(108, 205, 182, 0.22)";
  ctx.lineWidth = 1;
  for (let lane = 0; lane <= laneCount; lane++) {
    const y = laneTop + lane * laneHeight;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(188, 233, 221, 0.9)";
  ctx.font = "13px Space Grotesk";
  ctx.textBaseline = "middle";
  for (let lane = 0; lane < laneCount; lane++) {
    const classId = (laneCount - 1) - lane;
    const y = laneTop + lane * laneHeight + laneHeight * 0.5;
    ctx.fillText(CLASS_DEFS[classId].label, 20, y);
  }

  for (const event of analysis.events) {
    if (event.classId < 0) {
      continue;
    }
    const lane = (laneCount - 1) - event.classId;
    const x = xForTime(event.timeSec || 0);
    const y = laneTop + lane * laneHeight + laneHeight * 0.5;
    const radius = 4 + clamp(event.confidence || 0, 0, 1) * 3.5;
    const alpha = 0.4 + clamp(event.strength || 0, 0, 1) * 0.55;
    ctx.fillStyle = withAlpha(CLASS_DEFS[event.classId].color, alpha);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha("#ffffff", 0.35 + clamp(event.confidence || 0, 0, 1) * 0.45);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, radius + 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const event of analysis.events) {
    if (event.classId >= 0) {
      continue;
    }
    const x = xForTime(event.timeSec || 0);
    const y = laneBottom - 8;
    ctx.strokeStyle = "#ff8f92";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 3);
    ctx.lineTo(x + 3, y + 3);
    ctx.moveTo(x + 3, y - 3);
    ctx.lineTo(x - 3, y + 3);
    ctx.stroke();
  }
}

function renderTimelinePlaceholder(text) {
  const canvas = els.timelineCanvas;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(180, 224, 211, 0.85)";
  ctx.font = "18px Space Grotesk";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function renderDebugPlaceholder(text) {
  const canvas = els.debugCanvas;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(180, 224, 211, 0.85)";
  ctx.font = "16px Space Grotesk";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function renderChipContainer(container, entries) {
  container.innerHTML = "";
  for (const text of entries) {
    const chip = document.createElement("span");
    chip.className = "percussion-chip";
    chip.textContent = text;
    container.appendChild(chip);
  }
}

async function playDetectedPattern() {
  if (!state.analysis || !state.analysis.events.length) {
    return;
  }
  const playable = state.analysis.events.filter((event) => event.classId >= 0);
  if (!playable.length) {
    setStatus("No labeled hits to play.");
    return;
  }
  stopPlayback();
  const ctx = createAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  state.playbackContext = ctx;
  const start = ctx.currentTime + 0.05;
  const duration = Math.max(state.analysis.durationSec, 0.1);
  for (const event of playable) {
    const when = start + clamp(event.timeSec || 0, 0, duration);
    const strength = clamp(event.strength || event.confidence || 0.5, 0, 1);
    triggerPercussionVoice(ctx, event.classId, when, strength);
  }
  state.playbackStopTimer = setTimeout(() => {
    stopPlayback();
    setStatus("Playback finished.");
  }, Math.round((duration + 0.8) * 1000));
  setStatus("Playing detected percussion track...");
  syncButtons();
}

function triggerPercussionVoice(ctx, classId, start, strength) {
  if (classId === 0) {
    triggerKick(ctx, start, strength);
    return;
  }
  if (classId === 1) {
    triggerSnare(ctx, start, strength);
    return;
  }
  triggerHat(ctx, start, strength);
}

function triggerKick(ctx, start, strength) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const level = 0.14 + strength * 0.3;
  osc.type = "sine";
  osc.frequency.setValueAtTime(165, start);
  osc.frequency.exponentialRampToValueAtTime(44, start + 0.14);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.23);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.24);
}

function triggerSnare(ctx, start, strength) {
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.2);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 1900;
  bandpass.Q.value = 0.9;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08 + strength * 0.24, start);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);

  const tone = ctx.createOscillator();
  tone.type = "triangle";
  tone.frequency.setValueAtTime(198, start);
  tone.frequency.exponentialRampToValueAtTime(112, start + 0.09);
  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(0.05 + strength * 0.1, start);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);

  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  tone.connect(toneGain);
  toneGain.connect(ctx.destination);

  noise.start(start);
  noise.stop(start + 0.2);
  tone.start(start);
  tone.stop(start + 0.15);
}

function triggerHat(ctx, start, strength) {
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.11);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 6200;
  highpass.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.04 + strength * 0.11, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);
  noise.connect(highpass);
  highpass.connect(gain);
  gain.connect(ctx.destination);
  noise.start(start);
  noise.stop(start + 0.1);
}

function createNoiseBuffer(ctx, durationSec) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function stopPlayback() {
  if (state.playbackStopTimer) {
    clearTimeout(state.playbackStopTimer);
    state.playbackStopTimer = null;
  }
  if (state.playbackContext) {
    state.playbackContext.close().catch(() => {});
    state.playbackContext = null;
  }
  syncButtons();
}

function clearClipAndAnalysis() {
  clearRecordStopTimer();
  stopPlayback();
  if (state.autoReanalyzeTimer) {
    clearTimeout(state.autoReanalyzeTimer);
    state.autoReanalyzeTimer = null;
  }
  state.autoReanalyzeInFlight = false;
  state.autoReanalyzePending = false;
  state.lastSamples = null;
  state.lastSampleRate = 0;
  state.analysis = null;
  renderAnalysis(null);
  setStatus("Cleared clip.");
  syncButtons();
}

function clearClassPrototypes(classId) {
  state.prototypes[classId] = [];
  savePrototypesToStorage();
  renderPrototypeSummary();
  syncButtons();
  setStatus(`${CLASS_DEFS[classId].label} prototypes cleared.`);
  scheduleAutoReanalyze(true);
}

function clearAllPrototypes() {
  state.prototypes = { 0: [], 1: [], 2: [] };
  savePrototypesToStorage();
  renderPrototypeSummary();
  syncButtons();
  setStatus("All prototypes cleared.");
  scheduleAutoReanalyze(true);
}

function normalizeImportedPrototypePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = (payload.prototypes && typeof payload.prototypes === "object")
    ? payload.prototypes
    : payload;
  const next = { 0: [], 1: [], 2: [] };
  for (const classDef of CLASS_DEFS) {
    const list = source[classDef.id] ?? source[String(classDef.id)];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      if (!item || !Array.isArray(item.vector) || item.vector.length === 0) {
        continue;
      }
      next[classDef.id].push({
        vector: item.vector.map((value) => Number(value) || 0),
        capturedAt: Number(item.capturedAt) || Date.now(),
        frameIndex: Math.max(0, Math.round(Number(item.frameIndex) || 0)),
        strength: clamp(Number(item.strength) || 0, 0, 1)
      });
    }
    while (next[classDef.id].length > APP_CONFIG.prototype.maxPerClass) {
      next[classDef.id].shift();
    }
  }
  return next;
}

function addPrototype(classId, prototype) {
  const list = state.prototypes[classId];
  list.push(prototype);
  while (list.length > APP_CONFIG.prototype.maxPerClass) {
    list.shift();
  }
  savePrototypesToStorage();
}

function renderPrototypeSummary() {
  const countKick = state.prototypes[0].length;
  const countSnare = state.prototypes[1].length;
  const countHat = state.prototypes[2].length;
  els.kickProtoCount.textContent = `${countKick} / ${APP_CONFIG.prototype.maxPerClass}`;
  els.snareProtoCount.textContent = `${countSnare} / ${APP_CONFIG.prototype.maxPerClass}`;
  els.hatProtoCount.textContent = `${countHat} / ${APP_CONFIG.prototype.maxPerClass}`;
  els.protoPoolValue.textContent = String(getPrototypePoolSize());
}

function getPrototypePoolSize() {
  return state.prototypes[0].length + state.prototypes[1].length + state.prototypes[2].length;
}

function loadPrototypesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeImportedPrototypePayload(parsed);
    if (!normalized) {
      return;
    }
    state.prototypes = normalized;
  } catch {
    state.prototypes = { 0: [], 1: [], 2: [] };
  }
}

function savePrototypesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.prototypes));
  } catch {
    // Best effort only.
  }
}

function estimateInputGain(samples, targetRms, minGain, maxGain) {
  if (!samples || !samples.length) {
    return { gain: 1, rms: 0 };
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (!Number.isFinite(rms) || rms <= 1e-6) {
    return { gain: 1, rms: rms || 0 };
  }
  const unclamped = (targetRms || 0.1) / rms;
  const gain = clamp(unclamped, minGain || 0.5, maxGain || 6);
  return { gain, rms };
}

function applyGain(samples, gain) {
  const safeGain = Number.isFinite(gain) ? gain : 1;
  if (Math.abs(safeGain - 1) < 1e-6) {
    return new Float32Array(samples);
  }
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = clamp(samples[i] * safeGain, -1, 1);
  }
  return out;
}

function buildWaveformPreview(samples, maxPoints) {
  const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  if (!source.length) {
    return [];
  }
  const points = Math.max(32, Math.round(maxPoints || 1200));
  const step = Math.max(1, Math.floor(source.length / points));
  let peak = 1e-6;
  const values = [];
  for (let i = 0; i < source.length; i += step) {
    let sum = 0;
    let count = 0;
    const end = Math.min(source.length, i + step);
    for (let j = i; j < end; j++) {
      sum += source[j];
      count += 1;
    }
    const mean = count > 0 ? sum / count : 0;
    peak = Math.max(peak, Math.abs(mean));
    values.push(mean);
  }
  for (let i = 0; i < values.length; i++) {
    values[i] = clamp(values[i] / peak, -1, 1);
  }
  return values;
}

function resampleLinear(samples, inputRate, targetRate) {
  if (inputRate <= 0 || targetRate <= 0 || inputRate === targetRate) {
    return new Float32Array(samples);
  }
  const ratio = targetRate / inputRate;
  const outputLength = Math.max(1, Math.round(samples.length * ratio));
  const output = new Float32Array(outputLength);
  const maxInputIndex = Math.max(0, samples.length - 1);
  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = (i / Math.max(1, outputLength - 1)) * maxInputIndex;
    const left = Math.floor(sourceIndex);
    const right = Math.min(maxInputIndex, left + 1);
    const frac = sourceIndex - left;
    output[i] = samples[left] * (1 - frac) + samples[right] * frac;
  }
  return output;
}

function diagonalMahalanobisDistance(vector, mean, variance) {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) {
    const diff = vector[i] - mean[i];
    sum += (diff * diff) / Math.max(1e-6, variance[i]);
  }
  return Math.sqrt(sum);
}

function percentileFromSorted(sorted, q) {
  if (!sorted.length) {
    return 0;
  }
  const clampedQ = clamp(Number(q) || 0, 0, 1);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * clampedQ)));
  return sorted[idx];
}

function onePoleLowPass(samples, cutoffHz, sampleRate) {
  const output = new Float32Array(samples.length);
  const omega = 2 * Math.PI * cutoffHz / sampleRate;
  const a = Math.exp(-omega);
  let prev = 0;
  for (let i = 0; i < samples.length; i++) {
    const next = (1 - a) * samples[i] + a * prev;
    output[i] = next;
    prev = next;
  }
  return output;
}

function onePoleHighPass(samples, cutoffHz, sampleRate) {
  const low = onePoleLowPass(samples, cutoffHz, sampleRate);
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] - low[i];
  }
  return output;
}

function positiveDiff(values) {
  const output = new Float32Array(values.length);
  for (let i = 1; i < values.length; i++) {
    output[i] = Math.max(0, values[i] - values[i - 1]);
  }
  return output;
}

function movingAverage(values, radius) {
  const output = new Float32Array(values.length);
  const r = Math.max(0, Math.round(radius));
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - r);
    const end = Math.min(values.length - 1, i + r);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      sum += values[j];
    }
    output[i] = sum / Math.max(1, end - start + 1);
  }
  return output;
}

function adaptiveThreshold(onsetEnvelope, sensitivity, noiseFloor) {
  const output = new Float32Array(onsetEnvelope.length);
  const win = 8;
  for (let i = 0; i < onsetEnvelope.length; i++) {
    const start = Math.max(0, i - win);
    const end = Math.min(onsetEnvelope.length - 1, i + win);
    const local = [];
    for (let j = start; j <= end; j++) {
      local.push(onsetEnvelope[j]);
    }
    const med = median(local);
    const absDev = local.map((value) => Math.abs(value - med));
    const mad = median(absDev) + 1e-4;
    const scale = 1.45 / Math.max(0.35, sensitivity);
    const minThreshold = noiseFloor * 0.36 + 0.02;
    output[i] = Math.max(minThreshold, med + scale * mad);
  }
  return output;
}

function robustNormalize01(values) {
  if (!values.length) {
    return new Float32Array(0);
  }
  const arr = Array.from(values);
  const p10 = percentile(arr, 0.1);
  const p90 = percentile(arr, 0.9);
  const scale = Math.max(1e-6, p90 - p10);
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    output[i] = clamp((values[i] - p10) / scale, 0, 1);
  }
  return output;
}

function normalizeVector(vector, mean, std) {
  const output = new Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    output[i] = (vector[i] - mean[i]) / std[i];
  }
  return output;
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function argMax(values) {
  if (!values.length) {
    return -1;
  }
  let bestIndex = 0;
  let bestValue = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }
  return bestIndex;
}

function sqrtArray(values) {
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    output[i] = Math.sqrt(Math.max(0, values[i]));
  }
  return output;
}

function clipArray(values, min, max) {
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    output[i] = clamp(values[i], min, max);
  }
  return output;
}

function arrayToNumberArray(values) {
  const output = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    output[i] = Number(values[i]) || 0;
  }
  return output;
}

function withAlpha(hexColor, alpha) {
  const clamped = clamp(alpha, 0, 1);
  const hex = hexColor.replace("#", "");
  if (hex.length !== 6) {
    return `rgba(255,255,255,${clamped})`;
  }
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamped})`;
}
