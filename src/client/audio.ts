import { soundOn, setSoundOn } from './store';

const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

export function playTone(freq = 440, dur = 0.09, type: OscillatorType = 'sine'): void {
  if (!soundOn) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.11, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

export function toggleSound(): void {
  setSoundOn(!soundOn);
  document.getElementById('btnToggleSound')!.textContent = soundOn ? '🔊' : '🔇';
}
