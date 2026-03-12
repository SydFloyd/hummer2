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
const AUTO_DETECT_MODE_ID = "major";
const hummerCore = window.HummerCore;
if (!hummerCore) {
  throw new Error("HummerCore is missing. Ensure audio-core.js is loaded before app.js.");
}
const {
  toMono,
  trimAudioBufferTail,
  computeRms,
  hzToMidi,
  midiToHz,
  createAudioContext,
  sanitizeNumericSetting,
  sanitizeChoice,
  clamp,
  positiveModulo,
  percentile,
  mean,
  median,
  tailWeightedMean
} = hummerCore;

const PITCH_MAX_MIDI = 76; // E5
const DEFAULT_CONTINUOUS_DYNAMICS = true;
const DEFAULT_RAW_PORTAMENTO_ENABLED = false;
const DEFAULT_RAW_GRAVITY_ENABLED = false;
const APP_CONFIG = {
  controls: {
    gateMultiplier: { min: 1.2, max: 6, step: 0.1, defaultValue: 2.5 },
    minNoteMs: { min: 10, max: 300, step: 5, defaultValue: 25 },
    pitchJumpSplit: { min: 0, max: 6, step: 0.1, defaultValue: 0.6 },
    flutterToleranceMs: { min: 0, max: 180, step: 5, defaultValue: 100 },
    maxNoteJump: { min: 0, max: 24, step: 0.5, defaultValue: 18 },
    rawPortamentoAmount: { min: 0, max: 100, step: 1, defaultValue: 35 },
    rawGravityAmount: { min: 0, max: 100, step: 1, defaultValue: 50 },
    periodicityFloor: { min: 0, max: 1, step: 0.01, defaultValue: 0.28 },
    onsetSensitivity: { min: 0, max: 1, step: 0.01, defaultValue: 0.55 },
    stabilitySensitivity: { min: 0, max: 1, step: 0.01, defaultValue: 0.58 },
    synthFilterCutoff: { min: 250, max: 7000, step: 25, defaultValue: 3200 },
    synthFilterQ: { min: 0.1, max: 16, step: 0.1, defaultValue: 0.8 },
    synthKeyboardTrackingPct: { min: 0, max: 100, step: 1, defaultValue: 45 },
    synthFilterEnvDepth: { min: 0, max: 2.5, step: 0.05, defaultValue: 1.1 },
    synthVoice2Detune: { min: -40, max: 40, step: 1, defaultValue: 8 },
    synthVoice2Mix: { min: 0, max: 100, step: 1, defaultValue: 38 },
    synthOutputGain: { min: 10, max: 100, step: 1, defaultValue: 55 },
    synthAttackMs: { min: 1, max: 300, step: 1, defaultValue: 14 },
    synthDecayMs: { min: 5, max: 900, step: 5, defaultValue: 160 },
    synthSustainPct: { min: 0, max: 100, step: 1, defaultValue: 72 },
    synthReleaseMs: { min: 10, max: 1200, step: 5, defaultValue: 170 },
    ampAttackMs: { min: 1, max: 300, step: 1, defaultValue: 8 },
    ampDecayMs: { min: 5, max: 900, step: 5, defaultValue: 120 },
    ampSustainPct: { min: 0, max: 100, step: 1, defaultValue: 92 },
    ampReleaseMs: { min: 10, max: 1200, step: 5, defaultValue: 130 }
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
    pitchHopSize: 320,
    trimTailMs: 110,
    minFrameEnergy: 1e-7,
    pitchFrontend: {
      apiPath: "/api/torchcrepe-track",
      defaultModel: "tiny",
      defaultUseViterbi: false,
      targetSampleRate: 16000,
      fmin: 65,
      fmax: 1200,
      pitchSmoothAmount: 0.14,
      gapFillFrames: 2
    },
    segmentation: {
      onsetWindowFrames: 2,
      slopeWindowFrames: 2,
      plateauWindowFrames: 2,
      voicedEvidenceWeight: 3.6,
      unvoicedStateBias: 2.6,
      changeBasePenalty: 0.72,
      jumpPenaltyPerSemitone: 0.085,
      stableHoldBonus: 0.1,
      boundaryEvidenceWeight: 1.25,
      boundaryEvidenceFloor: 0.12,
      plateauLandingWeight: 0.45,
      periodicityDipWeight: 0.35,
      slopeBreakWeight: 0.5,
      onsetWeight: 0.85
    }
  },
  detection: {
    gateOffset: 0.0015,
    noiseQuietFraction: 0.2,
    noiseQuietMinFrames: 4,
    endHoldFrames: 1,
    pitchRecoverySearchRadius: 4,
    rawPitchReducer: "mean",
    tailWeightedMeanPower: 2.2
  },
  autotune: {
    defaultRoot: 0,
    defaultModeId: "auto",
    autoMinVoicedFrames: 8,
    complexityPenaltyPerExtraDegree: 0.008,
    outOfScalePenaltyWeight: 1.2,
    tonicBiasWeight: 0.35,
    dominantBiasWeight: 0.1,
    cadenceBiasWeight: 0.45,
    confidenceMarginScale: 0.4
  },
  playback: {
    liveRefreshDebounceMs: 140,
    synth: {
      oscillator: "sawtooth",
      filterType: "lowpass",
      voice2Enabled: true,
      filterEnvelopeDepthOctaves: 1.1
    },
    rawPlayback: {
      releaseMs: 30,
      maxGain: 0.5,
      gainPower: 0.75,
      gapFillFrames: 2,
      maxGravityPullSemitones: 1.75,
      maxGravityStrength: 0.78
    },
    autoPlayback: {
      smoothingAmount: 0
    }
  },
  midiTimeline: {
    defaultMin: 48,
    defaultMax: 72,
    boundsPadding: 3
  }
};

const PRESET_SCHEMA_VERSION = 1;
const SHARED_PRESET_MANIFEST_PATH = "presets/index.json";
const PRESET_CONTROL_SPECS = [
  { id: "gateMultiplier", type: "number" },
  { id: "minNoteMs", type: "number" },
  { id: "pitchJumpSplit", type: "number" },
  { id: "flutterToleranceMs", type: "number" },
  { id: "maxNoteJump", type: "number" },
  { id: "noteDerivation", type: "string" },
  { id: "rawPortamentoEnabled", type: "boolean" },
  { id: "rawPortamentoAmount", type: "number" },
  { id: "rawGravityEnabled", type: "boolean" },
  { id: "rawGravityAmount", type: "number" },
  { id: "pitchFrontendModel", type: "string" },
  { id: "periodicityFloor", type: "number" },
  { id: "onsetSensitivity", type: "number" },
  { id: "stabilitySensitivity", type: "number" },
  { id: "pitchUseViterbi", type: "boolean" },
  { id: "scaleRoot", type: "string" },
  { id: "scaleMode", type: "string" },
  { id: "synthOscillator", type: "string" },
  { id: "synthFilterType", type: "string" },
  { id: "synthFilterQ", type: "number" },
  { id: "synthFilterCutoff", type: "number" },
  { id: "synthKeyboardTrackingPct", type: "number" },
  { id: "synthFilterEnvDepth", type: "number" },
  { id: "synthAttackMs", type: "number" },
  { id: "synthDecayMs", type: "number" },
  { id: "synthSustainPct", type: "number" },
  { id: "synthReleaseMs", type: "number" },
  { id: "ampAttackMs", type: "number" },
  { id: "ampDecayMs", type: "number" },
  { id: "ampSustainPct", type: "number" },
  { id: "ampReleaseMs", type: "number" },
  { id: "synthVoice2Enabled", type: "boolean" },
  { id: "synthVoice2Detune", type: "number" },
  { id: "synthVoice2Mix", type: "number" },
  { id: "synthOutputGain", type: "number" },
  { id: "continuousDynamics", type: "boolean" }
];
const PRESET_PLAY_MODES = ["raw", "auto", "original"];

const state = {
  mediaRecorder: null,
  mediaStream: null,
  audioContext: null,
  recordedChunks: [],
  originalAudioBuffer: null,
  analysis: null,
  derived: null,
  playbackContext: null,
  playbackEndTimer: null,
  playbackRefreshTimer: null,
  pitchAnalysisRefreshTimer: null,
  pitchAnalysisRequestId: 0,
  pitchAnalysisAbortController: null,
  synthTestVoice: null,
  synthTestReleaseTimer: null,
  loopPlayback: false,
  controlsCollapsed: true,
  synthPanelCollapsed: true,
  presetManifest: [],
  presetCache: {},
  autotuneConfig: {
    keyRoot: APP_CONFIG.autotune.defaultRoot,
    modeId: APP_CONFIG.autotune.defaultModeId
  }
};

const els = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  playSelectedBtn: document.getElementById("playSelectedBtn"),
  loopToggleBtn: document.getElementById("loopToggleBtn"),
  playbackModeRadios: Array.from(document.querySelectorAll("input[name='playMode']")),
  playScaleBtn: document.getElementById("playScaleBtn"),
  toggleControlsBtn: document.getElementById("toggleControlsBtn"),
  toggleSynthPanelBtn: document.getElementById("toggleSynthPanelBtn"),
  resetDefaultsBtn: document.getElementById("resetDefaultsBtn"),
  presetSelect: document.getElementById("presetSelect"),
  synthTestBtn: document.getElementById("synthTestBtn"),
  selectionPanel: document.getElementById("selectionPanel"),
  synthSelectionPanel: document.getElementById("synthSelectionPanel"),
  continuousDynamics: document.getElementById("continuousDynamics"),
  gateMultiplier: document.getElementById("gateMultiplier"),
  gateMultiplierValue: document.getElementById("gateMultiplierValue"),
  minNoteMs: document.getElementById("minNoteMs"),
  minNoteMsValue: document.getElementById("minNoteMsValue"),
  pitchJumpSplit: document.getElementById("pitchJumpSplit"),
  pitchJumpSplitValue: document.getElementById("pitchJumpSplitValue"),
  flutterToleranceMs: document.getElementById("flutterToleranceMs"),
  flutterToleranceMsValue: document.getElementById("flutterToleranceMsValue"),
  maxNoteJump: document.getElementById("maxNoteJump"),
  maxNoteJumpValue: document.getElementById("maxNoteJumpValue"),
  rawPortamentoEnabled: document.getElementById("rawPortamentoEnabled"),
  rawPortamentoAmount: document.getElementById("rawPortamentoAmount"),
  rawPortamentoAmountValue: document.getElementById("rawPortamentoAmountValue"),
  rawGravityEnabled: document.getElementById("rawGravityEnabled"),
  rawGravityAmount: document.getElementById("rawGravityAmount"),
  rawGravityAmountValue: document.getElementById("rawGravityAmountValue"),
  pitchFrontendModel: document.getElementById("pitchFrontendModel"),
  periodicityFloor: document.getElementById("periodicityFloor"),
  periodicityFloorValue: document.getElementById("periodicityFloorValue"),
  onsetSensitivity: document.getElementById("onsetSensitivity"),
  onsetSensitivityValue: document.getElementById("onsetSensitivityValue"),
  stabilitySensitivity: document.getElementById("stabilitySensitivity"),
  stabilitySensitivityValue: document.getElementById("stabilitySensitivityValue"),
  pitchUseViterbi: document.getElementById("pitchUseViterbi"),
  synthOscillator: document.getElementById("synthOscillator"),
  synthFilterType: document.getElementById("synthFilterType"),
  synthFilterCutoff: document.getElementById("synthFilterCutoff"),
  synthFilterCutoffValue: document.getElementById("synthFilterCutoffValue"),
  synthFilterQ: document.getElementById("synthFilterQ"),
  synthFilterQValue: document.getElementById("synthFilterQValue"),
  synthKeyboardTrackingPct: document.getElementById("synthKeyboardTrackingPct"),
  synthKeyboardTrackingPctValue: document.getElementById("synthKeyboardTrackingPctValue"),
  synthFilterEnvDepth: document.getElementById("synthFilterEnvDepth"),
  synthFilterEnvDepthValue: document.getElementById("synthFilterEnvDepthValue"),
  synthVoice2Enabled: document.getElementById("synthVoice2Enabled"),
  synthVoice2Detune: document.getElementById("synthVoice2Detune"),
  synthVoice2DetuneValue: document.getElementById("synthVoice2DetuneValue"),
  synthVoice2Mix: document.getElementById("synthVoice2Mix"),
  synthVoice2MixValue: document.getElementById("synthVoice2MixValue"),
  synthOutputGain: document.getElementById("synthOutputGain"),
  synthOutputGainValue: document.getElementById("synthOutputGainValue"),
  synthAttackMs: document.getElementById("synthAttackMs"),
  synthAttackMsValue: document.getElementById("synthAttackMsValue"),
  synthDecayMs: document.getElementById("synthDecayMs"),
  synthDecayMsValue: document.getElementById("synthDecayMsValue"),
  synthSustainPct: document.getElementById("synthSustainPct"),
  synthSustainPctValue: document.getElementById("synthSustainPctValue"),
  synthReleaseMs: document.getElementById("synthReleaseMs"),
  synthReleaseMsValue: document.getElementById("synthReleaseMsValue"),
  ampAttackMs: document.getElementById("ampAttackMs"),
  ampAttackMsValue: document.getElementById("ampAttackMsValue"),
  ampDecayMs: document.getElementById("ampDecayMs"),
  ampDecayMsValue: document.getElementById("ampDecayMsValue"),
  ampSustainPct: document.getElementById("ampSustainPct"),
  ampSustainPctValue: document.getElementById("ampSustainPctValue"),
  ampReleaseMs: document.getElementById("ampReleaseMs"),
  ampReleaseMsValue: document.getElementById("ampReleaseMsValue"),
  noteDerivation: document.getElementById("noteDerivation"),
  scaleRoot: document.getElementById("scaleRoot"),
  scaleMode: document.getElementById("scaleMode"),
  statusText: document.getElementById("statusText"),
  durationValue: document.getElementById("durationValue"),
  noiseFloorValue: document.getElementById("noiseFloorValue"),
  thresholdValue: document.getElementById("thresholdValue"),
  scaleInfoValue: document.getElementById("scaleInfoValue"),
  midiCanvas: document.getElementById("midiCanvas")
};

bootstrap();

function bootstrap() {
  applyControlConfig();
  populateScaleControls();
  populatePresetControls();
  wireEvents();
  syncControlLabels();
  syncLoopToggleState();
  syncPlayModeAvailability();
  syncStopButtonState();
  syncControlsPanelState();
  syncSynthPanelState();
  syncSynthControlState();
  syncRawPlaybackControlState();
  initializeSharedPresetLibrary();
  drawPlaceholder(getMidiCanvas(), "Derived MIDI timeline appears after processing.");
}

