// Ambient types for Node APIs used by the GA pipeline that are
// polyfilled or substituted by Vite at build/dev time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function setImmediate(fn: (...args: any[]) => void, ...args: any[]): number;
declare namespace process {
  const env: { NODE_ENV: string };
}
