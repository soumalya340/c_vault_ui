import { describe, it, expect } from 'vitest';
import { parseClientCommand } from '@/lib/realtime/types';

describe('parseClientCommand', () => {
  it('accepts a valid subscribe command', () => {
    expect(parseClientCommand('{"type":"subscribe","vaultId":3}')).toEqual({
      type: 'subscribe',
      vaultId: 3,
    });
  });

  it('accepts vault id zero', () => {
    expect(parseClientCommand('{"type":"subscribe","vaultId":0}')).toEqual({
      type: 'subscribe',
      vaultId: 0,
    });
  });

  it('rejects malformed json', () => {
    expect(parseClientCommand('not json')).toBeNull();
  });

  it('rejects an unknown command type', () => {
    expect(parseClientCommand('{"type":"evil","vaultId":1}')).toBeNull();
  });

  it('rejects a non-integer vault id', () => {
    expect(parseClientCommand('{"type":"subscribe","vaultId":1.5}')).toBeNull();
  });

  it('rejects a negative vault id', () => {
    expect(parseClientCommand('{"type":"subscribe","vaultId":-1}')).toBeNull();
  });

  it('rejects a missing vault id', () => {
    expect(parseClientCommand('{"type":"subscribe"}')).toBeNull();
  });
});