function applyControlConfig() {
  applyRangeConfig(els.gateMultiplier, APP_CONFIG.controls.gateMultiplier);
  applyRangeConfig(els.minNoteMs, APP_CONFIG.controls.minNoteMs);
  applyRangeConfig(els.pitchJumpSplit, APP_CONFIG.controls.pitchJumpSplit);
  applyRangeConfig(els.flutterToleranceMs, APP_CONFIG.controls.flutterToleranceMs);
  applyRangeConfig(els.maxNoteJump, APP_CONFIG.controls.maxNoteJump);
  applyRangeConfig(els.rawPortamentoAmount, APP_CONFIG.controls.rawPortamentoAmount);
  applyRangeConfig(els.rawGravityAmount, APP_CONFIG.controls.rawGravityAmount);
  applyRangeConfig(els.periodicityFloor, APP_CONFIG.controls.periodicityFloor);
  applyRangeConfig(els.onsetSensitivity, APP_CONFIG.controls.onsetSensitivity);
  applyRangeConfig(els.stabilitySensitivity, APP_CONFIG.controls.stabilitySensitivity);
  applyRangeConfig(els.synthFilterCutoff, APP_CONFIG.controls.synthFilterCutoff);
  applyRangeConfig(els.synthFilterQ, APP_CONFIG.controls.synthFilterQ);
  applyRangeConfig(els.synthKeyboardTrackingPct, APP_CONFIG.controls.synthKeyboardTrackingPct);
  applyRangeConfig(els.synthFilterEnvDepth, APP_CONFIG.controls.synthFilterEnvDepth);
  applyRangeConfig(els.synthVoice2Detune, APP_CONFIG.controls.synthVoice2Detune);
  applyRangeConfig(els.synthVoice2Mix, APP_CONFIG.controls.synthVoice2Mix);
  applyRangeConfig(els.synthOutputGain, APP_CONFIG.controls.synthOutputGain);
  applyRangeConfig(els.synthAttackMs, APP_CONFIG.controls.synthAttackMs);
  applyRangeConfig(els.synthDecayMs, APP_CONFIG.controls.synthDecayMs);
  applyRangeConfig(els.synthSustainPct, APP_CONFIG.controls.synthSustainPct);
  applyRangeConfig(els.synthReleaseMs, APP_CONFIG.controls.synthReleaseMs);
  applyRangeConfig(els.ampAttackMs, APP_CONFIG.controls.ampAttackMs);
  applyRangeConfig(els.ampDecayMs, APP_CONFIG.controls.ampDecayMs);
  applyRangeConfig(els.ampSustainPct, APP_CONFIG.controls.ampSustainPct);
  applyRangeConfig(els.ampReleaseMs, APP_CONFIG.controls.ampReleaseMs);
  els.noteDerivation.value = APP_CONFIG.detection.rawPitchReducer;
  els.pitchFrontendModel.value = APP_CONFIG.analysis.pitchFrontend.defaultModel;
  els.pitchUseViterbi.checked = APP_CONFIG.analysis.pitchFrontend.defaultUseViterbi;
  els.continuousDynamics.checked = DEFAULT_CONTINUOUS_DYNAMICS;
  els.rawPortamentoEnabled.checked = DEFAULT_RAW_PORTAMENTO_ENABLED;
  els.rawGravityEnabled.checked = DEFAULT_RAW_GRAVITY_ENABLED;
  els.synthOscillator.value = APP_CONFIG.playback.synth.oscillator;
  els.synthFilterType.value = APP_CONFIG.playback.synth.filterType;
  els.synthVoice2Enabled.checked = APP_CONFIG.playback.synth.voice2Enabled;
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
  autoOption.textContent = "Auto Detect (Major Key)";
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

function populatePresetControls() {
  if (!els.presetSelect) {
    return;
  }
  els.presetSelect.innerHTML = "";
}

function wireEvents() {
  els.startBtn.addEventListener("click", startRecording);
  els.stopBtn.addEventListener("click", handleStopButtonPress);
  els.playSelectedBtn.addEventListener("click", () => playSelectedMode(false));
  els.loopToggleBtn.addEventListener("click", toggleLoopPlayback);
  for (const radio of els.playbackModeRadios) {
    radio.addEventListener("change", syncPlayModeAvailability);
  }
  els.playScaleBtn.addEventListener("click", playSelectedScale);
  els.toggleControlsBtn.addEventListener("click", toggleControlsPanel);
  els.toggleSynthPanelBtn.addEventListener("click", toggleSynthPanel);
  els.resetDefaultsBtn.addEventListener("click", resetAllControlsToDefaults);
  if (els.presetSelect) {
    els.presetSelect.addEventListener("change", onPresetSelectChanged);
  }
  els.synthTestBtn.addEventListener("pointerdown", handleSynthTestPointerDown);
  els.synthTestBtn.addEventListener("pointerup", handleSynthTestPointerUp);
  els.synthTestBtn.addEventListener("pointercancel", handleSynthTestPointerUp);
  els.synthTestBtn.addEventListener("pointerleave", handleSynthTestPointerLeave);
  els.synthTestBtn.addEventListener("keydown", handleSynthTestKeyDown);
  els.synthTestBtn.addEventListener("keyup", handleSynthTestKeyUp);

  els.gateMultiplier.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivationAndRefreshPlayback();
  });
  els.minNoteMs.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivationAndRefreshPlayback();
  });
  els.pitchJumpSplit.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivationAndRefreshPlayback();
  });
  els.flutterToleranceMs.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivationAndRefreshPlayback();
  });
  els.maxNoteJump.addEventListener("input", () => {
    syncControlLabels();
    rerunDerivationAndRefreshPlayback();
  });
  els.rawPortamentoEnabled.addEventListener("change", () => {
    syncRawPlaybackControlState();
    syncControlLabels();
    renderMidiTimeline();
    schedulePlaybackRefresh();
  });
  els.rawPortamentoAmount.addEventListener("input", () => {
    syncControlLabels();
    renderMidiTimeline();
    schedulePlaybackRefresh();
  });
  els.rawGravityEnabled.addEventListener("change", () => {
    syncRawPlaybackControlState();
    syncControlLabels();
    renderMidiTimeline();
    schedulePlaybackRefresh();
  });
  els.rawGravityAmount.addEventListener("input", () => {
    syncControlLabels();
    renderMidiTimeline();
    schedulePlaybackRefresh();
  });
  els.pitchFrontendModel.addEventListener("change", () => {
    syncControlLabels();
    rerunPitchAnalysisAndRefreshPlayback().catch((error) => reportPitchAnalysisError("Pitch analysis error", error));
  });
  els.pitchUseViterbi.addEventListener("change", () => {
    rerunPitchAnalysisAndRefreshPlayback().catch((error) => reportPitchAnalysisError("Pitch analysis error", error));
  });
  bindPitchFrontendSlider(els.periodicityFloor);
  bindPitchFrontendSlider(els.onsetSensitivity);
  bindPitchFrontendSlider(els.stabilitySensitivity);
  bindSynthSlider(els.synthFilterCutoff);
  bindSynthSlider(els.synthFilterQ);
  bindSynthSlider(els.synthKeyboardTrackingPct);
  bindSynthSlider(els.synthFilterEnvDepth);
  bindSynthSlider(els.synthVoice2Detune);
  bindSynthSlider(els.synthVoice2Mix);
  bindSynthSlider(els.synthOutputGain);
  bindSynthSlider(els.synthAttackMs);
  bindSynthSlider(els.synthDecayMs);
  bindSynthSlider(els.synthSustainPct);
  bindSynthSlider(els.synthReleaseMs);
  bindSynthSlider(els.ampAttackMs);
  bindSynthSlider(els.ampDecayMs);
  bindSynthSlider(els.ampSustainPct);
  bindSynthSlider(els.ampReleaseMs);
  els.synthOscillator.addEventListener("change", () => {
    syncControlLabels();
    schedulePlaybackRefresh();
  });
  els.synthFilterType.addEventListener("change", () => {
    syncSynthControlState();
    syncControlLabels();
    schedulePlaybackRefresh();
  });
  els.synthVoice2Enabled.addEventListener("change", () => {
    syncSynthControlState();
    syncControlLabels();
    schedulePlaybackRefresh();
  });
  els.continuousDynamics.addEventListener("change", () => {
    syncSynthControlState();
    syncControlLabels();
    schedulePlaybackRefresh();
  });
  els.noteDerivation.addEventListener("change", rerunDerivationAndRefreshPlayback);
  els.scaleRoot.addEventListener("change", rerunDerivationAndRefreshPlayback);
  els.scaleMode.addEventListener("change", () => {
    syncScaleControlState();
    rerunDerivationAndRefreshPlayback();
  });
}

function syncControlLabels() {
  els.gateMultiplierValue.textContent = Number(els.gateMultiplier.value).toFixed(1);
  els.minNoteMsValue.textContent = String(Number(els.minNoteMs.value));
  els.pitchJumpSplitValue.textContent = Number(els.pitchJumpSplit.value).toFixed(1);
  els.flutterToleranceMsValue.textContent = String(Math.round(Number(els.flutterToleranceMs.value)));
  const maxJump = Number(els.maxNoteJump.value);
  els.maxNoteJumpValue.textContent = maxJump <= 0 ? "off" : maxJump.toFixed(1);
  els.rawPortamentoAmountValue.textContent = `${Math.round(Number(els.rawPortamentoAmount.value))}%`;
  els.rawGravityAmountValue.textContent = `${Math.round(Number(els.rawGravityAmount.value))}%`;
  els.periodicityFloorValue.textContent = Number(els.periodicityFloor.value).toFixed(2);
  els.onsetSensitivityValue.textContent = Number(els.onsetSensitivity.value).toFixed(2);
  els.stabilitySensitivityValue.textContent = Number(els.stabilitySensitivity.value).toFixed(2);
  els.synthFilterCutoffValue.textContent = `${Math.round(Number(els.synthFilterCutoff.value))} Hz`;
  els.synthFilterQValue.textContent = Number(els.synthFilterQ.value).toFixed(1);
  els.synthKeyboardTrackingPctValue.textContent = `${Math.round(Number(els.synthKeyboardTrackingPct.value))}%`;
  els.synthFilterEnvDepthValue.textContent = `${Number(els.synthFilterEnvDepth.value).toFixed(2)} oct`;
  const voice2Detune = Math.round(Number(els.synthVoice2Detune.value));
  els.synthVoice2DetuneValue.textContent = `${voice2Detune >= 0 ? "+" : ""}${voice2Detune}`;
  els.synthVoice2MixValue.textContent = `${Math.round(Number(els.synthVoice2Mix.value))}%`;
  els.synthOutputGainValue.textContent = `${Math.round(Number(els.synthOutputGain.value))}%`;
  els.synthAttackMsValue.textContent = String(Math.round(Number(els.synthAttackMs.value)));
  els.synthDecayMsValue.textContent = String(Math.round(Number(els.synthDecayMs.value)));
  els.synthSustainPctValue.textContent = `${Math.round(Number(els.synthSustainPct.value))}%`;
  els.synthReleaseMsValue.textContent = String(Math.round(Number(els.synthReleaseMs.value)));
  els.ampAttackMsValue.textContent = String(Math.round(Number(els.ampAttackMs.value)));
  els.ampDecayMsValue.textContent = String(Math.round(Number(els.ampDecayMs.value)));
  els.ampSustainPctValue.textContent = `${Math.round(Number(els.ampSustainPct.value))}%`;
  els.ampReleaseMsValue.textContent = String(Math.round(Number(els.ampReleaseMs.value)));
}

function syncScaleControlState() {
  const autoSelected = getSelectedPlaybackMode() === "auto" && canPlayMode("auto");
  setControlEnabled(els.scaleMode, autoSelected);
  setControlEnabled(els.playScaleBtn, autoSelected);
  setControlEnabled(els.scaleRoot, autoSelected && els.scaleMode.value !== "auto");
}

function toggleControlsPanel() {
  state.controlsCollapsed = !state.controlsCollapsed;
  syncControlsPanelState();
}

function toggleSynthPanel() {
  state.synthPanelCollapsed = !state.synthPanelCollapsed;
  syncSynthPanelState();
}

