import { describe, it, expect } from 'vitest';
import {
  NotImplementedError, isNotImplementedError, NotFoundError, isNotFoundError,
} from '../../src/comments/api/thread-ops';
import { asThreadId } from '../../src/comments/review-ux/types';

// The shared reserved-op error is the single source of the 'op not yet supported'
// wire message: every store throws it and the handler derives its 400/transient
// text from it. Pinning the message here makes an accidental edit fail a test
// rather than silently change the response body.
describe('NotImplementedError', () => {
  it('carries the canonical reserved-op message and name', () => {
    const err = new NotImplementedError();
    expect(err.message).toBe('op not yet supported');
    expect(err.name).toBe('NotImplementedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('is recognized by its own guard and NOT by isNotFoundError', () => {
    const err = new NotImplementedError();
    expect(isNotImplementedError(err)).toBe(true);
    expect(isNotFoundError(err)).toBe(false);
  });

  it('does not cross-match a NotFoundError', () => {
    const err = new NotFoundError(asThreadId('t1'));
    expect(isNotFoundError(err)).toBe(true);
    expect(isNotImplementedError(err)).toBe(false);
  });
});
