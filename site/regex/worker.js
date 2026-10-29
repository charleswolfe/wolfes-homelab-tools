// Runs regex matching off the main thread; the page terminates this worker if
// a pattern backtracks for too long.
import { run } from '/lib/regex.js';

self.onmessage = ({ data }) => {
  const { id, pattern, flags, text, replacement } = data;
  try {
    self.postMessage({ id, ok: true, result: run(pattern, flags, text, { replacement }) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