function syncControlsPanelState() {
  const collapsed = Boolean(state.controlsCollapsed);
  els.selectionPanel.hidden = collapsed;
  els.toggleControlsBtn.textContent = collapsed ? "\u25b8" : "\u25be";
  els.toggleControlsBtn.title = collapsed ? "Expand settings" : "Collapse settings";
  els.toggleControlsBtn.setAttribute("aria-label", collapsed ? "Expand settings" : "Collapse settings");
  els.toggleControlsBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function syncSynthPanelState() {
  const collapsed = Boolean(state.synthPanelCollapsed);
  els.synthSelectionPanel.hidden = collapsed;
  els.toggleSynthPanelBtn.textContent = collapsed ? "\u25b8" : "\u25be";
  els.toggleSynthPanelBtn.title = collapsed ? "Expand synth settings" : "Collapse synth settings";
  els.toggleSynthPanelBtn.setAttribute("aria-label", collapsed ? "Expand synth settings" : "Collapse synth settings");
  els.toggleSynthPanelBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function syncSynthControlState() {
  const voice2Enabled = Boolean(els.synthVoice2Enabled.checked);
  const filterEnabled = els.synthFilterType.value !== "none";
  const ampEnvelopeEnabled = !Boolean(els.continuousDynamics.checked);

  setControlEnabled(els.synthVoice2Detune, voice2Enabled);
  setControlEnabled(els.synthVoice2Mix, voice2Enabled);
  setControlEnabled(els.synthFilterQ, filterEnabled);
  setControlEnabled(els.synthFilterCutoff, filterEnabled);
  setControlEnabled(els.synthKeyboardTrackingPct, filterEnabled);
  setControlEnabled(els.synthFilterEnvDepth, filterEnabled);
  setControlEnabled(els.synthAttackMs, filterEnabled);
  setControlEnabled(els.synthDecayMs, filterEnabled);
  setControlEnabled(els.synthSustainPct, filterEnabled);
  setControlEnabled(els.synthReleaseMs, filterEnabled);
  setControlEnabled(els.ampAttackMs, ampEnvelopeEnabled);
  setControlEnabled(els.ampDecayMs, ampEnvelopeEnabled);
  setControlEnabled(els.ampSustainPct, ampEnvelopeEnabled);
  setControlEnabled(els.ampReleaseMs, ampEnvelopeEnabled);
}

function syncRawPlaybackControlState() {
  const rawSelected = getSelectedPlaybackMode() === "raw" && canPlayMode("raw");
  const portamentoEnabled = rawSelected && Boolean(els.rawPortamentoEnabled.checked);
  const gravityEnabled = rawSelected && Boolean(els.rawGravityEnabled.checked);

  setControlEnabled(els.rawPortamentoEnabled, rawSelected);
  setControlEnabled(els.rawGravityEnabled, rawSelected);
  setControlEnabled(els.rawPortamentoAmount, portamentoEnabled);
  setControlEnabled(els.rawGravityAmount, gravityEnabled);
}

function setControlEnabled(control, enabled) {
  control.disabled = !enabled;
  const label = control.closest("label");
  if (label) {
    label.classList.toggle("control-disabled", !enabled);
  }
}

function toggleLoopPlayback() {
  state.loopPlayback = !state.loopPlayback;
  syncLoopToggleState();
}

function syncLoopToggleState() {
  const active = Boolean(state.loopPlayback);
  els.loopToggleBtn.classList.toggle("loop-active", active);
  els.loopToggleBtn.setAttribute("aria-pressed", active ? "true" : "false");
  els.loopToggleBtn.title = active ? "Loop playback is on" : "Loop playback is off";
}

function getSelectedPlaybackMode() {
  const active = els.playbackModeRadios.find((radio) => radio.checked);
  return active ? active.value : "raw";
}

function canPlayMode(mode) {
  if (mode === "original") {
    return Boolean(state.originalAudioBuffer);
  }
  if (!state.analysis || !state.derived) {
    return false;
  }
  if (mode === "raw" || mode === "auto") {
    return hasContinuousPitchPlayableData();
  }
  return false;
}

function syncPlayModeAvailability() {
  for (const radio of els.playbackModeRadios) {
    radio.disabled = !canPlayMode(radio.value);
    const label = radio.closest("label");
    if (label) {
      label.classList.toggle("control-disabled", radio.disabled);
    }
  }

  let selected = getSelectedPlaybackMode();
  if (!canPlayMode(selected)) {
    const fallback = els.playbackModeRadios.find((radio) => !radio.disabled);
    if (fallback) {
      fallback.checked = true;
      selected = fallback.value;
    }
  }

  const canPlay = canPlayMode(selected);
  const isRecording = Boolean(state.mediaRecorder && state.mediaRecorder.state === "recording");
  els.playSelectedBtn.disabled = isRecording || !canPlay;
  syncScaleControlState();
  syncRawPlaybackControlState();
}

function isPlaybackActive() {
  return Boolean(state.playbackContext && state.playbackContext.state !== "closed");
}

function syncStopButtonState() {
  const isRecording = Boolean(state.mediaRecorder && state.mediaRecorder.state === "recording");
  els.stopBtn.disabled = !isRecording && !isPlaybackActive();
}

function clearPlaybackRefreshTimer() {
  if (state.playbackRefreshTimer) {
    clearTimeout(state.playbackRefreshTimer);
    state.playbackRefreshTimer = null;
  }
}

function clearPitchAnalysisRefreshTimer() {
  if (state.pitchAnalysisRefreshTimer) {
    clearTimeout(state.pitchAnalysisRefreshTimer);
    state.pitchAnalysisRefreshTimer = null;
  }
}

function abortInFlightPitchAnalysisRequest() {
  if (!state.pitchAnalysisAbortController) {
    return;
  }
  state.pitchAnalysisAbortController.abort();
  state.pitchAnalysisAbortController = null;
}

function beginPitchAnalysisRun() {
  clearPitchAnalysisRefreshTimer();
  abortInFlightPitchAnalysisRequest();
  return ++state.pitchAnalysisRequestId;
}

function isSupersededPitchAnalysisRun(requestId) {
  return requestId !== state.pitchAnalysisRequestId;
}

function isPitchAnalysisAbortError(error) {
  return Boolean(error && typeof error === "object" && error.name === "AbortError");
}

function reportPitchAnalysisError(prefix, error) {
  if (isPitchAnalysisAbortError(error)) {
    return;
  }
  const detail = error && error.message ? error.message : String(error);
  setStatus(`${prefix}: ${detail}`);
}

function schedulePlaybackRefresh() {
  if (!isPlaybackActive()) {
    return;
  }
  if (state.synthTestVoice || state.synthTestReleaseTimer) {
    return;
  }
  const selectedMode = getSelectedPlaybackMode();
  if (selectedMode === "original" || !canPlayMode(selectedMode)) {
    return;
  }
  clearPlaybackRefreshTimer();
  const debounceMs = Math.max(0, Math.round(APP_CONFIG.playback.liveRefreshDebounceMs || 0));
  state.playbackRefreshTimer = setTimeout(() => {
    state.playbackRefreshTimer = null;
    if (!isPlaybackActive()) {
      return;
    }
    const liveMode = getSelectedPlaybackMode();
    if (liveMode === "original" || !canPlayMode(liveMode)) {
      return;
    }
    playSelectedMode(true);
  }, debounceMs);
}

function schedulePitchAnalysisRefresh() {
  if (!state.analysis) {
    return;
  }
  clearPitchAnalysisRefreshTimer();
  const debounceMs = Math.max(0, Math.round(APP_CONFIG.playback.liveRefreshDebounceMs || 0));
  state.pitchAnalysisRefreshTimer = setTimeout(() => {
    state.pitchAnalysisRefreshTimer = null;
    rerunPitchAnalysis({ suppressStatus: true })
      .then(() => schedulePlaybackRefresh())
      .catch((error) => reportPitchAnalysisError("Pitch analysis error", error));
  }, debounceMs);
}

function bindPitchFrontendSlider(input) {
  input.addEventListener("input", () => {
    syncControlLabels();
    schedulePitchAnalysisRefresh();
  });
  input.addEventListener("change", () => {
    rerunPitchAnalysisAndRefreshPlayback().catch((error) => reportPitchAnalysisError("Pitch analysis error", error));
  });
}

function bindSynthSlider(input) {
  input.addEventListener("input", () => {
    syncControlLabels();
    schedulePlaybackRefresh();
  });
  input.addEventListener("change", schedulePlaybackRefresh);
}

async function initializeSharedPresetLibrary() {
  if (!els.presetSelect) {
    return;
  }
  try {
    const response = await fetch(SHARED_PRESET_MANIFEST_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const manifest = await response.json();
    const entries = Array.isArray(manifest.presets) ? manifest.presets : [];
    state.presetManifest = entries.filter((entry) =>
      entry &&
      typeof entry.id === "string" &&
      entry.id.trim() &&
      typeof entry.file === "string" &&
      entry.file.trim()
    );
    state.presetCache = {};
    populatePresetSelectFromManifest();
  } catch (_) {
    state.presetManifest = [];
    state.presetCache = {};
    populatePresetControls();
  }
}

function populatePresetSelectFromManifest() {
  populatePresetControls();
  if (!els.presetSelect) {
    return;
  }
  for (const entry of state.presetManifest) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name || entry.id;
    els.presetSelect.appendChild(option);
  }
  if (!state.presetManifest.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No Shared Presets";
    els.presetSelect.appendChild(empty);
    els.presetSelect.value = "";
    return;
  }

  const preferred =
    state.presetManifest.find((entry) => entry.id === "factory-default") ||
    state.presetManifest[0];
  if (preferred) {
    els.presetSelect.value = preferred.id;
    applySelectedSharedPreset({ suppressStatus: true }).catch(() => {});
  }
}

function onPresetSelectChanged() {
  if (!els.presetSelect || !els.presetSelect.value) {
    return;
  }
  applySelectedSharedPreset();
}

async function applySelectedSharedPreset(options = {}) {
  if (!els.presetSelect) {
    return;
  }
  const suppressStatus = Boolean(options && options.suppressStatus);
  const presetId = els.presetSelect.value;
  if (!presetId) {
    if (!suppressStatus) {
      setStatus("Select a shared preset to apply.");
    }
    return;
  }
  const entry = state.presetManifest.find((item) => item.id === presetId);
  if (!entry) {
    if (!suppressStatus) {
      setStatus("Selected preset is not available in the manifest.");
    }
    return;
  }
  try {
    const preset = await loadSharedPreset(entry);
    applyPresetPayloadToUi(preset);
    if (!suppressStatus) {
      setStatus(`Applied preset: ${preset.name}`);
    }
  } catch (error) {
    setStatus(`Preset load error: ${error.message}`);
  }
}

async function loadSharedPreset(entry) {
  const cacheKey = entry.id;
  if (state.presetCache[cacheKey]) {
    return state.presetCache[cacheKey];
  }
  const response = await fetch(entry.file, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${entry.file} returned HTTP ${response.status}`);
  }
  const raw = await response.json();
  const preset = normalizePresetPayload(raw, entry.name || entry.id);
  state.presetCache[cacheKey] = preset;
  return preset;
}

function normalizePresetPayload(raw, fallbackName) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Preset file is not a valid JSON object.");
  }
  const settings = raw.settings && typeof raw.settings === "object"
    ? raw.settings
    : null;
  if (!settings) {
    throw new Error("Preset JSON must include a settings object.");
  }
  const schemaVersion = Number(raw.schemaVersion) || PRESET_SCHEMA_VERSION;
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : (fallbackName || "Preset");
  return { schemaVersion, name, settings };
}

function applyPresetPayloadToUi(preset) {
  if (!preset || !preset.settings || typeof preset.settings !== "object") {
    return;
  }
  const settings = preset.settings;
  const requestedPlayMode = typeof settings.playMode === "string" ? settings.playMode : "";
  const legacyBendSmoothing = Number(settings.bendSmoothing);
  for (const spec of PRESET_CONTROL_SPECS) {
    if (!(spec.id in settings)) {
      continue;
    }
    const control = els[spec.id];
    if (!control) {
      continue;
    }
    const value = settings[spec.id];
    if (spec.type === "boolean") {
      control.checked = Boolean(value);
      continue;
    }
    if (spec.type === "number") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        control.value = String(numeric);
      }
      continue;
    }
    const textValue = String(value);
    if (control instanceof HTMLSelectElement) {
      if (Array.from(control.options).some((opt) => opt.value === textValue)) {
        control.value = textValue;
      }
    } else {
      control.value = textValue;
    }
  }

  if (!("rawPortamentoAmount" in settings) && Number.isFinite(legacyBendSmoothing)) {
    els.rawPortamentoAmount.value = String(legacyBendSmoothing);
  }
  if (!("flutterToleranceMs" in settings)) {
    els.flutterToleranceMs.value = String(APP_CONFIG.controls.flutterToleranceMs.defaultValue);
  }
  if (!("rawGravityAmount" in settings) && Number.isFinite(legacyBendSmoothing)) {
    els.rawGravityAmount.value = String(legacyBendSmoothing);
  }
  if (!("rawPortamentoEnabled" in settings) && Number.isFinite(legacyBendSmoothing)) {
    els.rawPortamentoEnabled.checked = legacyBendSmoothing > 0;
  }
  if (!("rawGravityEnabled" in settings) && Number.isFinite(legacyBendSmoothing)) {
    els.rawGravityEnabled.checked = requestedPlayMode === "rawBend" && legacyBendSmoothing > 0;
  }

  const normalizedPlayMode = requestedPlayMode === "rawBend" ? "raw" : requestedPlayMode;
  if (PRESET_PLAY_MODES.includes(normalizedPlayMode)) {
    const radio = els.playbackModeRadios.find((item) => item.value === normalizedPlayMode);
    if (radio) {
      radio.checked = true;
    }
  }

  syncScaleControlState();
  syncSynthControlState();
  syncControlLabels();
  syncPlayModeAvailability();

  if (state.analysis) {
    rerunPitchAnalysis({ suppressStatus: true }).catch((error) => reportPitchAnalysisError("Pitch analysis error", error));
  }
  if (isPlaybackActive()) {
    schedulePlaybackRefresh();
  }
}

async function resetAllControlsToDefaults() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    setStatus("Stop recording before resetting defaults.");
    return;
  }

  clearPitchAnalysisRefreshTimer();
  stopPlayback();
  applyControlConfig();
  els.scaleRoot.value = String(APP_CONFIG.autotune.defaultRoot);
  els.scaleMode.value = APP_CONFIG.autotune.defaultModeId;
  state.autotuneConfig = {
    keyRoot: APP_CONFIG.autotune.defaultRoot,
    modeId: APP_CONFIG.autotune.defaultModeId
  };
  const rawModeRadio = els.playbackModeRadios.find((radio) => radio.value === "raw");
  if (rawModeRadio) {
    rawModeRadio.checked = true;
  }

  syncScaleControlState();
  syncSynthControlState();
  syncControlLabels();
  syncPlayModeAvailability();

  if (!state.analysis) {
    setStatus("Defaults restored.");
    return;
  }

  try {
    const requestId = beginPitchAnalysisRun();
    const previousAnalysis = state.analysis;
    const { samples, sampleRate } = previousAnalysis;
    const nextAnalysisResult = await analyzeSamplesWithCurrentPitchSettings(samples, sampleRate, previousAnalysis);
    if (isSupersededPitchAnalysisRun(requestId)) {
      return;
    }
    state.analysis = nextAnalysisResult.analysis;
    rerunDerivation();
    setStatus(`Defaults restored. Front end: ${getPitchFrontendLabel(nextAnalysisResult.frontendSettings)}.`);
  } catch (error) {
    reportPitchAnalysisError("Reset error", error);
  }
}

async function startRecording() {
  try {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      return;
    }
    clearPitchAnalysisRefreshTimer();
    clearPlaybackRefreshTimer();
    stopPlayback();

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
    els.playSelectedBtn.disabled = true;
    els.playScaleBtn.disabled = true;
    syncStopButtonState();
  } catch (error) {
    setStatus(`Microphone error: ${error.message}`);
  }
}

function handleStopButtonPress() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    stopRecording();
    return;
  }
  if (isPlaybackActive()) {
    stopPlayback();
    setStatus("Playback stopped.");
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state !== "recording") {
    return;
  }
  state.mediaRecorder.stop();
  syncStopButtonState();
  setStatus("Processing sample...");
}

async function handleRecordingStopped() {
  try {
    const requestId = beginPitchAnalysisRun();
    if (!state.audioContext || state.audioContext.state === "closed") {
      state.audioContext = createAudioContext();
    }

    const blob = new Blob(state.recordedChunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
    const trimmedDecoded = trimAudioBufferTail(decoded, APP_CONFIG.analysis.trimTailMs, state.audioContext);
    state.originalAudioBuffer = trimmedDecoded;
    const monoSamples = toMono(trimmedDecoded);
    const initialAnalysisResult = await analyzeSamplesWithCurrentPitchSettings(monoSamples, trimmedDecoded.sampleRate);
    if (isSupersededPitchAnalysisRun(requestId)) {
      return;
    }
    state.analysis = initialAnalysisResult.analysis;

    rerunDerivation();
    const activeScale = state.derived && state.derived.resolvedScale
      ? formatScaleName(state.derived.resolvedScale.keyRoot, state.derived.resolvedScale.modeId)
      : "n/a";
    setStatus(
      `Processing complete. Pitch cap is ${APP_CONFIG.pitch.maxLabel}. ` +
      `Front end: ${getPitchFrontendLabel(initialAnalysisResult.frontendSettings)}. ` +
      `Active scale: ${activeScale}.`
    );
  } catch (error) {
    if (isPitchAnalysisAbortError(error)) {
      return;
    }
    state.originalAudioBuffer = null;
    setStatus(`Decode/analysis error: ${error.message}`);
  } finally {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
    }
    els.startBtn.disabled = false;
    syncPlayModeAvailability();
    syncStopButtonState();
    els.playScaleBtn.disabled = false;
  }
}

function handleSynthTestPointerDown(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  if (typeof event.currentTarget.setPointerCapture === "function") {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  startSynthTestNote();
}

function handleSynthTestPointerUp(event) {
  if (typeof event.currentTarget.releasePointerCapture === "function") {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (_) {
      // Ignore release failures for non-captured pointers.
    }
  }
  stopSynthTestNote();
}

function handleSynthTestPointerLeave(event) {
  if (event.buttons === 0) {
    stopSynthTestNote();
  }
}

function handleSynthTestKeyDown(event) {
  if (event.repeat) {
    return;
  }
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    startSynthTestNote();
  }
}

function handleSynthTestKeyUp(event) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    stopSynthTestNote();
  }
}

function startSynthTestNote() {
  if (state.synthTestVoice || !els.synthTestBtn) {
    return;
  }
  stopPlayback();

  const ctx = createAudioContext();
  state.playbackContext = ctx;
  const master = createPlaybackChain(ctx);
  const settings = readPlaybackSynthSettingsFromUi();
  const testMidi = 60; // middle C
  const freqHz = midiToHz(testMidi);
  const start = ctx.currentTime + 0.01;
  const peak = 0.3 * settings.outputGain;

  const useFilter = settings.filterType !== "none";
  let voiceFilter = null;
  if (useFilter) {
    voiceFilter = ctx.createBiquadFilter();
    voiceFilter.type = settings.filterType;
    const baseCutoff = resolveFilterCutoffForMidi(settings, testMidi, 180);
    voiceFilter.frequency.setValueAtTime(baseCutoff, start);
    scheduleFilterEnvelope(voiceFilter.frequency, start, start + 30, baseCutoff, settings);
    voiceFilter.Q.value = settings.filterQ;
  }

  const amp = ctx.createGain();
  const ampEnvelope = settings.ampEnvelope || {
    attackSec: 0.01,
    decaySec: 0.1,
    sustainLevel: 0.8,
    releaseSec: 0.12
  };
  const attackEnd = start + ampEnvelope.attackSec;
  const decayEnd = attackEnd + ampEnvelope.decaySec;
  const sustainGain = Math.max(0.0001, peak * ampEnvelope.sustainLevel);
  amp.gain.cancelScheduledValues(start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.linearRampToValueAtTime(Math.max(0.0001, peak), attackEnd);
  amp.gain.linearRampToValueAtTime(sustainGain, decayEnd);

  const oscillators = createOscillatorPair(ctx, freqHz, start, settings);
  for (const osc of oscillators) {
    if (voiceFilter) {
      osc.output.connect(voiceFilter);
    } else {
      osc.output.connect(amp);
    }
    osc.node.start(start);
  }
  if (voiceFilter) {
    voiceFilter.connect(amp);
  }
  amp.connect(master);

  state.synthTestVoice = {
    ctx,
    amp,
    settings,
    oscillators
  };
  els.synthTestBtn.classList.add("is-holding");
  setStatus("Synth test: holding C4.");
  syncStopButtonState();
}

function stopSynthTestNote() {
  const voice = state.synthTestVoice;
  if (!voice) {
    return;
  }
  if (state.synthTestReleaseTimer) {
    clearTimeout(state.synthTestReleaseTimer);
    state.synthTestReleaseTimer = null;
  }

  const now = voice.ctx.currentTime;
  const ampEnvelope = voice.settings.ampEnvelope || {
    attackSec: 0.01,
    decaySec: 0.1,
    sustainLevel: 0.8,
    releaseSec: 0.12
  };
  const releaseSec = Math.max(0.01, ampEnvelope.releaseSec);
  const currentGain = Math.max(0.0001, voice.amp.gain.value);
  voice.amp.gain.cancelScheduledValues(now);
  voice.amp.gain.setValueAtTime(currentGain, now);
  voice.amp.gain.linearRampToValueAtTime(0.0001, now + releaseSec);

  for (const osc of voice.oscillators) {
    osc.node.stop(now + releaseSec + 0.03);
  }

  const testCtx = voice.ctx;
  state.synthTestVoice = null;
  els.synthTestBtn.classList.remove("is-holding");
  state.synthTestReleaseTimer = setTimeout(() => {
    state.synthTestReleaseTimer = null;
    if (state.playbackContext === testCtx && testCtx.state !== "closed") {
      testCtx.close().catch(() => {});
      state.playbackContext = null;
      syncStopButtonState();
      return;
    }
    if (testCtx.state !== "closed") {
      testCtx.close().catch(() => {});
    }
    syncStopButtonState();
  }, Math.max(25, Math.round((releaseSec + 0.05) * 1000)));
}

function rerunDerivationAndRefreshPlayback() {
  rerunDerivation();
  schedulePlaybackRefresh();
}

function rerunDerivation() {
  if (!state.analysis) {
    return;
  }

  state.autotuneConfig = readAutotuneConfigFromUi();
  const noteModelSettings = readNoteModelSettingsFromUi();
  state.derived = buildDerivedNoteModel(state.analysis, noteModelSettings, state.autotuneConfig);
  const { resolvedScale } = state.derived;
  if (state.autotuneConfig.modeId === "auto") {
    els.scaleRoot.value = String(resolvedScale.keyRoot);
  }

  updateStats();
  updateScaleInfo(resolvedScale);
  renderMidiTimeline();
  syncPlayModeAvailability();
}

async function rerunPitchAnalysisAndRefreshPlayback() {
  await rerunPitchAnalysis();
  schedulePlaybackRefresh();
}

async function rerunPitchAnalysis(options = {}) {
  if (!state.analysis) {
    return;
  }

  const suppressStatus = Boolean(options && options.suppressStatus);
  const requestId = beginPitchAnalysisRun();
  const previousAnalysis = state.analysis;
  const { samples, sampleRate } = previousAnalysis;
  const nextAnalysisResult = await analyzeSamplesWithCurrentPitchSettings(samples, sampleRate, previousAnalysis);
  if (isSupersededPitchAnalysisRun(requestId)) {
    return;
  }
  state.analysis = nextAnalysisResult.analysis;
  rerunDerivation();
  if (!suppressStatus) {
    setStatus(`Pitch front end updated: ${getPitchFrontendLabel(nextAnalysisResult.frontendSettings)}.`);
  }
}

async function analyzeSamplesWithCurrentPitchSettings(samples, sampleRate, reuseAnalysis = null) {
  const frontendSettings = readPitchFrontendSettingsFromUi();
  const frontendInput = preparePitchFrontendInput(samples, sampleRate, frontendSettings.targetSampleRate);
  const reusableFrontendTrack = reuseAnalysis && hasReusableFrontendTrack(reuseAnalysis, frontendSettings)
    ? reuseAnalysis.frontendTrack
    : null;
  const frontendTrack = reusableFrontendTrack
    || await requestTorchcrepeFrontendTrack(frontendInput.samples, frontendInput.sampleRate, frontendSettings);
  return {
    frontendSettings,
    analysis: buildAnalysisFromFrontendTrack(
      frontendInput.samples,
      frontendInput.sampleRate,
      frontendTrack,
      frontendSettings,
      reuseAnalysis
    )
  };
}

function readPitchFrontendSettingsFromUi() {
  const defaults = APP_CONFIG.analysis.pitchFrontend;
  return {
    model: els.pitchFrontendModel.value === "full" ? "full" : "tiny",
    useViterbi: Boolean(els.pitchUseViterbi.checked),
    periodicityFloor: sanitizeNumericSetting(
      els.periodicityFloor.value,
      APP_CONFIG.controls.periodicityFloor,
      APP_CONFIG.controls.periodicityFloor.defaultValue
    ),
    onsetSensitivity: sanitizeNumericSetting(
      els.onsetSensitivity.value,
      APP_CONFIG.controls.onsetSensitivity,
      APP_CONFIG.controls.onsetSensitivity.defaultValue
    ),
    stabilitySensitivity: sanitizeNumericSetting(
      els.stabilitySensitivity.value,
      APP_CONFIG.controls.stabilitySensitivity,
      APP_CONFIG.controls.stabilitySensitivity.defaultValue
    ),
    apiPath: defaults.apiPath,
    targetSampleRate: defaults.targetSampleRate,
    hopLength: APP_CONFIG.analysis.pitchHopSize,
    fmin: defaults.fmin,
    fmax: defaults.fmax
  };
}

function getPitchFrontendLabel(frontendSettings) {
  if (!frontendSettings) {
    return "TorchCREPE";
  }
  return frontendSettings.model === "full" ? "TorchCREPE Full" : "TorchCREPE Tiny";
}

function readNoteModelSettingsFromUi() {
  return {
    voicingStrictness: sanitizeNumericSetting(
      els.gateMultiplier.value,
      APP_CONFIG.controls.gateMultiplier,
      APP_CONFIG.controls.gateMultiplier.defaultValue
    ),
    minNoteMs: sanitizeNumericSetting(
      els.minNoteMs.value,
      APP_CONFIG.controls.minNoteMs,
      APP_CONFIG.controls.minNoteMs.defaultValue
    ),
    pitchReducer: sanitizeChoice(
      els.noteDerivation.value,
      ["mean", "median", "tailWeightedMean"],
      APP_CONFIG.detection.rawPitchReducer
    ),
    targetStability: sanitizeNumericSetting(
      els.pitchJumpSplit.value,
      APP_CONFIG.controls.pitchJumpSplit,
      APP_CONFIG.controls.pitchJumpSplit.defaultValue
    ),
    flutterToleranceMs: sanitizeNumericSetting(
      els.flutterToleranceMs.value,
      APP_CONFIG.controls.flutterToleranceMs,
      APP_CONFIG.controls.flutterToleranceMs.defaultValue
    ),
    maxNoteJumpSemitones: sanitizeNumericSetting(
      els.maxNoteJump.value,
      APP_CONFIG.controls.maxNoteJump,
      APP_CONFIG.controls.maxNoteJump.defaultValue
    )
  };
}

function readAutotuneConfigFromUi() {
  const parsedRoot = Number(els.scaleRoot.value);
  const keyRoot = Number.isFinite(parsedRoot)
    ? clamp(parsedRoot, 0, NOTE_NAMES.length - 1)
    : APP_CONFIG.autotune.defaultRoot;
  const modeId = els.scaleMode.value || APP_CONFIG.autotune.defaultModeId;
  return { keyRoot, modeId };
}

function resolveFrameGateThreshold(analysis, voicingStrictness) {
  return analysis.noiseFloor * voicingStrictness + APP_CONFIG.detection.gateOffset;
}

function buildDerivedNoteModel(analysis, noteModelSettings, autotuneConfig) {
  const threshold = resolveFrameGateThreshold(analysis, noteModelSettings.voicingStrictness);
  const segmentation = buildCurrentNoteSegmentation(analysis, threshold, noteModelSettings);
  const rawNotes = deriveNotesFromSegmentation(analysis, segmentation, noteModelSettings);
  const resolvedScale = resolveAutotuneScale(analysis, threshold, autotuneConfig, rawNotes);
  const autoNotes = deriveAutotunedNotes(rawNotes, resolvedScale.keyRoot, resolvedScale.modeId);
  const rawPlaybackTrack = buildThresholdGatedContinuousMidiTrack(analysis, threshold);
  const autoPlaybackTrack = buildAutotunedContinuousMidiTrack(
    analysis,
    { segmentation, resolvedScale },
    rawPlaybackTrack,
    noteModelSettings
  );
  return {
    threshold,
    segmentation,
    rawNotes,
    autoNotes,
    resolvedScale,
    playbackTracks: {
      raw: rawPlaybackTrack,
      auto: autoPlaybackTrack
    }
  };
}

function controlValueToUnitInterval(value, range) {
  if (!range || range.max <= range.min) {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return controlValueToUnitInterval(range.defaultValue, range);
  }
  return clamp((numeric - range.min) / (range.max - range.min), 0, 1);
}

function getVoicingStrictness(noteModelSettings) {
  return controlValueToUnitInterval(
    noteModelSettings ? noteModelSettings.voicingStrictness : APP_CONFIG.controls.gateMultiplier.defaultValue,
    APP_CONFIG.controls.gateMultiplier
  );
}

function getTargetStabilityBias(noteModelSettings) {
  return controlValueToUnitInterval(
    noteModelSettings ? noteModelSettings.targetStability : APP_CONFIG.controls.pitchJumpSplit.defaultValue,
    APP_CONFIG.controls.pitchJumpSplit
  );
}

function getFlutterToleranceMs(noteModelSettings) {
  const numeric = noteModelSettings ? Number(noteModelSettings.flutterToleranceMs) : NaN;
  if (Number.isFinite(numeric)) {
    return Math.max(0, numeric);
  }
  return APP_CONFIG.controls.flutterToleranceMs.defaultValue;
}

function resolveAutotuneScale(analysis, threshold, autotuneConfig, rawNotes) {
  if (autotuneConfig.modeId !== "auto") {
    return {
      keyRoot: autotuneConfig.keyRoot,
      modeId: autotuneConfig.modeId,
      source: "manual",
      confidence: 1
    };
  }
  return detectBestScaleFromFrames(analysis, threshold, rawNotes);
}

function detectBestScaleFromFrames(analysis, threshold, rawNotes) {
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

  const pitchClassHistogram = buildPitchClassHistogram(voicedFrames);
  const cadenceProfile = buildCadenceProfile(rawNotes);

  let best = {
    keyRoot: APP_CONFIG.autotune.defaultRoot,
    score: Number.POSITIVE_INFINITY
  };
  let secondBestScore = Number.POSITIVE_INFINITY;
  const mode = SCALE_BY_ID[AUTO_DETECT_MODE_ID] || SCALE_BY_ID.major;
  const intervals = mode.intervals;

  for (let root = 0; root < NOTE_NAMES.length; root++) {
    const fitError = scaleFitError(voicedFrames, root, intervals);
    const outOfScaleRatio = computeOutOfScaleRatio(pitchClassHistogram, root, intervals);
    const tonicAffinity = computePitchClassAffinity(pitchClassHistogram, root);
    const dominantAffinity = computePitchClassAffinity(pitchClassHistogram, (root + 7) % 12);
    const cadenceAffinity = computeCadenceAffinity(cadenceProfile, root);
    const score =
      fitError +
      outOfScaleRatio * APP_CONFIG.autotune.outOfScalePenaltyWeight -
      tonicAffinity * APP_CONFIG.autotune.tonicBiasWeight -
      dominantAffinity * APP_CONFIG.autotune.dominantBiasWeight -
      cadenceAffinity * APP_CONFIG.autotune.cadenceBiasWeight;
    if (score < best.score) {
      secondBestScore = best.score;
      best = { keyRoot: root, score };
    } else if (score < secondBestScore) {
      secondBestScore = score;
    }
  }

  const baseConfidence = 1 / (1 + Math.max(0, best.score));
  const scoreMargin = secondBestScore - best.score;
  const marginConfidence = clamp(scoreMargin / APP_CONFIG.autotune.confidenceMarginScale, 0, 1);
  const confidence = clamp(baseConfidence * 0.4 + marginConfidence * 0.6, 0, 1);
  return {
    keyRoot: best.keyRoot,
    modeId: AUTO_DETECT_MODE_ID,
    source: "auto",
    confidence
  };
}

function buildPitchClassHistogram(voicedFrames) {
  const bins = new Array(12).fill(0);
  let total = 0;
  for (const frame of voicedFrames) {
    const pitchClass = positiveModulo(Math.round(frame.midi), 12);
    bins[pitchClass] += frame.weight;
    total += frame.weight;
  }
  if (total <= 0) {
    return bins;
  }
  for (let i = 0; i < bins.length; i++) {
    bins[i] /= total;
  }
  return bins;
}

function computeOutOfScaleRatio(histogram, keyRoot, intervals) {
  const inScale = new Set(intervals.map((step) => positiveModulo(keyRoot + step, 12)));
  let out = 0;
  for (let pitchClass = 0; pitchClass < 12; pitchClass++) {
    if (!inScale.has(pitchClass)) {
      out += histogram[pitchClass];
    }
  }
  return out;
}

function computePitchClassAffinity(histogram, pitchClass) {
  return histogram[positiveModulo(pitchClass, 12)] || 0;
}

function buildCadenceProfile(rawNotes) {
  if (!rawNotes || !rawNotes.length) {
    return null;
  }
  const first = rawNotes[0];
  const last = rawNotes[rawNotes.length - 1];
  const endWeights = new Array(12).fill(0);
  let endTotal = 0;
  const windowCount = Math.min(3, rawNotes.length);
  for (let i = rawNotes.length - windowCount; i < rawNotes.length; i++) {
    const note = rawNotes[i];
    const pitchClass = positiveModulo(Math.round(note.rawMidi), 12);
    const weight = Math.max(0.05, note.end - note.start);
    endWeights[pitchClass] += weight;
    endTotal += weight;
  }
  if (endTotal > 0) {
    for (let i = 0; i < endWeights.length; i++) {
      endWeights[i] /= endTotal;
    }
  }
  return {
    firstPc: positiveModulo(Math.round(first.rawMidi), 12),
    finalPc: positiveModulo(Math.round(last.rawMidi), 12),
    endWeights
  };
}

function computeCadenceAffinity(cadenceProfile, keyRoot) {
  if (!cadenceProfile) {
    return 0;
  }
  const startCloseness = 1 - pitchClassDistance(cadenceProfile.firstPc, keyRoot) / 6;
  const finalCloseness = 1 - pitchClassDistance(cadenceProfile.finalPc, keyRoot) / 6;
  const endClusterAffinity = cadenceProfile.endWeights[positiveModulo(keyRoot, 12)] || 0;
  return startCloseness * 0.15 + finalCloseness * 0.6 + endClusterAffinity * 0.25;
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

function pitchClassDistance(pcA, pcB) {
  const diff = Math.abs(positiveModulo(pcA - pcB, 12));
  return Math.min(diff, 12 - diff);
}

function hasReusableFrontendTrack(reuseAnalysis, frontendSettings) {
  if (!reuseAnalysis || !reuseAnalysis.frontendTrack || !reuseAnalysis.frontendTrack.settings) {
    return false;
  }
  const settings = reuseAnalysis.frontendTrack.settings;
  return settings.model === frontendSettings.model
    && settings.useViterbi === frontendSettings.useViterbi
    && settings.sampleRate === frontendSettings.targetSampleRate
    && settings.hopLength === frontendSettings.hopLength
    && settings.fmin === frontendSettings.fmin
    && settings.fmax === frontendSettings.fmax;
}

async function requestTorchcrepeFrontendTrack(samples, sampleRate, frontendSettings) {
  const params = new URLSearchParams({
    sample_rate: String(sampleRate),
    hop_length: String(frontendSettings.hopLength),
    fmin: String(frontendSettings.fmin),
    fmax: String(frontendSettings.fmax),
    model: frontendSettings.model,
    viterbi: frontendSettings.useViterbi ? "1" : "0",
    pad: "1"
  });
  const body = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength);
  const abortController = new AbortController();
  const previousController = state.pitchAnalysisAbortController;
  state.pitchAnalysisAbortController = abortController;
  if (previousController) {
    previousController.abort();
  }

  let response = null;
  let payload = null;
  try {
    response = await fetch(`${frontendSettings.apiPath}?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream"
      },
      body,
      signal: abortController.signal
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (isPitchAnalysisAbortError(error)) {
        throw error;
      }
      payload = null;
    }
  } catch (error) {
    if (isPitchAnalysisAbortError(error)) {
      throw error;
    }
    throw new Error("TorchCREPE backend is unavailable. Run `python server.py` from the repo root.");
  } finally {
    if (state.pitchAnalysisAbortController === abortController) {
      state.pitchAnalysisAbortController = null;
    }
  }
  if (!response.ok) {
    const detail = payload && payload.detail ? ` ${payload.detail}` : "";
    throw new Error(`TorchCREPE backend error (HTTP ${response.status}).${detail}`);
  }
  if (!payload || !Array.isArray(payload.f0Hz) || !Array.isArray(payload.periodicityFrames)) {
    throw new Error("TorchCREPE backend returned an invalid track payload.");
  }

  return {
    frameTimes: payload.frameTimes || [],
    f0Hz: payload.f0Hz,
    periodicityFrames: payload.periodicityFrames,
    settings: {
      model: frontendSettings.model,
      useViterbi: frontendSettings.useViterbi,
      sampleRate,
      hopLength: frontendSettings.hopLength,
      fmin: frontendSettings.fmin,
      fmax: frontendSettings.fmax
    },
    frontend: payload.frontend || null
  };
}

