(function registerHummerCore(globalScope) {
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

  function trimAudioBufferTail(audioBuffer, trimMs, audioContext) {
    const trimSamples = Math.max(0, Math.floor(audioBuffer.sampleRate * (Math.max(0, trimMs) / 1000)));
    if (trimSamples <= 0 || trimSamples >= audioBuffer.length || !audioContext) {
      return audioBuffer;
    }

    const trimmedLength = Math.max(1, audioBuffer.length - trimSamples);
    const trimmed = audioContext.createBuffer(audioBuffer.numberOfChannels, trimmedLength, audioBuffer.sampleRate);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const source = audioBuffer.getChannelData(channel).subarray(0, trimmedLength);
      trimmed.copyToChannel(source, channel);
    }
    return trimmed;
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

  function createAudioContext() {
    const Ctx = globalScope.AudioContext || globalScope.webkitAudioContext;
    return new Ctx();
  }

  function sanitizeNumericSetting(value, range, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, range.min, range.max);
  }

  function sanitizeChoice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function positiveModulo(value, mod) {
    return ((value % mod) + mod) % mod;
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
    for (const value of values) {
      sum += value;
    }
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

  function tailWeightedMean(values, power) {
    if (!values.length) {
      return 0;
    }
    const exponent = Math.max(1, Number(power) || 1);
    const count = values.length;
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < count; i++) {
      const progress = (i + 1) / count;
      const weight = Math.pow(progress, exponent);
      weightedSum += values[i] * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? weightedSum / weightTotal : mean(values);
  }

  globalScope.HummerCore = Object.freeze({
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
  });
})(window);
