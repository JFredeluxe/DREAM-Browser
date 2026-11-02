import test from 'node:test';
import assert from 'node:assert/strict';

let onMotionChange;
const motion = { matches: false, addEventListener: (_name, handler) => { onMotionChange = handler; } };
globalThis.matchMedia = () => motion;
globalThis.requestAnimationFrame = () => 1;
const { Spring } = await import('../../src/renderer/js/spring.js');

test('springs respond immediately to interruption and reduced motion', () => {
  const values = []; const spring = new Spring(0, value => values.push(value));
  spring.to(100); spring.step(.03); assert.ok(spring.value > 0 && spring.value < 100);
  spring.to(30); for (let i = 0; i < 100; i++) spring.step(.016);
  assert.equal(spring.value, 30);
  spring.to(100); motion.matches = true; onMotionChange({ matches: true });
  assert.equal(spring.value, 100); assert.equal(values.at(-1), 100);
  motion.matches = false;
});
test('discarded springs do not call stale completion handlers', () => {
  let completed = false; const spring = new Spring(1, () => {});
  spring.onSettle = () => { completed = true; };
  spring.to(0); spring.cancel();
  assert.equal(completed, false); assert.equal(spring.onSettle, null);
});
test('many rapidly retargeted tab springs settle at their latest positions', () => {
  const springs = Array.from({ length: 150 }, () => new Spring(0, () => {}));
  for (let turn = 0; turn < 20; turn++) for (let i = 0; i < springs.length; i++) springs[i].to(i + turn);
  for (let frame = 0; frame < 180; frame++) for (const spring of springs) spring.step(1 / 120);
  for (let i = 0; i < springs.length; i++) assert.equal(springs[i].value, i + 19);
});