function preparePitchFrontendInput(samples, sampleRate, targetSampleRate) {
  const sourceRate = Number(sampleRate);
  const desiredRate = Number(targetSampleRate);
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    return { samples, sampleRate };
  }
  if (!Number.isFinite(desiredRate) || desiredRate <= 0 || desiredRate >= sourceRate) {
    return { samples, sampleRate: sourceRate };
  }
  return {
    samples: resampleLinear(samples, sourceRate, desiredRate),
    sampleRate: desiredRate
  };
}

function resampleLinear(samples, sourceRate, targetRate) {
  const ratio = sourceRate / targetRate;
  const sourceLength = samples.length;
  const targetLength = Math.max(1, Math.round(sourceLength / ratio));
  const output = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const left = samples[Math.min(index, sourceLength - 1)];
    const right = samples[Math.min(index + 1, sourceLength - 1)];
    output[i] = left + (right - left) * frac;
  }
  return output;
}

function buildAnalysisFromFrontendTrack(samples, sampleRate, frontendTrack, frontendSettings, reuseAnalysis) {
  const frameSize = APP_CONFIG.analysis.pitchFrameSize;
  const hopSize = frontendSettings.hopLength;
  const duration = samples.length / sampleRate;
  const frameCount = Array.isArray(frontendTrack.f0Hz) ? frontendTrack.f0Hz.length : 0;
  const frameTimes = normalizeFrontendFrameTimes(
    frontendTrack.frameTimes,
    frameCount,
    hopSize,
    sampleRate,
    duration
  );
  const rmsFrames = computeFramewiseRms(samples, sampleRate, frameTimes, frameSize);
  const noiseFloor = detectNoiseFloor(rmsFrames);
  const featureTracks = buildAnalysisFeatureTracks({
    frameTimes,
    rmsFrames,
    frontendTrack,
    frontendSettings
  });

  return {
    samples,
    sampleRate,
    duration,
    frameSize,
    hopSize,
    frameTimes: featureTracks.frameTimes,
    rmsFrames: featureTracks.rmsFrames,
    f0Hz: featureTracks.f0Hz,
    midiFrames: featureTracks.midiFrames,
    tracks: featureTracks,
    noiseFloor,
    pitchFrontend: featureTracks.pitchFrontend,
    frontendTrack
  };
}

