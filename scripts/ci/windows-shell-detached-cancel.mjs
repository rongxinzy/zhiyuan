import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import { observeDetachedUpgrade } from './windows-shell-evidence.mjs';

export function cancelledRollback(events) {
  assert(!events.some(event => event.type === 'done'), 'Unexpected done after real Cancel click');
  const errors = events.filter(event => event.type === 'error');
  const unexpected = errors.find(event => !/cancel/i.test(event.detail || ''));
  assert(!unexpected, `Unexpected failure after real Cancel click: ${JSON.stringify(unexpected)}`);
  return errors.length > 0;
}

// Terminal events only fail the attempt; delayed UI-thread phase events must
// never decide when the real filesystem transaction can be observed.
export async function readTerminalEvent(filename) {
  let file;
  try {
    file = await open(filename, 'r');
    const { size } = await file.stat();
    const offset = Math.max(0, size - 8192);
    const bytes = Buffer.alloc(size - offset);
    await file.read(bytes, 0, bytes.length, offset);
    const lines = bytes.toString('utf8').split(/\r?\n/);
    if (offset) lines.shift();
    for (const line of lines.reverse()) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'done' || event.type === 'error') return event;
      } catch {
        /* Ignore partial records, never manufacture an event. */
      }
    }
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await file?.close();
  }
}

export async function cancelAfterDetach({
  installRoot,
  eventsLog,
  startInstall,
  cancelInstall,
  diagnostics,
  timeoutMs = 900_000,
}) {
  let active = true;
  diagnostics.startedAt = new Date().toISOString();
  diagnostics.samples = 0;
  const deadline = Date.now() + timeoutMs;
  // Arm before clicking Install, independently of any renderer or host queue.
  const watcher = (async () => {
    while (active) {
      assert(Date.now() < deadline, 'Timed out observing a real detached upgrade');
      diagnostics.samples++;
      const observation = await observeDetachedUpgrade(installRoot);
      if (observation) {
        diagnostics.observed = observation;
        await cancelInstall(observation);
        diagnostics.cancelSentAt = new Date().toISOString();
        return observation;
      }
      if (diagnostics.samples % 40 === 0) {
        const terminal = await readTerminalEvent(eventsLog);
        assert(
          !terminal,
          `Upgrade ended before post-detach cancellation: ${JSON.stringify(terminal)}`,
        );
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return null;
  })().then(
    value => ({ value }),
    error => ({ error }),
  );
  try {
    await startInstall();
    const outcome = await watcher;
    if (outcome.error) throw outcome.error;
    return outcome.value;
  } finally {
    active = false;
    await watcher; // Always stop the observer when starting the real UI fails.
  }
}
