import { AppError } from 'agent-device';
import { expect, test } from 'vite-plus/test';
import { classifyError } from '../src/driver/agent-device.ts';

test('a claimed device reads its owner from the details bag', () => {
  const failure = classifyError(
    new AppError('DEVICE_IN_USE', 'Device is already in use', { session: 'lex' }),
  );
  expect(failure).toEqual({
    kind: 'device-busy',
    owner: 'lex',
    detail: 'Device is already in use',
  });
});

test('a claimed device falls back to the owner named in the message', () => {
  const failure = classifyError(
    new AppError('DEVICE_IN_USE', `Device is already in use by session "lex"`),
  );
  expect(failure.kind).toBe('device-busy');
  if (failure.kind !== 'device-busy') return;
  expect(failure.owner).toBe('lex');
});

test('a superseded ref generation is a stale ref, not an unknown command failure', () => {
  const failure = classifyError(
    new AppError('COMMAND_FAILED', 'Ref @e15 was minted from a superseded snapshot generation', {
      reason: 'ref_generation_mismatch',
      ref: '@e15',
      currentGeneration: 118062,
    }),
  );
  expect(failure.kind).toBe('stale-ref');
});

test('a command timeout is separated from a transport fault under the same code', () => {
  expect(classifyError(new AppError('COMMAND_FAILED', 'wait timed out for text: Home')).kind).toBe(
    'timeout',
  );
  const other = classifyError(
    new AppError('COMMAND_FAILED', 'runner crashed', { logPath: '/tmp/run.ndjson' }),
  );
  expect(other).toEqual({
    kind: 'unknown',
    code: 'COMMAND_FAILED',
    detail: 'runner crashed',
    logPath: '/tmp/run.ndjson',
  });
});

test('a session bound to another device carries what it was bound to', () => {
  const failure = classifyError(
    new AppError(
      'INVALID_ARGS',
      'open is already bound to session tappet-ios-0 on android device emulator-5554',
    ),
  );
  expect(failure.kind).toBe('session-rebound');
  if (failure.kind !== 'session-rebound') return;
  expect(failure.boundTo).toBe('session tappet-ios-0 on android device emulator-5554');
});

test('the remaining codes map onto their own kinds', () => {
  expect(classifyError(new AppError('DEVICE_NOT_FOUND', 'no device')).kind).toBe('device-missing');
  expect(classifyError(new AppError('APP_NOT_INSTALLED', 'not installed')).kind).toBe(
    'app-missing',
  );
  expect(classifyError(new AppError('AMBIGUOUS_MATCH', 'matched multiple')).kind).toBe('ambiguous');
  expect(classifyError(new AppError('INVALID_ARGS', 'bad flag')).kind).toBe('unknown');
  expect(classifyError(new Error('something else')).kind).toBe('unknown');
});
