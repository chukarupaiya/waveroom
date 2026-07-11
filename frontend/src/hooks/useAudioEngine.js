import { useCallback, useEffect, useRef, useState } from "react";

// Web Audio pipeline:
//   source -> bass -> treble -> panner -> [convolver] -> gain -> analyser -> out
//
// The convolver (spatial / concert-hall reverb) is wired in/out on toggle.
// Its impulse response is synthesized in-browser (decaying noise) so there's
// no external CDN dependency for the MVP.
export function useAudioEngine() {
  const audioRef = useRef(null);
  const ctxRef = useRef(null);
  const nodes = useRef({});
  const [ready, setReady] = useState(false);
  const [spatial, setSpatial] = useState(false);

  // Lazily build the graph on first user gesture (autoplay policy).
  const ensureGraph = useCallback(() => {
    if (ctxRef.current || !audioRef.current) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();

    const source = ctx.createMediaElementSource(audioRef.current);

    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 100;
    bass.gain.value = 4;

    const treble = ctx.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 8000;
    treble.gain.value = 2;

    const panner = ctx.createStereoPanner();
    panner.pan.value = 0;

    const convolver = ctx.createConvolver();
    convolver.buffer = buildImpulseResponse(ctx, 2.6, 2.4);

    const wet = ctx.createGain();
    wet.gain.value = 0; // dry by default

    const gain = ctx.createGain();
    gain.gain.value = 1;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128; // -> 64 frequency bins
    analyser.smoothingTimeConstant = 0.8;

    // dry path
    source.connect(bass);
    bass.connect(treble);
    treble.connect(panner);
    panner.connect(gain);
    // wet (reverb) path runs in parallel and is mixed via wet gain
    panner.connect(convolver);
    convolver.connect(wet);
    wet.connect(gain);

    gain.connect(analyser);
    analyser.connect(ctx.destination);

    ctxRef.current = ctx;
    nodes.current = { source, bass, treble, panner, convolver, wet, gain, analyser };
    setReady(true);
  }, []);

  const resume = useCallback(async () => {
    ensureGraph();
    if (ctxRef.current?.state === "suspended") {
      await ctxRef.current.resume();
    }
  }, [ensureGraph]);

  const setVolume = useCallback((v) => {
    if (nodes.current.gain) nodes.current.gain.gain.value = v;
  }, []);

  const toggleSpatial = useCallback((on) => {
    setSpatial(on);
    const { wet, panner } = nodes.current;
    if (!wet || !ctxRef.current) return;
    const now = ctxRef.current.currentTime;
    wet.gain.cancelScheduledValues(now);
    wet.gain.linearRampToValueAtTime(on ? 0.5 : 0.0, now + 0.4);
    if (panner) {
      panner.pan.cancelScheduledValues(now);
      panner.pan.setValueAtTime(panner.pan.value, now);
      // widen the field slightly when spatial is on
      panner.pan.linearRampToValueAtTime(0, now + 0.4);
    }
  }, []);

  const getFrequencyData = useCallback(() => {
    const a = nodes.current.analyser;
    if (!a) return null;
    const arr = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(arr);
    return arr;
  }, []);

  const getCtxState = useCallback(
    () => (ctxRef.current ? ctxRef.current.state : "none"),
    []
  );

  useEffect(() => {
    return () => {
      try {
        ctxRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  return {
    audioRef,
    ready,
    spatial,
    resume,
    setVolume,
    toggleSpatial,
    getFrequencyData,
    getCtxState,
  };
}

// Synthesize a concert-hall-ish impulse response: stereo decaying noise.
function buildImpulseResponse(ctx, seconds = 2.5, decay = 2.0) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}
