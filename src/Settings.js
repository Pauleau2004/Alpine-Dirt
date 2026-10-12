import { clamp } from './math.js';
export const DEFAULT_SETTINGS = Object.freeze({ quality: 'medium', shadows: true, particles: true, sensitivity: 1, camera: 'close', fps: false });
export class Settings {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    let saved = {};
    try { saved = JSON.parse(storage?.getItem('motocross.settings.v1') || '{}') || {}; } catch { /* Storage can be unavailable. */ }
    this.values = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) if (key in saved) this.set(key, saved[key], false);
  }
  set(key, value, persist = true) {
    if (key === 'quality' && ['low', 'medium', 'high'].includes(value)) this.values[key] = value;
    if (key === 'camera' && ['close', 'wide', 'firstPerson'].includes(value)) this.values[key] = value;
    if (['shadows', 'particles', 'fps'].includes(key) && typeof value === 'boolean') this.values[key] = value;
    if (key === 'sensitivity' && Number.isFinite(Number(value))) this.values[key] = clamp(Number(value), 0.5, 1.6);
    if (persist) { try { this.storage?.setItem('motocross.settings.v1', JSON.stringify(this.values)); } catch { /* Play without persistence. */ } }
  }
}
