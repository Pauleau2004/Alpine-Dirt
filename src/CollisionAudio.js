class CollisionAudio {
  constructor() {
    this.ctx = null;
    this.lastPlay = 0;
  }
  play(intensity = 0.3) {
    if (typeof window === 'undefined') return;
    const now = performance.now();
    if (now - this.lastPlay < 80) return;
    this.lastPlay = now;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260 + Math.min(intensity * 350, 500), t);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(105, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.07);
      const volume = Math.min(0.22, Math.max(0.03, intensity * 0.14));
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch {}
  }
}
export const collisionAudio = new CollisionAudio();
