import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import {
  gaProgressChannel,
  publishProgressEvent,
  type ProgressEvent,
} from '../../src/worker/progressChannel';

describe('progressChannel', () => {
  describe('gaProgressChannel', () => {
    it('uses the api_design §7 channel naming convention', () => {
      expect(gaProgressChannel('abc123')).toBe('ga-progress:abc123');
    });

    it('does not mutate the runId', () => {
      const runId = 'cuid-with-dashes-and-stuff';
      expect(gaProgressChannel(runId)).toBe(`ga-progress:${runId}`);
    });
  });

  describe('publishProgressEvent', () => {
    function makeRedisStub(): {
      redis: Redis;
      calls: Array<{ channel: string; payload: string }>;
    } {
      const calls: Array<{ channel: string; payload: string }> = [];
      const stub = {
        publish: vi.fn(async (channel: string, payload: string) => {
          calls.push({ channel, payload });
          return 1;
        }),
      };
      return { redis: stub as unknown as Redis, calls };
    }

    it('JSON-encodes a state event', async () => {
      const { redis, calls } = makeRedisStub();
      const event: ProgressEvent = { type: 'state', status: 'RUNNING' };

      await publishProgressEvent(redis, 'r1', event);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.channel).toBe('ga-progress:r1');
      expect(JSON.parse(calls[0]!.payload)).toEqual({
        type: 'state',
        status: 'RUNNING',
      });
    });

    it('JSON-encodes a progress event with the full snapshot', async () => {
      const { redis, calls } = makeRedisStub();
      const event: ProgressEvent = {
        type: 'progress',
        snapshot: {
          generation: 7,
          bestFitness: 0.95,
          avgFitness: 0.5,
          hardViolations: 1,
          softPenalty: 3,
          competencyMismatch: 0,
          structuralPenalty: 1,
          preferencePenalty: 2,
        },
      };

      await publishProgressEvent(redis, 'r1', event);

      expect(JSON.parse(calls[0]!.payload)).toEqual(event);
    });

    it('JSON-encodes an error event', async () => {
      const { redis, calls } = makeRedisStub();
      const event: ProgressEvent = { type: 'error', message: 'boom' };

      await publishProgressEvent(redis, 'r1', event);

      expect(JSON.parse(calls[0]!.payload)).toEqual({
        type: 'error',
        message: 'boom',
      });
    });
  });
});
