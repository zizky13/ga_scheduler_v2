// Browser polyfill for setImmediate used by the GA pipeline
if (typeof (globalThis as any).setImmediate === 'undefined') {
  (globalThis as any).setImmediate = (fn: (...a: unknown[]) => void, ...args: unknown[]) =>
    setTimeout(fn, 0, ...args);
}
