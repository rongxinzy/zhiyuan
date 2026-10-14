import { expect, test } from 'vitest';
import {
  BuiltinCodingSelectionOff,
  buildBuiltinCodingCommandList,
  parseBuiltinCodingControlCommand,
  parseBuiltinCodingPrompt,
} from './builtinCodingCommands';

test('advertises only supported local controls and optional experts', () => {
  expect(buildBuiltinCodingCommandList().map(command => command.name)).toEqual([
    'compact',
    'status',
  ]);
  const choices = {
    experts: [{ id: 'reviewer', name: 'Reviewer', description: 'Reviews designs.' }],
  };
  const commands = buildBuiltinCodingCommandList(choices);
  expect(commands.map(command => command.name)).toEqual(['expert', 'compact', 'status']);
  expect(commands[0].input?.options).toEqual([
    { value: 'reviewer', label: 'Reviewer', description: 'Reviews designs.' },
    { value: BuiltinCodingSelectionOff, label: expect.any(String) },
  ]);
  for (const name of ['mcp', 'skill', 'skills', 'goal', 'plan']) {
    expect(commands.some(command => command.name === name)).toBe(false);
  }
});

test('retired commands stay ordinary text and are never local controls', () => {
  for (const prompt of [
    '/mcp',
    '/mcp github',
    '/skill pdf fill it',
    '/skill off continue',
    '/goal ship it',
    '/plan review it',
  ]) {
    expect(parseBuiltinCodingControlCommand(prompt)).toBeNull();
    expect(parseBuiltinCodingPrompt(prompt)).toEqual({ prompt });
  }
});

test('recognizes only bare supported control commands', () => {
  expect(parseBuiltinCodingControlCommand('/compact')).toEqual({ command: 'compact' });
  expect(parseBuiltinCodingControlCommand('  /status  ')).toEqual({ command: 'status' });
  for (const prompt of ['/compact module', '/status please', 'run /compact', '/unknown']) {
    expect(parseBuiltinCodingControlCommand(prompt)).toBeNull();
  }
});

test('selects and clears experts while preserving unknown or incomplete text', () => {
  const choices = { experts: [{ id: 'reviewer', name: 'Reviewer', description: '' }] };
  expect(parseBuiltinCodingPrompt('/expert reviewer review it', choices)).toEqual({
    prompt: 'review it',
    selection: { kind: 'expert', id: 'reviewer' },
  });
  expect(parseBuiltinCodingPrompt('/expert off review it', choices)).toEqual({
    prompt: 'review it',
    selection: { kind: 'expert', id: null },
  });
  for (const prompt of [
    '/expert reviewer',
    '/expert missing review it',
    'use /expert reviewer',
    'ordinary task',
  ]) {
    expect(parseBuiltinCodingPrompt(prompt, choices)).toEqual({ prompt });
  }
});

test('lets an installed expert own the reserved clearing argument', () => {
  const choices = {
    experts: [{ id: BuiltinCodingSelectionOff, name: 'Off switch', description: '' }],
  };
  expect(buildBuiltinCodingCommandList(choices)[0].input?.options).toEqual([
    { value: BuiltinCodingSelectionOff, label: 'Off switch' },
  ]);
  expect(parseBuiltinCodingPrompt('/expert off review it', choices)).toEqual({
    prompt: 'review it',
    selection: { kind: 'expert', id: BuiltinCodingSelectionOff },
  });
});
