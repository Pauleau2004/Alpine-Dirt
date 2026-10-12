import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {}
};
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  hidden: false
};

const { InputManager } = await import('../src/InputManager.js');

test('InputManager: Spacebar does not activate brake, KeyS and ArrowDown do', () => {
  const actions = [];
  const input = new InputManager((act) => actions.push(act), () => false);
  input.enabled = true;

  assert.deepEqual(input.read(), { throttle: 0, brake: 0, steer: 0 });

  input.keys.add('Space');
  assert.equal(input.read().brake, 0, 'Space must NOT brake');

  input.keys.add('KeyS');
  assert.equal(input.read().brake, 1, 'KeyS must brake');

  input.keys.delete('KeyS');
  assert.equal(input.read().brake, 0);

  input.keys.add('ArrowDown');
  assert.equal(input.read().brake, 1, 'ArrowDown must brake');

  input.keys.delete('ArrowDown');
  assert.equal(input.read().brake, 0);

  input.keys.add('KeyW');
  assert.equal(input.read().throttle, 1);
  input.keys.delete('KeyW');
  assert.equal(input.read().throttle, 0);
});
