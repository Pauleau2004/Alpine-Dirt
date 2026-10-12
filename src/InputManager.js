export class InputManager {
  constructor(onAction,isBoostMode=()=>false) {
    this.isBoostMode=isBoostMode;
    this.keys = new Set();
    this.enabled = false;
    this.onKeyDown = (e) => {
      if(e.code==='Escape'&&!e.repeat){e.preventDefault();onAction('pause');return;}
      if (e.target instanceof HTMLElement && e.target.matches('input, select, textarea, button')) return;
      if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyZ', 'KeyQ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        const action = e.code==='Space'&&this.isBoostMode()?'boost':{ KeyR: 'reset', Backspace: 'reset', Delete: 'reset', KeyC: 'camera', Escape: 'pause', F3: 'debug' }[e.code];
        if (action) { e.preventDefault(); onAction(action); }
      }
      this.keys.add(e.code);
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.clear(); onAction('blur'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); onAction('blur'); } });
  }
  clear() { this.keys.clear(); }
  read() {
    const has = (...codes) => this.enabled && codes.some((code) => this.keys.has(code));
    return {
      throttle: +has('KeyW', 'KeyZ', 'ArrowUp'),
      brake: +has('KeyS', 'ArrowDown'),
      // Forward is +Z. With +Y up, rider-right is -X (negative yaw).
      steer: +has('KeyA', 'KeyQ', 'ArrowLeft') - +has('KeyD', 'ArrowRight'),
    };
  }
}