function normalizeFrontendFrameTimes(frameTimes, frameCount, hopSize, sampleRate, duration) {
  if (Array.isArray(frameTimes) && frameTimes.length === frameCount) {
    return frameTimes.map((value, index) => {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return clamp(numeric, 0, duration);
      }
      return clamp((index * hopSize) / sampleRate, 0, duration);
    });
  }
  const normalized = new Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    normalized[i] = clamp((i * hopSize) / sampleRate, 0, duration);
  }
  return normalized;
}

function computeFramewiseRms(samples, sampleRate, frameTimes, frameSize) {
  const halfWindow = Math.max(1, Math.floor(frameSize / 2));
  const rmsFrames = new Array(frameTimes.length).fill(0);
  for (let i = 0; i < frameTimes.length; i++) {
    const centerSample = Math.round(frameTimes[i] * sampleRate);
    const start = clamp(centerSample - halfWindow, 0, Math.max(0, samples.length - 1));
    const end = clamp(centerSample + halfWindow, start + 1, samples.length);
    rmsFrames[i] = computeRms(samples.subarray(start, end));
  }
  return rmsFrames;
}

function buildAnalysisFeatureTracks({ frameTimes, rmsFrames, frontendTrack, frontendSettings }) {
  const rawF0HzFrames = frontendTrack.f0Hz.map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  });
  const rawMidiFrames = rawF0HzFrames.map((value) => (Number.isFinite(value) ? clampPitchMidi(hzToMidi(value)) : null));
  const periodicityFrames = frontendTrack.periodicityFrames.map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? clamp(numeric, 0, 1) : 0;
  });
  const voicedMask = buildContinuousVoicedMask(rawMidiFrames, periodicityFrames, rmsFrames, frontendSettings);
  const midiFrames = buildContinuousMidiTrack(rawMidiFrames, voicedMask, frontendSettings);
  const onsetStrengthFrames = computeOnsetStrengthFrames(rmsFrames, periodicityFrames, frontendSettings);
  const f0SlopeFrames = computeF0SlopeFrames(midiFrames, frameTimes);
  const pitchStabilityFrames = computePitchStabilityFrames(
    midiFrames,
    APP_CONFIG.analysis.segmentation.plateauWindowFrames,
    frontendSettings
  );
  const stablePlateauFrames = computeStablePlateauFrames(
    periodicityFrames,
    onsetStrengthFrames,
    f0SlopeFrames,
    pitchStabilityFrames,
    frontendSettings
  );
  const f0Hz = midiFrames.map((value) => (Number.isFinite(value) ? midiToHz(value) : null));

  return {
    frameTimes,
    rmsFrames,
    f0Hz,
    midiFrames,
    rawF0HzFrames,
    rawMidiFrames,
    periodicityFrames,
    onsetStrengthFrames,
    f0SlopeFrames,
    pitchStabilityFrames,
    stablePlateauFrames,
    pitchFrontend: frontendTrack.frontend || {
      type: "torchcrepe",
      model: frontendSettings.model,
      decoder: frontendSettings.useViterbi ? "viterbi" : "weighted_argmax"
    }
  };
}

function buildContinuousVoicedMask(rawMidiFrames, periodicityFrames, rmsFrames, frontendSettings) {
  return rawMidiFrames.map((value, index) => (
    Number.isFinite(value)
      && periodicityFrames[index] >= frontendSettings.periodicityFloor
      && rmsFrames[index] >= APP_CONFIG.analysis.minFrameEnergy
  ));
}

function buildContinuousMidiTrack(rawMidiFrames, voicedMask, frontendSettings) {
  const midiTrack = rawMidiFrames.map((value, index) => (
    voicedMask[index] && Number.isFinite(value) ? value : null
  ));
  const gateMask = voicedMask.slice();
  fillShortPitchGaps(midiTrack, gateMask, APP_CONFIG.analysis.pitchFrontend.gapFillFrames);
  const validMask = midiTrack.map((value) => Number.isFinite(value));
  return smoothScalarTrackBidirectional(midiTrack, validMask, APP_CONFIG.analysis.pitchFrontend.pitchSmoothAmount);
}

function computeOnsetStrengthFrames(rmsFrames, periodicityFrames, frontendSettings) {
  const logRms = rmsFrames.map((value) => Math.log(value + 1e-7));
  const energyRise = new Array(rmsFrames.length).fill(0);
  const periodicityRise = new Array(rmsFrames.length).fill(0);
  const windowFrames = APP_CONFIG.analysis.segmentation.onsetWindowFrames;
  for (let i = 1; i < rmsFrames.length; i++) {
    const from = Math.max(0, i - windowFrames);
    const history = logRms.slice(from, i);
    const baseline = history.length ? mean(history) : logRms[i - 1];
    energyRise[i] = Math.max(0, logRms[i] - baseline);
    periodicityRise[i] = Math.max(0, periodicityFrames[i] - periodicityFrames[i - 1]);
  }
  const energyScale = Math.max(1e-6, percentile(energyRise.filter((value) => value > 0), 0.95));
  const periodicityScale = Math.max(1e-6, percentile(periodicityRise.filter((value) => value > 0), 0.95));
  return energyRise.map((value, index) => {
    const energyComponent = clamp(value / energyScale, 0, 1);
    const periodicityComponent = clamp(periodicityRise[index] / periodicityScale, 0, 1);
    const mix = energyComponent * (0.45 + frontendSettings.onsetSensitivity * 0.35)
      + periodicityComponent * 0.25;
    return clamp(mix, 0, 1);
  });
}

function computeF0SlopeFrames(midiFrames, frameTimes) {
  const slopes = new Array(midiFrames.length).fill(0);
  for (let i = 1; i < midiFrames.length; i++) {
    const previous = midiFrames[i - 1];
    const current = midiFrames[i];
    if (!Number.isFinite(previous) || !Number.isFinite(current)) {
      continue;
    }
    const dt = Math.max(1e-4, frameTimes[i] - frameTimes[i - 1]);
    slopes[i] = Math.abs(current - previous) / dt;
  }
  const slopeScale = Math.max(1e-6, percentile(slopes.filter((value) => value > 0), 0.9) || 12);
  return slopes.map((value) => clamp(value / Math.max(12, slopeScale), 0, 1));
}

function computePitchStabilityFrames(midiFrames, windowFrames, frontendSettings) {
  const frames = new Array(midiFrames.length).fill(0);
  const tolerance = 0.18 + (1 - frontendSettings.stabilitySensitivity) * 1.2;
  for (let i = 0; i < midiFrames.length; i++) {
    const values = [];
    for (let j = Math.max(0, i - windowFrames); j <= Math.min(midiFrames.length - 1, i + windowFrames); j++) {
      if (Number.isFinite(midiFrames[j])) {
        values.push(midiFrames[j]);
      }
    }
    if (!values.length) {
      continue;
    }
    const center = median(values);
    const deviation = values.map((value) => Math.abs(value - center));
    const mad = median(deviation);
    frames[i] = 1 - clamp(mad / Math.max(0.05, tolerance), 0, 1);
  }
  return frames;
}

