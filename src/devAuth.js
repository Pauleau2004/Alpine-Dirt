// Development diagnostics only, never host authorization or production access.
// No URL parameter, nickname or public token unlocks a production build.
export function isDevAuthorized() {
  return !!import.meta.env?.DEV&&typeof location!=='undefined'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname);
}
