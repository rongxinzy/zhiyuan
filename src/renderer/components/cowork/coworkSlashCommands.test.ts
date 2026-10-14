import { expect, test } from 'vitest';
import {
  buildCoworkSlashCommands,
  coworkSlashCommandPrompt,
  coworkSlashCommandQuery,
  filterCoworkSlashCommands,
  parseCoworkSlashSubmission,
} from './coworkSlashCommands';

const commands = [{ name: 'compact', description: 'Compact the current session context' }];

test('only offers compaction when there is a session', () => {
  expect(
    buildCoworkSlashCommands({ compact: true }, { compactDescription: commands[0].description }),
  ).toEqual(commands);
  expect(buildCoworkSlashCommands({ compact: false }, { compactDescription: 'Compact' })).toEqual(
    [],
  );
});

test('retains discovery, filtering and command insertion', () => {
  expect(coworkSlashCommandQuery('/')).toBe('');
  expect(coworkSlashCommandQuery('/com')).toBe('com');
  expect(coworkSlashCommandQuery('please /compact')).toBeNull();
  expect(filterCoworkSlashCommands(commands, 'context')).toEqual(commands);
  expect(filterCoworkSlashCommands(commands, 'skill')).toEqual([]);
  expect(coworkSlashCommandPrompt(commands[0])).toBe('/compact');
});

test('only intercepts the explicit whole-input compact command', () => {
  expect(parseCoworkSlashSubmission(' /compact ', { compactAvailable: true })).toEqual({
    kind: 'compact',
  });
  expect(parseCoworkSlashSubmission('/compact', { compactAvailable: false })).toEqual({
    kind: 'prompt',
    prompt: '/compact',
  });
});

test.each([
  '/skill',
  '/skill pdf',
  '/skill pdf make a document',
  '/compact the text',
  '/review diff',
])('forwards ordinary slash text unchanged: %s', prompt => {
  expect(parseCoworkSlashSubmission(prompt, { compactAvailable: true })).toEqual({
    kind: 'prompt',
    prompt,
  });
});