function computeStablePlateauFrames(periodicityFrames, onsetStrengthFrames, f0SlopeFrames, pitchStabilityFrames, frontendSettings) {
  return periodicityFrames.map((value, index) => {
    const periodicitySupport = clamp(
      (value - frontendSettings.periodicityFloor) / Math.max(0.05, 1 - frontendSettings.periodicityFloor),
      0,
      1
    );
    return clamp(
      periodicitySupport
        * pitchStabilityFrames[index]
        * (1 - f0SlopeFrames[index] * 0.85)
        * (1 - onsetStrengthFrames[index] * 0.35),
      0,
      1
    );
  });
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

function buildCurrentNoteSegmentation(analysis, threshold, noteModelSettings) {
  const decoded = decodeTargetNoteStateSequence(analysis, threshold, noteModelSettings);
  const noteRuns = smoothDecodedNoteRuns(
    decoded.runs,
    analysis,
    noteModelSettings,
    decoded.boundaryEvidenceFrames
  );
  return {
    strategy: "soft-evidence-target-note-sequence-decode",
    gateThreshold: threshold,
    boundaryEvidenceFrames: decoded.boundaryEvidenceFrames,
    voicedEvidenceFrames: decoded.voicedEvidenceFrames,
    stateTrack: decoded.stateTrack,
    noteRanges: noteRuns.map((run) => ({
      frameStart: run.frameStart,
      frameEnd: run.frameEnd,
      targetMidi: run.stateMidi
    }))
  };
}

function decodeTargetNoteStateSequence(analysis, threshold, noteModelSettings) {
  const midiFrames = analysis.midiFrames;
  if (!midiFrames.length) {
    return {
      boundaryEvidenceFrames: [],
      voicedEvidenceFrames: [],
      stateTrack: [],
      runs: []
    };
  }
  const periodicityFrames = analysis.tracks.periodicityFrames;
  const onsetStrengthFrames = analysis.tracks.onsetStrengthFrames;
  const f0SlopeFrames = analysis.tracks.f0SlopeFrames;
  const stablePlateauFrames = analysis.tracks.stablePlateauFrames;
  const energySupportFrames = computeEnergySupportFrames(analysis.rmsFrames, noteModelSettings);
  const voicedEvidenceFrames = computeVoicedEvidenceFrames(periodicityFrames, energySupportFrames);
  const boundaryEvidenceFrames = buildBoundaryEvidenceFrames(
    periodicityFrames,
    onsetStrengthFrames,
    f0SlopeFrames,
    stablePlateauFrames,
    noteModelSettings
  );
  const stateValues = [null];
  for (let midi = APP_CONFIG.pitch.minMidi; midi <= APP_CONFIG.pitch.maxMidi; midi++) {
    stateValues.push(midi);
  }

  const frameCount = midiFrames.length;
  const backPointers = Array.from({ length: frameCount }, () => new Int16Array(stateValues.length));
  let prevCosts = new Float64Array(stateValues.length).fill(Number.POSITIVE_INFINITY);
  for (let stateIndex = 0; stateIndex < stateValues.length; stateIndex++) {
    prevCosts[stateIndex] = computeSequenceEmissionCost(
      midiFrames[0],
      stateValues[stateIndex],
      voicedEvidenceFrames[0],
      stablePlateauFrames[0],
      f0SlopeFrames[0]
    );
  }

  for (let frameIndex = 1; frameIndex < frameCount; frameIndex++) {
    const nextCosts = new Float64Array(stateValues.length).fill(Number.POSITIVE_INFINITY);
    const boundaryEvidence = boundaryEvidenceFrames[frameIndex];
    const plateauStrength = stablePlateauFrames[frameIndex];
    for (let stateIndex = 0; stateIndex < stateValues.length; stateIndex++) {
      const stateMidi = stateValues[stateIndex];
      const emissionCost = computeSequenceEmissionCost(
        midiFrames[frameIndex],
        stateMidi,
        voicedEvidenceFrames[frameIndex],
        plateauStrength,
        f0SlopeFrames[frameIndex]
      );
      let bestCost = Number.POSITIVE_INFINITY;
      let bestPrevIndex = 0;
      for (let prevIndex = 0; prevIndex < stateValues.length; prevIndex++) {
        const transitionCost = computeSequenceTransitionCost(
          stateValues[prevIndex],
          stateMidi,
          boundaryEvidence,
          plateauStrength,
          noteModelSettings
        );
        const candidateCost = prevCosts[prevIndex] + transitionCost + emissionCost;
        if (candidateCost < bestCost) {
          bestCost = candidateCost;
          bestPrevIndex = prevIndex;
        }
      }
      nextCosts[stateIndex] = bestCost;
      backPointers[frameIndex][stateIndex] = bestPrevIndex;
    }
    prevCosts = nextCosts;
  }

  let bestFinalIndex = 0;
  let bestFinalCost = Number.POSITIVE_INFINITY;
  for (let stateIndex = 0; stateIndex < stateValues.length; stateIndex++) {
    if (prevCosts[stateIndex] < bestFinalCost) {
      bestFinalCost = prevCosts[stateIndex];
      bestFinalIndex = stateIndex;
    }
  }

  const stateTrack = new Array(frameCount).fill(null);
  let pointer = bestFinalIndex;
  for (let frameIndex = frameCount - 1; frameIndex >= 0; frameIndex--) {
    stateTrack[frameIndex] = stateValues[pointer];
    if (frameIndex > 0) {
      pointer = backPointers[frameIndex][pointer];
    }
  }

  return {
    boundaryEvidenceFrames,
    voicedEvidenceFrames,
    stateTrack,
    runs: buildDecodedStateRuns(stateTrack)
  };
}

function computeEnergySupportFrames(rmsFrames, noteModelSettings) {
  const strictness = getVoicingStrictness(noteModelSettings);
  const noiseReference = percentile(rmsFrames, 0.18);
  const peakReference = Math.max(noiseReference + 1e-6, percentile(rmsFrames, 0.95));
  const dynamicRange = Math.max(1e-6, peakReference - noiseReference);
  const lowReference = noiseReference + dynamicRange * (0.04 + strictness * 0.16);
  const highReference = noiseReference + dynamicRange * (0.42 + strictness * 0.38);
  return rmsFrames.map((value) => clamp((value - lowReference) / Math.max(1e-6, highReference - lowReference), 0, 1));
}

function computeVoicedEvidenceFrames(periodicityFrames, energySupportFrames) {
  return periodicityFrames.map((value, index) => clamp(value * 0.72 + energySupportFrames[index] * 0.28, 0, 1));
}

function buildBoundaryEvidenceFrames(periodicityFrames, onsetStrengthFrames, f0SlopeFrames, stablePlateauFrames, noteModelSettings) {
  const config = APP_CONFIG.analysis.segmentation;
  const targetStability = getTargetStabilityBias(noteModelSettings);
  const rearticulationEase = 1 - targetStability;
  const onsetWeight = config.onsetWeight * (0.9 + rearticulationEase * 0.35);
  const periodicityDipWeight = config.periodicityDipWeight * (0.75 + rearticulationEase * 0.75);
  const slopeBreakWeight = config.slopeBreakWeight * (0.8 + rearticulationEase * 0.7);
  const plateauLandingWeight = config.plateauLandingWeight * (0.9 + rearticulationEase * 0.5);
  const evidence = new Array(periodicityFrames.length).fill(config.boundaryEvidenceFloor);
  for (let i = 1; i < evidence.length; i++) {
    const periodicityDip = Math.max(0, periodicityFrames[i - 1] - periodicityFrames[i]);
    const plateauLanding = Math.max(0, stablePlateauFrames[i] - stablePlateauFrames[i - 1]);
    const slopeCue = clamp(f0SlopeFrames[i] * (0.9 + rearticulationEase * 1.2), 0, 1);
    evidence[i] = clamp(
      config.boundaryEvidenceFloor +
        onsetStrengthFrames[i] * onsetWeight +
        periodicityDip * periodicityDipWeight +
        slopeCue * slopeBreakWeight +
        plateauLanding * plateauLandingWeight,
      0,
      1
    );
  }
  return evidence;
}

function computeSequenceEmissionCost(observedMidi, stateMidi, voicedEvidence, plateauStrength, slopeStrength) {
  if (stateMidi === null) {
    return voicedEvidence * APP_CONFIG.analysis.segmentation.unvoicedStateBias;
  }
  if (!Number.isFinite(observedMidi)) {
    return 1.8 + voicedEvidence * 0.8;
  }
  const sigma = 0.22 + (1 - voicedEvidence) * 1.35 + slopeStrength * 0.45 + (1 - plateauStrength) * 0.25;
  const distance = observedMidi - stateMidi;
  return (distance * distance) / Math.max(0.08, sigma * sigma) - plateauStrength * 0.06;
}

function computeSequenceTransitionCost(previousStateMidi, nextStateMidi, boundaryEvidence, plateauStrength, noteModelSettings) {
  const config = APP_CONFIG.analysis.segmentation;
  if (previousStateMidi === nextStateMidi) {
    return -plateauStrength * config.stableHoldBonus;
  }
  const targetStability = getTargetStabilityBias(noteModelSettings);
  const rearticulationEase = 1 - targetStability;
  const changeResistance = 1
    + (1 - boundaryEvidence) * (config.boundaryEvidenceWeight + targetStability * 0.6)
    + plateauStrength * (0.35 + targetStability * 0.35);
  if (previousStateMidi === null || nextStateMidi === null) {
    return config.changeBasePenalty * (0.85 + changeResistance * 0.35);
  }
  const delta = Math.abs(nextStateMidi - previousStateMidi);
  const smallMoveReference = 0.18 + targetStability * 1.45;
  const smallMovePenalty = delta < smallMoveReference
    ? (smallMoveReference - delta) * (0.4 + targetStability * 1.1)
    : 0;
  return config.changeBasePenalty * changeResistance
    + delta * config.jumpPenaltyPerSemitone * (0.75 + rearticulationEase * 0.35)
    + smallMovePenalty;
}

function buildDecodedStateRuns(stateTrack) {
  if (!stateTrack.length) {
    return [];
  }
  const runs = [];
  let frameStart = 0;
  let stateMidi = stateTrack[0];
  for (let i = 1; i <= stateTrack.length; i++) {
    const nextState = i < stateTrack.length ? stateTrack[i] : Symbol("end");
    if (nextState === stateMidi) {
      continue;
    }
    runs.push({
      frameStart,
      frameEnd: i - 1,
      stateMidi
    });
    frameStart = i;
    stateMidi = nextState;
  }
  return runs;
}

function smoothDecodedNoteRuns(runs, analysis, noteModelSettings, boundaryEvidenceFrames = []) {
  const working = runs.map((run) => ({ ...run }));
  const minGapMs = noteModelSettings.minNoteMs * 0.55;
  const flutterToleranceMs = getFlutterToleranceMs(noteModelSettings);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < working.length; i++) {
      const run = working[i];
      const durationMs = getFrameRangeDurationMs(analysis, run.frameStart, run.frameEnd);
      if (run.stateMidi === null) {
        if (
          durationMs <= minGapMs &&
          i > 0 &&
          i < working.length - 1 &&
          Number.isFinite(working[i - 1].stateMidi) &&
          Number.isFinite(working[i + 1].stateMidi) &&
          Math.abs(working[i - 1].stateMidi - working[i + 1].stateMidi) <= 1
        ) {
          working[i - 1].frameEnd = working[i + 1].frameEnd;
          working.splice(i, 2);
          changed = true;
          break;
        }
        continue;
      }
      if (
        shouldMergeFlutterExcursion(
          working,
          i,
          analysis,
          noteModelSettings,
          boundaryEvidenceFrames,
          flutterToleranceMs
        )
      ) {
        working[i - 1].frameEnd = working[i + 1].frameEnd;
        working.splice(i, 2);
        changed = true;
        break;
      }
      if (durationMs > noteModelSettings.minNoteMs) {
        continue;
      }
      const prev = i > 0 ? working[i - 1] : null;
      const next = i < working.length - 1 ? working[i + 1] : null;
      if (prev && next && Number.isFinite(prev.stateMidi) && Number.isFinite(next.stateMidi)) {
        if (Math.abs(prev.stateMidi - next.stateMidi) <= 1) {
          prev.frameEnd = next.frameEnd;
          working.splice(i, 2);
        } else if (Math.abs(prev.stateMidi - run.stateMidi) <= Math.abs(next.stateMidi - run.stateMidi)) {
          prev.frameEnd = run.frameEnd;
          working.splice(i, 1);
        } else {
          next.frameStart = run.frameStart;
          working.splice(i, 1);
        }
        changed = true;
        break;
      }
      if (prev && Number.isFinite(prev.stateMidi)) {
        prev.frameEnd = run.frameEnd;
        working.splice(i, 1);
        changed = true;
        break;
      }
      if (next && Number.isFinite(next.stateMidi)) {
        next.frameStart = run.frameStart;
        working.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return working.filter((run) => Number.isFinite(run.stateMidi));
}

function shouldMergeFlutterExcursion(
  working,
  index,
  analysis,
  noteModelSettings,
  boundaryEvidenceFrames,
  flutterToleranceMs
) {
  if (flutterToleranceMs <= 0 || index <= 0 || index >= working.length - 1) {
    return false;
  }
  const run = working[index];
  const prev = working[index - 1];
  const next = working[index + 1];
  if (
    !run
    || !prev
    || !next
    || !Number.isFinite(run.stateMidi)
    || !Number.isFinite(prev.stateMidi)
    || !Number.isFinite(next.stateMidi)
  ) {
    return false;
  }
  const durationMs = getFrameRangeDurationMs(analysis, run.frameStart, run.frameEnd);
  if (durationMs > flutterToleranceMs) {
    return false;
  }
  const returnDistance = Math.abs(prev.stateMidi - next.stateMidi);
  if (returnDistance > 1) {
    return false;
  }
  const excursionSemitones = Math.max(
    Math.abs(run.stateMidi - prev.stateMidi),
    Math.abs(run.stateMidi - next.stateMidi)
  );
  if (excursionSemitones > 1.35) {
    return false;
  }
  const leadInMs = getFrameRangeDurationMs(analysis, prev.frameStart, prev.frameEnd);
  if (leadInMs < Math.max(noteModelSettings.minNoteMs * 0.85, flutterToleranceMs * 0.7)) {
    return false;
  }
  const stableBefore = averageTrackWindow(
    analysis.tracks ? analysis.tracks.stablePlateauFrames : null,
    Math.max(prev.frameStart, run.frameStart - 3),
    Math.max(prev.frameStart, run.frameStart - 1)
  );
  if (stableBefore < 0.48) {
    return false;
  }
  const boundarySupport = Math.max(
    getTrackFrameValue(boundaryEvidenceFrames, run.frameStart),
    getTrackFrameValue(boundaryEvidenceFrames, Math.min(boundaryEvidenceFrames.length - 1, run.frameEnd + 1))
  );
  const onsetSupport = Math.max(
    getTrackFrameValue(analysis.tracks ? analysis.tracks.onsetStrengthFrames : null, run.frameStart),
    getTrackFrameValue(analysis.tracks ? analysis.tracks.onsetStrengthFrames : null, Math.min(analysis.frameTimes.length - 1, run.frameEnd + 1))
  );
  const supportStrength = Math.max(boundarySupport, onsetSupport * 0.92);
  return supportStrength < 0.58;
}

function getTrackFrameValue(track, index) {
  if (!Array.isArray(track) || !track.length || index < 0 || index >= track.length) {
    return 0;
  }
  const value = Number(track[index]);
  return Number.isFinite(value) ? value : 0;
}

function averageTrackWindow(track, startIndex, endIndex) {
  if (!Array.isArray(track) || !track.length || endIndex < startIndex) {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (let i = Math.max(0, startIndex); i <= Math.min(track.length - 1, endIndex); i++) {
    const value = Number(track[i]);
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value;
    count += 1;
  }
  return count ? total / count : 0;
}

function getFrameRangeDurationMs(analysis, frameStart, frameEnd) {
  if (frameEnd < frameStart) {
    return 0;
  }
  const framePad = analysis.hopSize / analysis.sampleRate;
  const start = Math.max(0, analysis.frameTimes[frameStart] - framePad);
  const end = Math.min(analysis.duration, analysis.frameTimes[frameEnd] + framePad);
  return Math.max(0, (end - start) * 1000);
}

function deriveNotesFromSegmentation(analysis, segmentation, noteModelSettings) {
  const notes = [];
  for (const range of segmentation.noteRanges) {
    const note = buildNoteFromFrameRange(
      analysis,
      range.frameStart,
      range.frameEnd,
      noteModelSettings.minNoteMs,
      noteModelSettings.pitchReducer
    );
    if (note) {
      notes.push(note);
    }
  }
  return filterNotesByMaxJump(notes, noteModelSettings.maxNoteJumpSemitones);
}

function filterNotesByMaxJump(notes, maxJumpSemitones) {
  const threshold = Number(maxJumpSemitones) || 0;
  if (threshold <= 0 || notes.length <= 1) {
    return notes;
  }

  const filtered = [notes[0]];
  let lastKeptMidi = notes[0].rawMidi;

  for (let i = 1; i < notes.length; i++) {
    const note = notes[i];
    if (!Number.isFinite(note.rawMidi) || !Number.isFinite(lastKeptMidi)) {
      filtered.push(note);
      lastKeptMidi = note.rawMidi;
      continue;
    }
    if (Math.abs(note.rawMidi - lastKeptMidi) <= threshold) {
      filtered.push(note);
      lastKeptMidi = note.rawMidi;
    }
  }

  return filtered;
}

function buildNoteFromFrameRange(analysis, frameStart, frameEnd, minNoteMs, pitchReducer) {
  if (frameEnd < frameStart) {
    return null;
  }

  const framePad = analysis.hopSize / analysis.sampleRate;
  const start = Math.max(0, analysis.frameTimes[frameStart] - framePad);
  const end = Math.min(analysis.duration, analysis.frameTimes[frameEnd] + framePad);
  const durationMs = (end - start) * 1000;
  if (durationMs < minNoteMs) {
    return null;
  }

  const pitchPool = [];
  for (let i = frameStart; i <= frameEnd; i++) {
    if (Number.isFinite(analysis.midiFrames[i])) {
      pitchPool.push(analysis.midiFrames[i]);
    }
  }

  const rawMidi = pitchPool.length
    ? reducePitchPool(pitchPool, pitchReducer || APP_CONFIG.detection.rawPitchReducer)
    : recoverSegmentMidi(analysis, frameStart, frameEnd);
  if (!Number.isFinite(rawMidi)) {
    return null;
  }

  const clampedRawMidi = clampPitchMidi(rawMidi);
  return {
    start,
    end,
    rawMidi: clampedRawMidi,
    midi: clampedRawMidi,
    frameStart,
    frameEnd
  };
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

function renderMidiTimeline() {
  const canvas = getMidiCanvas();
  if (!canvas) {
    return;
  }
  if (!state.analysis) {
    drawPlaceholder(canvas, "No MIDI data available.");
    return;
  }
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, width, height);

  const rawPlaybackSettings = state.derived ? readRawPlaybackSettingsFromUi() : null;
  const rawPlaybackData = state.derived && state.derived.playbackTracks
    ? buildRawContinuousPlaybackData(state.analysis, state.derived, rawPlaybackSettings)
    : null;
  const autoPlaybackData = state.derived && state.derived.playbackTracks
    ? buildSmoothedContinuousPlaybackData(
      state.analysis,
      state.derived.playbackTracks.auto,
      APP_CONFIG.playback.autoPlayback.smoothingAmount
    )
    : null;
  const bounds = getMidiBounds(
    state.analysis,
    rawPlaybackData ? rawPlaybackData.midiTrack : null,
    autoPlaybackData ? autoPlaybackData.midiTrack : null
  );
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

  const midiFrames = state.analysis.midiFrames;
  ctx.fillStyle = "rgba(92, 195, 255, 0.45)";
  for (let i = 0; i < midiFrames.length; i++) {
    if (!Number.isFinite(midiFrames[i])) {
      continue;
    }
    const x = leftPad + (state.analysis.frameTimes[i] / state.analysis.duration) * innerWidth;
    const y = midiToY(midiFrames[i], minMidi, totalRange, height);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  if (rawPlaybackData) {
    drawMidiTrackPath(ctx, state.analysis, rawPlaybackData.midiTrack, {
      stroke: "rgba(120, 212, 255, 0.92)",
      lineWidth: 2,
      leftPad,
      innerWidth,
      minMidi,
      totalRange,
      height
    });
  }
  if (autoPlaybackData) {
    drawMidiTrackPath(ctx, state.analysis, autoPlaybackData.midiTrack, {
      stroke: "rgba(123, 255, 176, 0.96)",
      lineWidth: 2.35,
      leftPad,
      innerWidth,
      minMidi,
      totalRange,
      height
    });
  }

  ctx.fillStyle = "rgba(209, 242, 234, 0.95)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("raw playback track", leftPad + 10, 8);
  ctx.fillStyle = "rgba(139, 255, 194, 0.95)";
  ctx.fillText("autotuned playback track", leftPad + 128, 8);
  ctx.fillStyle = "rgba(120, 212, 255, 0.95)";
  ctx.fillText("frontend MIDI", leftPad + 310, 8);
}

function drawMidiTrackPath(ctx, analysis, midiTrack, options) {
  const {
    stroke,
    lineWidth,
    leftPad,
    innerWidth,
    minMidi,
    totalRange,
    height
  } = options;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let hasStarted = false;
  for (let i = 0; i < midiTrack.length; i++) {
    const midiValue = midiTrack[i];
    if (!Number.isFinite(midiValue)) {
      hasStarted = false;
      continue;
    }
    const x = leftPad + (analysis.frameTimes[i] / analysis.duration) * innerWidth;
    const y = midiToY(midiValue, minMidi, totalRange, height);
    if (!hasStarted) {
      ctx.moveTo(x, y);
      hasStarted = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function midiToY(midi, minMidi, totalRange, height) {
  const topPad = 22;
  const bottomPad = 8;
  const usable = height - topPad - bottomPad;
  return topPad + (1 - (midi - minMidi) / totalRange) * usable;
}

function getMidiBounds(analysis, ...tracks) {
  let minMidi = Number.POSITIVE_INFINITY;
  let maxMidi = Number.NEGATIVE_INFINITY;

  for (const midi of analysis.midiFrames) {
    if (!Number.isFinite(midi)) {
      continue;
    }
    if (midi < minMidi) minMidi = midi;
    if (midi > maxMidi) maxMidi = midi;
  }

  for (const track of tracks) {
    if (!Array.isArray(track)) {
      continue;
    }
    for (const midi of track) {
      if (Number.isFinite(midi)) {
        if (midi < minMidi) minMidi = midi;
        if (midi > maxMidi) maxMidi = midi;
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

function updateStats() {
  const duration = state.analysis.duration;
  els.durationValue.textContent = `${duration.toFixed(2)} s`;
  els.noiseFloorValue.textContent = state.analysis.noiseFloor.toFixed(4);
  els.thresholdValue.textContent = state.derived.threshold.toFixed(4);
}

function updateScaleInfo(resolvedScale) {
  if (!resolvedScale) {
    els.scaleInfoValue.textContent = "-";
    return;
  }
  const label = formatScaleName(resolvedScale.keyRoot, resolvedScale.modeId);
  if (resolvedScale.source === "auto") {
    const confidenceText = `${Math.round((resolvedScale.confidence || 0) * 100)}%`;
    els.scaleInfoValue.textContent = `Auto: ${label} (${confidenceText})`;
  } else {
    els.scaleInfoValue.textContent = label;
  }
}

function formatScaleName(keyRoot, modeId) {
  const mode = SCALE_BY_ID[modeId] || SCALE_BY_ID.major;
  return `${NOTE_NAMES[keyRoot]} ${mode.label}`;
}

function hasContinuousPitchPlayableData() {
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

function readRawPlaybackSettingsFromUi() {
  const portamentoAmount = sanitizeNumericSetting(
    els.rawPortamentoAmount.value,
    APP_CONFIG.controls.rawPortamentoAmount,
    APP_CONFIG.controls.rawPortamentoAmount.defaultValue
  ) / 100;
  const gravityAmount = sanitizeNumericSetting(
    els.rawGravityAmount.value,
    APP_CONFIG.controls.rawGravityAmount,
    APP_CONFIG.controls.rawGravityAmount.defaultValue
  ) / 100;
  return {
    portamentoEnabled: Boolean(els.rawPortamentoEnabled.checked),
    portamentoAmount: clamp(portamentoAmount, 0, 1),
    gravityEnabled: Boolean(els.rawGravityEnabled.checked),
    gravityAmount: clamp(gravityAmount, 0, 1)
  };
}

function readPlaybackSynthSettingsFromUi() {
  const oscillator = sanitizeChoice(
    els.synthOscillator.value,
    ["sine", "square", "sawtooth", "triangle"],
    APP_CONFIG.playback.synth.oscillator
  );
  const filterType = sanitizeChoice(
    els.synthFilterType.value,
    ["none", "lowpass", "bandpass", "highpass"],
    APP_CONFIG.playback.synth.filterType
  );
  const followOriginalAmplitude = Boolean(els.continuousDynamics.checked);
  const voice2Enabled = Boolean(els.synthVoice2Enabled.checked);
  const detune = sanitizeNumericSetting(
    els.synthVoice2Detune.value,
    APP_CONFIG.controls.synthVoice2Detune,
    APP_CONFIG.controls.synthVoice2Detune.defaultValue
  );
  const voice2Mix = sanitizeNumericSetting(
    els.synthVoice2Mix.value,
    APP_CONFIG.controls.synthVoice2Mix,
    APP_CONFIG.controls.synthVoice2Mix.defaultValue
  ) / 100;
  const outputGain = sanitizeNumericSetting(
    els.synthOutputGain.value,
    APP_CONFIG.controls.synthOutputGain,
    APP_CONFIG.controls.synthOutputGain.defaultValue
  ) / 100;
  const attackSec = sanitizeNumericSetting(
    els.synthAttackMs.value,
    APP_CONFIG.controls.synthAttackMs,
    APP_CONFIG.controls.synthAttackMs.defaultValue
  ) / 1000;
  const decaySec = sanitizeNumericSetting(
    els.synthDecayMs.value,
    APP_CONFIG.controls.synthDecayMs,
    APP_CONFIG.controls.synthDecayMs.defaultValue
  ) / 1000;
  const sustainLevel = sanitizeNumericSetting(
    els.synthSustainPct.value,
    APP_CONFIG.controls.synthSustainPct,
    APP_CONFIG.controls.synthSustainPct.defaultValue
  ) / 100;
  const releaseSec = sanitizeNumericSetting(
    els.synthReleaseMs.value,
    APP_CONFIG.controls.synthReleaseMs,
    APP_CONFIG.controls.synthReleaseMs.defaultValue
  ) / 1000;
  const filterCutoff = sanitizeNumericSetting(
    els.synthFilterCutoff.value,
    APP_CONFIG.controls.synthFilterCutoff,
    APP_CONFIG.controls.synthFilterCutoff.defaultValue
  );
  const filterQ = sanitizeNumericSetting(
    els.synthFilterQ.value,
    APP_CONFIG.controls.synthFilterQ,
    APP_CONFIG.controls.synthFilterQ.defaultValue
  );
  const keyboardTracking = sanitizeNumericSetting(
    els.synthKeyboardTrackingPct.value,
    APP_CONFIG.controls.synthKeyboardTrackingPct,
    APP_CONFIG.controls.synthKeyboardTrackingPct.defaultValue
  ) / 100;
  const filterEnvelopeDepthOctaves = sanitizeNumericSetting(
    els.synthFilterEnvDepth.value,
    APP_CONFIG.controls.synthFilterEnvDepth,
    APP_CONFIG.controls.synthFilterEnvDepth.defaultValue
  );
  const ampAttackSec = sanitizeNumericSetting(
    els.ampAttackMs.value,
    APP_CONFIG.controls.ampAttackMs,
    APP_CONFIG.controls.ampAttackMs.defaultValue
  ) / 1000;
  const ampDecaySec = sanitizeNumericSetting(
    els.ampDecayMs.value,
    APP_CONFIG.controls.ampDecayMs,
    APP_CONFIG.controls.ampDecayMs.defaultValue
  ) / 1000;
  const ampSustainLevel = sanitizeNumericSetting(
    els.ampSustainPct.value,
    APP_CONFIG.controls.ampSustainPct,
    APP_CONFIG.controls.ampSustainPct.defaultValue
  ) / 100;
  const ampReleaseSec = sanitizeNumericSetting(
    els.ampReleaseMs.value,
    APP_CONFIG.controls.ampReleaseMs,
    APP_CONFIG.controls.ampReleaseMs.defaultValue
  ) / 1000;
  return {
    oscillator,
    filterType,
    filterCutoff,
    filterQ,
    keyboardTracking: clamp(keyboardTracking, 0, 1),
    followOriginalAmplitude,
    voice2Enabled,
    voice2DetuneCents: detune,
    voice2Mix: clamp(voice2Mix, 0, 1),
    outputGain: clamp(outputGain, 0.05, 1),
    filterEnvelope: {
      attackSec: clamp(attackSec, 0.001, 2),
      decaySec: clamp(decaySec, 0.001, 3),
      sustainLevel: clamp(sustainLevel, 0, 1),
      releaseSec: clamp(releaseSec, 0.01, 4)
    },
    filterEnvelopeDepthOctaves: Number.isFinite(filterEnvelopeDepthOctaves)
      ? clamp(filterEnvelopeDepthOctaves, 0, 3)
      : APP_CONFIG.controls.synthFilterEnvDepth.defaultValue,
    ampEnvelope: {
      attackSec: clamp(ampAttackSec, 0.001, 2),
      decaySec: clamp(ampDecaySec, 0.001, 3),
      sustainLevel: clamp(ampSustainLevel, 0, 1),
      releaseSec: clamp(ampReleaseSec, 0.01, 4)
    }
  };
}

function playSelectedMode(fromLoop = false) {
  clearPlaybackRefreshTimer();
  const mode = getSelectedPlaybackMode();
  if (!canPlayMode(mode)) {
    syncPlayModeAvailability();
    if (!fromLoop) {
      setStatus("No playable data for the selected mode.");
    }
    return;
  }

  if (mode === "original") {
    playOriginalSample(fromLoop);
    return;
  }
  if (mode === "raw") {
    playContinuousPitchMode("raw", fromLoop);
    return;
  }
  playContinuousPitchMode("auto", fromLoop);
}

function schedulePlaybackCompletion(totalMs, replayAction) {
  state.playbackEndTimer = setTimeout(() => {
    stopPlayback();
    if (state.loopPlayback && typeof replayAction === "function") {
      replayAction(true);
      return;
    }
    setStatus("Playback complete.");
  }, totalMs + 110);
}

function playContinuousPitchMode(mode, fromLoop = false) {
  if (!state.derived || !state.analysis) {
    return;
  }
  const synthSettings = readPlaybackSynthSettingsFromUi();
  const rawPlaybackSettings = readRawPlaybackSettingsFromUi();
  const segments = buildContinuousPitchModeSegments(state.analysis, state.derived, mode, rawPlaybackSettings);
  const played = playContinuousSegments(segments, synthSettings, () => playContinuousPitchMode(mode, true));
  if (!played) {
    setStatus("No voiced frames available for continuous playback.");
    return;
  }
  if (!fromLoop) {
    if (mode === "raw") {
      const gravityScale = rawPlaybackSettings.gravityEnabled ? getScaleForRawGravity() : null;
      const portamentoLabel = rawPlaybackSettings.portamentoEnabled
        ? `${Math.round(rawPlaybackSettings.portamentoAmount * 100)}%`
        : "off";
      const gravityLabel = rawPlaybackSettings.gravityEnabled && gravityScale
        ? `${Math.round(rawPlaybackSettings.gravityAmount * 100)}% ${formatScaleName(gravityScale.keyRoot, gravityScale.modeId)}`
        : "off";
      setStatus(`Playing raw pitch (portamento ${portamentoLabel}, gravity ${gravityLabel}).`);
    } else {
      setStatus("Playing autotuned continuous pitch.");
    }
  }
}

function playOriginalSample(fromLoop = false) {
  if (!state.originalAudioBuffer) {
    setStatus("No original recording available yet.");
    return;
  }

  stopPlayback();
  const ctx = createAudioContext();
  state.playbackContext = ctx;
  syncStopButtonState();

  const source = ctx.createBufferSource();
  source.buffer = state.originalAudioBuffer;
  const gain = ctx.createGain();
  gain.gain.value = 0.95;
  source.connect(gain).connect(ctx.destination);

  const startAt = ctx.currentTime + 0.03;
  source.start(startAt);
  source.stop(startAt + state.originalAudioBuffer.duration);

  const totalMs = Math.max(200, state.originalAudioBuffer.duration * 1000);
  schedulePlaybackCompletion(totalMs, () => playOriginalSample(true));

  if (!fromLoop) {
    setStatus("Playing original recording...");
  }
}

function getScaleForRawGravity() {
  if (state.derived && state.derived.resolvedScale) {
    return {
      keyRoot: state.derived.resolvedScale.keyRoot,
      modeId: state.derived.resolvedScale.modeId
    };
  }
  return resolveScaleForPreview();
}

function buildContinuousPitchModeSegments(analysis, derived, mode, rawPlaybackSettings) {
  const playbackData = mode === "raw"
    ? buildRawContinuousPlaybackData(analysis, derived, rawPlaybackSettings)
    : buildSmoothedContinuousPlaybackData(
      analysis,
      derived && derived.playbackTracks ? derived.playbackTracks.auto : null,
      APP_CONFIG.playback.autoPlayback.smoothingAmount
    );
  if (!playbackData || !playbackData.midiTrack || !playbackData.midiTrack.length) {
    return [];
  }
  return collectContinuousSegmentsFromTracks(analysis, playbackData.midiTrack, playbackData.gainTrack);
}

function buildAutotunedContinuousMidiTrack(analysis, derived, midiTrack, noteModelSettings) {
  const scale = derived && derived.resolvedScale
    ? derived.resolvedScale
    : resolveScaleForPreview();
  const boundaryEvidenceFrames = derived && derived.segmentation
    ? derived.segmentation.boundaryEvidenceFrames
    : [];
  const stablePlateauFrames = analysis.tracks && analysis.tracks.stablePlateauFrames
    ? analysis.tracks.stablePlateauFrames
    : [];
  const onsetStrengthFrames = analysis.tracks && analysis.tracks.onsetStrengthFrames
    ? analysis.tracks.onsetStrengthFrames
    : [];
  const slopeFrames = analysis.tracks && analysis.tracks.f0SlopeFrames
    ? analysis.tracks.f0SlopeFrames
    : [];
  const output = new Array(midiTrack.length).fill(null);
  let activeTarget = null;
  let pendingTarget = null;
  let pendingStart = -1;
  let pendingFrames = 0;
  let pendingSupport = 0;
  let pendingLeadStrength = 0;

  for (let i = 0; i < midiTrack.length; i++) {
    const currentMidi = midiTrack[i];
    if (!Number.isFinite(currentMidi)) {
      activeTarget = null;
      pendingTarget = null;
      pendingStart = -1;
      pendingFrames = 0;
      pendingSupport = 0;
      pendingLeadStrength = 0;
      continue;
    }
    const candidateTarget = quantizeMidi(currentMidi, scale.keyRoot, scale.modeId);
    if (!Number.isFinite(activeTarget)) {
      activeTarget = candidateTarget;
      output[i] = candidateTarget;
      continue;
    }
    if (candidateTarget !== activeTarget) {
      const switchSupport = computeAutotuneTargetSwitchEase(
        boundaryEvidenceFrames[i],
        stablePlateauFrames[i],
        onsetStrengthFrames[i],
        slopeFrames[i]
      );
      const leadStrength = computeAutotuneTargetLeadStrength(currentMidi, activeTarget, candidateTarget);
      if (pendingTarget !== candidateTarget) {
        pendingTarget = candidateTarget;
        pendingStart = i;
        pendingFrames = 1;
        pendingSupport = switchSupport;
        pendingLeadStrength = leadStrength;
      } else {
        pendingFrames += 1;
        pendingSupport = Math.max(pendingSupport, switchSupport);
        pendingLeadStrength = Math.max(pendingLeadStrength, leadStrength);
      }
      const requiredFrames = computeAutotuneSwitchConfirmationFrames(
        analysis,
        noteModelSettings,
        pendingSupport,
        pendingLeadStrength,
        activeTarget,
        candidateTarget
      );
      if (pendingFrames >= requiredFrames) {
        activeTarget = candidateTarget;
        for (let writeIndex = pendingStart; writeIndex <= i; writeIndex++) {
          if (Number.isFinite(midiTrack[writeIndex])) {
            output[writeIndex] = activeTarget;
          }
        }
        pendingTarget = null;
        pendingStart = -1;
        pendingFrames = 0;
        pendingSupport = 0;
        pendingLeadStrength = 0;
      }
    } else {
      pendingTarget = null;
      pendingStart = -1;
      pendingFrames = 0;
      pendingSupport = 0;
      pendingLeadStrength = 0;
    }
    output[i] = activeTarget;
  }

  return output;
}

function buildThresholdGatedContinuousMidiTrack(analysis, threshold) {
  const frameCount = analysis.frameTimes.length;
  const gateOpen = new Array(frameCount).fill(false);
  const midiTrack = new Array(frameCount).fill(null);
  for (let i = 0; i < frameCount; i++) {
    gateOpen[i] = analysis.rmsFrames[i] >= threshold;
    if (gateOpen[i] && Number.isFinite(analysis.midiFrames[i])) {
      midiTrack[i] = clampPitchMidi(analysis.midiFrames[i]);
    }
  }
  fillShortPitchGaps(midiTrack, gateOpen, APP_CONFIG.playback.rawPlayback.gapFillFrames);
  return midiTrack;
}

function buildRawContinuousPlaybackData(analysis, derived, rawPlaybackSettings) {
  const targetTrack = derived && derived.playbackTracks ? derived.playbackTracks.raw : null;
  if (!Array.isArray(targetTrack) || !targetTrack.length) {
    return null;
  }
  const portamentoAmount = rawPlaybackSettings && rawPlaybackSettings.portamentoEnabled
    ? rawPlaybackSettings.portamentoAmount
    : 0;
  const gravityAmount = rawPlaybackSettings && rawPlaybackSettings.gravityEnabled
    ? rawPlaybackSettings.gravityAmount
    : 0;
  const scaleForGravity = gravityAmount > 0 ? getScaleForRawGravity() : null;
  const validMask = targetTrack.map((value) => Number.isFinite(value));
  const midiTrack = smoothMidiTrackWithGravity(
    targetTrack,
    validMask,
    portamentoAmount,
    scaleForGravity,
    gravityAmount
  );
  const voicedMask = midiTrack.map((value) => Number.isFinite(value));
  const gainTrack = buildRmsDrivenGainTrack(analysis, voicedMask, portamentoAmount * 0.7);
  return { midiTrack, gainTrack };
}

function buildSmoothedContinuousPlaybackData(analysis, targetTrack, smoothingAmount) {
  if (!Array.isArray(targetTrack) || !targetTrack.length) {
    return null;
  }
  const validMask = targetTrack.map((value) => Number.isFinite(value));
  const portamentoMidiTrack = applyPortamentoTrack(targetTrack, validMask, smoothingAmount);
  const smoothedMidiTrack = smoothScalarTrackBidirectional(portamentoMidiTrack, validMask, smoothingAmount * 0.22);
  const voicedMask = smoothedMidiTrack.map((value) => Number.isFinite(value));
  const gainTrack = buildRmsDrivenGainTrack(analysis, voicedMask, smoothingAmount * 0.55);
  return {
    midiTrack: smoothedMidiTrack,
    gainTrack
  };
}

function computeAutotuneTargetSwitchEase(boundaryEvidence, stablePlateau, onsetStrength, slopeStrength) {
  return clamp(
    (Number(boundaryEvidence) || 0) * 0.45 +
      (Number(onsetStrength) || 0) * 0.25 +
      (Number(slopeStrength) || 0) * 0.15 +
      (1 - (Number(stablePlateau) || 0)) * 0.15,
    0,
    1
  );
}

function computeAutotuneTargetLeadStrength(currentMidi, activeTarget, candidateTarget) {
  const holdDistance = Math.abs(currentMidi - activeTarget);
  const candidateDistance = Math.abs(currentMidi - candidateTarget);
  const distanceLead = clamp((holdDistance - candidateDistance) / 1.4, 0, 1);
  const targetJump = Math.abs(candidateTarget - activeTarget);
  const jumpWeight = clamp((targetJump - 0.8) / 1.8, 0, 1);
  return clamp(distanceLead * 0.72 + jumpWeight * 0.28, 0, 1);
}

function computeAutotuneSwitchConfirmationFrames(
  analysis,
  noteModelSettings,
  switchSupport,
  leadStrength,
  activeTarget,
  candidateTarget
) {
  const flutterToleranceMs = getFlutterToleranceMs(noteModelSettings);
  if (flutterToleranceMs <= 0) {
    return 1;
  }
  const frameDurationMs = Math.max(1, (analysis.hopSize / analysis.sampleRate) * 1000);
  const baseFrames = Math.max(1, Math.round(flutterToleranceMs / frameDurationMs));
  const jumpStrength = clamp((Math.abs(candidateTarget - activeTarget) - 0.8) / 1.8, 0, 1);
  const confirmationStrength = clamp(
    switchSupport * 0.55 + leadStrength * 0.3 + jumpStrength * 0.15,
    0,
    1
  );
  return Math.max(1, Math.round(baseFrames * (1 - confirmationStrength * 0.9)));
}

function playSelectedScale(fromLoop = false) {
  const scale = resolveScaleForPreview();
  const synthSettings = readPlaybackSynthSettingsFromUi();
  const notes = buildScaleMidiSequence(scale.keyRoot, scale.modeId, 60);
  if (!notes.length) {
    setStatus("Unable to build a scale preview.");
    return;
  }

  stopPlayback();
  const ctx = createAudioContext();
  state.playbackContext = ctx;
  syncStopButtonState();
  const master = createPlaybackChain(ctx);

  const startAt = ctx.currentTime + 0.03;
  const stepSeconds = 0.22;
  const noteSeconds = 0.18;
  let maxEnd = 0;

  for (let i = 0; i < notes.length; i++) {
    const start = startAt + i * stepSeconds;
    const end = start + noteSeconds;
    triggerSynthVoice(ctx, midiToHz(notes[i]), start, end, master, "auto", synthSettings);
    maxEnd = Math.max(maxEnd, end);
  }

  const totalMs = Math.max(200, (maxEnd - ctx.currentTime) * 1000);
  schedulePlaybackCompletion(totalMs, () => playSelectedScale(true));

  if (!fromLoop) {
    setStatus(`Playing scale: ${formatScaleName(scale.keyRoot, scale.modeId)}`);
  }
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
  clearPlaybackRefreshTimer();
  if (state.synthTestReleaseTimer) {
    clearTimeout(state.synthTestReleaseTimer);
    state.synthTestReleaseTimer = null;
  }
  state.synthTestVoice = null;
  if (els.synthTestBtn) {
    els.synthTestBtn.classList.remove("is-holding");
  }
  if (state.playbackEndTimer) {
    clearTimeout(state.playbackEndTimer);
    state.playbackEndTimer = null;
  }
  if (state.playbackContext && state.playbackContext.state !== "closed") {
    state.playbackContext.close().catch(() => {});
  }
  state.playbackContext = null;
  syncStopButtonState();
}

function playContinuousSegments(segments, synthSettings, replayAction) {
  if (!segments || !segments.length) {
    return false;
  }

  stopPlayback();
  const ctx = createAudioContext();
  state.playbackContext = ctx;
  syncStopButtonState();
  const master = createPlaybackChain(ctx);

  const startAt = ctx.currentTime + 0.05;
  let maxEnd = 0;
  for (const segment of segments) {
    triggerBendVoice(ctx, segment, startAt, master, synthSettings);
    maxEnd = Math.max(maxEnd, startAt + segment.endTime);
  }

  const totalMs = Math.max(200, (maxEnd - ctx.currentTime) * 1000);
  schedulePlaybackCompletion(totalMs + 10, replayAction);
  return true;
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

function createOscillatorPair(ctx, freqHz, start, synthSettings) {
  const settings = synthSettings || readPlaybackSynthSettingsFromUi();
  const baseFreq = Math.max(1, freqHz);
  const voice2Mix = settings.voice2Enabled ? clamp(settings.voice2Mix, 0, 0.9) : 0;
  const voice1Level = clamp(1 - voice2Mix * 0.55, 0.25, 1);
  const voice2Level = settings.voice2Enabled ? clamp(voice2Mix, 0.08, 0.95) : 0;

  const voices = [];
  const voice1 = ctx.createOscillator();
  voice1.type = settings.oscillator;
  voice1.frequency.setValueAtTime(baseFreq, start);
  voice1.detune.setValueAtTime(0, start);
  const voice1Gain = ctx.createGain();
  voice1Gain.gain.value = voice1Level;
  voice1.connect(voice1Gain);
  voices.push({ node: voice1, output: voice1Gain });

  if (settings.voice2Enabled) {
    const voice2 = ctx.createOscillator();
    voice2.type = settings.oscillator;
    voice2.frequency.setValueAtTime(baseFreq, start);
    voice2.detune.setValueAtTime(settings.voice2DetuneCents, start);
    const voice2Gain = ctx.createGain();
    voice2Gain.gain.value = voice2Level;
    voice2.connect(voice2Gain);
    voices.push({ node: voice2, output: voice2Gain });
  }

  return voices;
}

function scheduleAdsrEnvelope(gainParam, start, end, peakGain, envelopeSettings) {
  const settings = envelopeSettings || {
    attackSec: 0.01,
    decaySec: 0.1,
    sustainLevel: 0.8,
    releaseSec: 0.12
  };
  const attackEnd = Math.min(end, start + settings.attackSec);
  const decayEnd = Math.min(end, attackEnd + settings.decaySec);
  const sustainGain = Math.max(0.0001, peakGain * settings.sustainLevel);
  gainParam.cancelScheduledValues(start);
  gainParam.setValueAtTime(0.0001, start);
  gainParam.linearRampToValueAtTime(Math.max(0.0001, peakGain), attackEnd);
  if (decayEnd > attackEnd) {
    gainParam.linearRampToValueAtTime(sustainGain, decayEnd);
  }
  if (end > decayEnd) {
    gainParam.setValueAtTime(sustainGain, end);
  }
  gainParam.linearRampToValueAtTime(0.0001, end + settings.releaseSec);
}

function envelopeMultiplierAtTime(relativeTime, segmentDuration, envelopeSettings) {
  const settings = envelopeSettings || readPlaybackSynthSettingsFromUi();
  const t = clamp(relativeTime, 0, segmentDuration);
  if (t <= settings.attackSec) {
    return clamp(t / Math.max(0.001, settings.attackSec), 0, 1);
  }
  const decayStart = settings.attackSec;
  const decayEnd = decayStart + settings.decaySec;
  if (t <= decayEnd) {
    const progress = (t - decayStart) / Math.max(0.001, settings.decaySec);
    return 1 - (1 - settings.sustainLevel) * progress;
  }
  return settings.sustainLevel;
}

function resolveFilterCutoffForMidi(settings, midiValue, cutoffOffset = 0) {
  const tracking = clamp(settings.keyboardTracking || 0, 0, 1);
  const semitonesFromMiddleC = midiValue - 60;
  const trackingRatio = Math.pow(2, (semitonesFromMiddleC / 12) * tracking);
  const baseCutoff = Math.max(80, settings.filterCutoff + cutoffOffset);
  return clamp(baseCutoff * trackingRatio, 60, 16000);
}

function filterEnvelopeRatioAtLevel(level, synthSettings) {
  const settings = synthSettings || readPlaybackSynthSettingsFromUi();
  const depth = clamp(settings.filterEnvelopeDepthOctaves || 0, 0, 3);
  return Math.pow(2, depth * clamp(level, 0, 1));
}

function applyFilterEnvelopeToCutoff(baseCutoff, level, synthSettings) {
  return clamp(baseCutoff * filterEnvelopeRatioAtLevel(level, synthSettings), 60, 16000);
}

function scheduleFilterEnvelope(filterParam, start, end, baseCutoff, synthSettings) {
  const settings = synthSettings || readPlaybackSynthSettingsFromUi();
  const envelope = settings.filterEnvelope || {
    attackSec: 0.01,
    decaySec: 0.12,
    sustainLevel: 0.65,
    releaseSec: 0.1
  };
  const attackEnd = Math.min(end, start + envelope.attackSec);
  const decayEnd = Math.min(end, attackEnd + envelope.decaySec);
  const startCutoff = applyFilterEnvelopeToCutoff(baseCutoff, 0, settings);
  const peakCutoff = applyFilterEnvelopeToCutoff(baseCutoff, 1, settings);
  const sustainCutoff = applyFilterEnvelopeToCutoff(baseCutoff, envelope.sustainLevel, settings);

  filterParam.cancelScheduledValues(start);
  filterParam.setValueAtTime(startCutoff, start);
  filterParam.linearRampToValueAtTime(peakCutoff, attackEnd);
  if (decayEnd > attackEnd) {
    filterParam.linearRampToValueAtTime(sustainCutoff, decayEnd);
  }
  if (end > decayEnd) {
    filterParam.setValueAtTime(sustainCutoff, end);
  }
  filterParam.linearRampToValueAtTime(startCutoff, end + envelope.releaseSec);
}

function triggerSynthVoice(
  ctx,
  freqHz,
  start,
  end,
  destination,
  mode,
  synthSettings,
  previousFreqHz = null,
  portamentoSec = 0
) {
  const settings = synthSettings || readPlaybackSynthSettingsFromUi();
  const safeFreq = Math.max(1, freqHz);
  const midiValue = hzToMidi(safeFreq);
  const modeCutoffBoost = mode === "raw" ? 0 : 240;
  const useFilter = settings.filterType !== "none";
  let voiceFilter = null;
  let baseCutoff = 0;
  if (useFilter) {
    voiceFilter = ctx.createBiquadFilter();
    voiceFilter.type = settings.filterType;
    baseCutoff = resolveFilterCutoffForMidi(settings, midiValue, modeCutoffBoost);
    voiceFilter.frequency.setValueAtTime(baseCutoff, start);
    voiceFilter.Q.value = settings.filterQ;
  }

  const voiceGain = ctx.createGain();
  const modeBasePeak = mode === "raw" ? 0.32 : 0.28;
  const peak = modeBasePeak * settings.outputGain;
  scheduleAdsrEnvelope(voiceGain.gain, start, end, peak, settings.ampEnvelope);
  if (voiceFilter) {
    scheduleFilterEnvelope(voiceFilter.frequency, start, end, baseCutoff, settings);
  }

  const hasPreviousFreq = Number.isFinite(previousFreqHz) && previousFreqHz > 0;
  const glideStartFreq = hasPreviousFreq ? Math.max(1, previousFreqHz) : safeFreq;
  const maxGlide = Math.max(0, (end - start) * 0.85);
  const glideSec = hasPreviousFreq ? clamp(portamentoSec || 0, 0, maxGlide) : 0;
  const oscillators = createOscillatorPair(ctx, glideStartFreq, start, settings);

  if (glideSec > 0 && glideStartFreq !== safeFreq) {
    const glideEndTime = start + glideSec;
    for (const osc of oscillators) {
      osc.node.frequency.setValueAtTime(glideStartFreq, start);
      osc.node.frequency.linearRampToValueAtTime(safeFreq, glideEndTime);
    }
  } else {
    for (const osc of oscillators) {
      osc.node.frequency.setValueAtTime(safeFreq, start);
    }
  }

  for (const osc of oscillators) {
    if (voiceFilter) {
      osc.output.connect(voiceFilter);
    } else {
      osc.output.connect(voiceGain);
    }
  }
  if (voiceFilter) {
    voiceFilter.connect(voiceGain);
  }
  voiceGain.connect(destination);

  const stopAt = end + settings.ampEnvelope.releaseSec + 0.04;
  for (const osc of oscillators) {
    osc.node.start(start);
    osc.node.stop(stopAt);
  }
}

function applyPortamentoTrack(track, validMask, amount) {
  const strength = clamp(amount || 0, 0, 1);
  if (strength <= 0) {
    return track.map((value, index) => (validMask[index] && Number.isFinite(value) ? value : null));
  }

  const tauFrames = 0.4 + strength * 28;
  const alpha = 1 / (1 + tauFrames);
  const output = new Array(track.length).fill(null);
  let prev = null;

  for (let i = 0; i < track.length; i++) {
    if (!validMask[i] || !Number.isFinite(track[i])) {
      prev = null;
      continue;
    }
    const current = track[i];
    const next = prev === null ? current : prev + alpha * (current - prev);
    output[i] = next;
    prev = next;
  }

  return output;
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

function smoothMidiTrackWithGravity(midiTrack, validMask, smoothingAmount, scaleForGravity, gravityAmount = 0) {
  const smoothed = smoothScalarTrackBidirectional(midiTrack, validMask, smoothingAmount);
  if (!scaleForGravity || gravityAmount <= 0) {
    return smoothed;
  }

  const gravityStrength = clamp(gravityAmount, 0, 1) * APP_CONFIG.playback.rawPlayback.maxGravityStrength;
  const maxPull = APP_CONFIG.playback.rawPlayback.maxGravityPullSemitones;
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

function buildRmsDrivenGainTrack(analysis, voicedMask, smoothingAmount) {
  const voicedRms = [];
  for (let i = 0; i < analysis.frameTimes.length; i++) {
    if (voicedMask[i]) {
      voicedRms.push(analysis.rmsFrames[i]);
    }
  }
  const rmsReference = Math.max(1e-6, percentile(voicedRms, 0.95));
  const gainTrack = new Array(analysis.frameTimes.length).fill(0);
  for (let i = 0; i < analysis.frameTimes.length; i++) {
    if (!voicedMask[i]) {
      continue;
    }
    const normalized = clamp(analysis.rmsFrames[i] / rmsReference, 0, 1);
    gainTrack[i] = Math.pow(normalized, APP_CONFIG.playback.rawPlayback.gainPower) * APP_CONFIG.playback.rawPlayback.maxGain;
  }
  return smoothScalarTrackBidirectional(gainTrack, voicedMask, smoothingAmount);
}

function collectContinuousSegmentsFromTracks(analysis, midiTrack, gainTrack) {
  const segments = [];
  let segmentStart = -1;
  const frameCount = analysis.frameTimes.length;
  const framePad = analysis.hopSize / analysis.sampleRate;
  for (let i = 0; i < frameCount; i++) {
    const voiced = Number.isFinite(midiTrack[i]);
    if (voiced && segmentStart < 0) {
      segmentStart = i;
    } else if (!voiced && segmentStart >= 0) {
      pushBendSegment(segments, analysis, midiTrack, gainTrack, segmentStart, i - 1, framePad);
      segmentStart = -1;
    }
  }
  if (segmentStart >= 0) {
    pushBendSegment(segments, analysis, midiTrack, gainTrack, segmentStart, frameCount - 1, framePad);
  }
  return segments;
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

function triggerBendVoice(ctx, segment, startAt, destination, synthSettings) {
  const settings = synthSettings || readPlaybackSynthSettingsFromUi();
  const start = startAt + segment.startTime;
  const end = startAt + segment.endTime;
  const useAmpEnvelope = !settings.followOriginalAmplitude;
  const envelopeSettings = useAmpEnvelope ? settings.ampEnvelope : null;
  const envelopeRelease = envelopeSettings ? envelopeSettings.releaseSec : 0;
  const releaseSec = Math.max(envelopeRelease, APP_CONFIG.playback.rawPlayback.releaseMs / 1000);
  const segmentDuration = Math.max(0.01, end - start);
  const filterEnvelope = settings.filterEnvelope || {
    attackSec: 0.01,
    decaySec: 0.12,
    sustainLevel: 0.65,
    releaseSec: 0.1
  };

  const useFilter = settings.filterType !== "none";
  let voiceFilter = null;
  if (useFilter) {
    voiceFilter = ctx.createBiquadFilter();
    voiceFilter.type = settings.filterType;
    const initialBaseCutoff = resolveFilterCutoffForMidi(settings, segment.points[0].midi, 300);
    const initialFilterEnv = envelopeMultiplierAtTime(0, segmentDuration, filterEnvelope);
    const initialCutoff = applyFilterEnvelopeToCutoff(initialBaseCutoff, initialFilterEnv, settings);
    voiceFilter.frequency.setValueAtTime(initialCutoff, start);
    voiceFilter.Q.value = settings.filterQ;
  }

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);

  const firstFreq = midiToHz(segment.points[0].midi);
  const oscillators = createOscillatorPair(ctx, firstFreq, start, settings);
  const attackTime = Math.min(start + (envelopeSettings ? envelopeSettings.attackSec : 0.003), end);
  const initialEnvelope = envelopeSettings ? envelopeMultiplierAtTime(0, segmentDuration, envelopeSettings) : 1;
  const initialGain = segment.points[0].gain * initialEnvelope * settings.outputGain;
  for (const osc of oscillators) {
    osc.node.frequency.setValueAtTime(firstFreq, start);
  }
  amp.gain.linearRampToValueAtTime(Math.max(0.0001, initialGain), Math.max(start + 0.003, attackTime));

  for (let i = 1; i < segment.points.length; i++) {
    const point = segment.points[i];
    const t = startAt + point.time;
    const hz = midiToHz(point.midi);
    for (const osc of oscillators) {
      osc.node.frequency.linearRampToValueAtTime(Math.max(1, hz), t);
    }
    if (voiceFilter) {
      const filterEnv = envelopeMultiplierAtTime(clamp(t - start, 0, segmentDuration), segmentDuration, filterEnvelope);
      const baseCutoff = resolveFilterCutoffForMidi(settings, point.midi, 300);
      const cutoff = applyFilterEnvelopeToCutoff(baseCutoff, filterEnv, settings);
      voiceFilter.frequency.linearRampToValueAtTime(cutoff, t);
    }
    const relativeTime = clamp(t - start, 0, segmentDuration);
    const envelope = envelopeSettings ? envelopeMultiplierAtTime(relativeTime, segmentDuration, envelopeSettings) : 1;
    const targetGain = point.gain * envelope * settings.outputGain;
    amp.gain.linearRampToValueAtTime(Math.max(0.0001, targetGain), t);
  }

  if (voiceFilter) {
    const lastPoint = segment.points[segment.points.length - 1];
    const releaseBase = resolveFilterCutoffForMidi(settings, lastPoint.midi, 300);
    const releaseCutoff = applyFilterEnvelopeToCutoff(releaseBase, 0, settings);
    voiceFilter.frequency.linearRampToValueAtTime(releaseCutoff, end + filterEnvelope.releaseSec);
  }
  amp.gain.linearRampToValueAtTime(0.0001, end + releaseSec);

  for (const osc of oscillators) {
    if (voiceFilter) {
      osc.output.connect(voiceFilter);
    } else {
      osc.output.connect(amp);
    }
  }
  if (voiceFilter) {
    voiceFilter.connect(amp);
  }
  amp.connect(destination);

  const stopAt = end + releaseSec + 0.04;
  for (const osc of oscillators) {
    osc.node.start(start);
    osc.node.stop(stopAt);
  }
}

function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const pitch = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[pitch]}${octave}`;
}

function drawPlaceholder(canvas, text) {
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(6, 18, 27, 0.95)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(180, 224, 211, 0.85)";
  ctx.font = "18px Space Grotesk";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function getMidiCanvas() {
  if (!els.midiCanvas) {
    els.midiCanvas = document.getElementById("midiCanvas");
  }
  return els.midiCanvas;
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function clampPitchMidi(midi) {
  return clamp(midi, APP_CONFIG.pitch.minMidi, APP_CONFIG.pitch.maxMidi);
}

function reducePitchPool(values, reducerMode) {
  if (reducerMode === "median") {
    return median(values);
  }
  if (reducerMode === "tailWeightedMean") {
    return tailWeightedMean(values, APP_CONFIG.detection.tailWeightedMeanPower);
  }
  return mean(values);
}
