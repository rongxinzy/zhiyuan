import { expect, test } from 'vitest';
import { buildScheduledTaskEnginePrompt } from './enginePrompt';

test('scheduled guidance keeps durable execution in Pi and results inside the application', () => {
  const prompt = buildScheduledTaskEnginePrompt();
  expect(prompt).toContain('ZhiYuan scheduled-task API');
  expect(prompt).toContain('Pi Durable Task owns execution and recovery');
  expect(prompt).toContain('explicit timezone offset');
  expect(prompt).toContain('application session and execution history');
  expect(prompt).not.toMatch(/\bIM\b|cc-connect|delivery|QQBOT/i);
});
