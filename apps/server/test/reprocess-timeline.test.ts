import { describe, expect, it } from 'vitest'
import {
  buildReprocessTranscripts,
  buildReprocessTimelineTranscript,
  buildReprocessTimelineWords,
} from '../src/analytics/reprocessTimeline'

describe('reprocess timeline', () => {
  it('shifts resumed-segment words onto the merged Replay timeline', () => {
    const resolvedSegments = [
      {
        segmentId: 'segment-1',
        segmentIndex: 0,
        replayOffsetSec: 0,
        durationSec: 12.5,
      },
      {
        segmentId: 'segment-2',
        segmentIndex: 1,
        replayOffsetSec: 12.5,
        durationSec: 8,
      },
    ]
    const turns = [
      {
        id: 'turn-1',
        segmentId: 'segment-1',
        words: [
          { w: 'first', start: 1, end: 1.4, timingOrigin: 'actual' },
        ],
      },
      {
        id: 'turn-2',
        segmentId: 'segment-2',
        words: [
          { w: 'second', start: 0.5, end: 1, timingOrigin: 'synthetic' },
        ],
      },
    ]
    const words = buildReprocessTimelineWords(resolvedSegments, turns)

    expect(words).toEqual([
      {
        w: 'first',
        start: 1,
        end: 1.4,
        timingOrigin: 'actual',
        utterance_id: 'turn-1',
      },
      {
        w: 'second',
        start: 13,
        end: 13.5,
        timingOrigin: 'synthetic',
        utterance_id: 'turn-2',
      },
    ])
  })

  it('omits an unreadable middle segment and uses merged-file offsets', () => {
    const resolvedSegments = [
      {
        segmentId: 'segment-1',
        segmentIndex: 0,
        replayOffsetSec: 0,
        durationSec: 10,
      },
      // segment-2 was marked available in DB but its file was unreadable, so
      // the resolver omitted it from both the merge and this timeline.
      {
        segmentId: 'segment-3',
        segmentIndex: 2,
        replayOffsetSec: 10,
        durationSec: 7,
      },
    ]
    const turns = [
      {
        id: 'turn-1',
        segmentId: 'segment-1',
        text: 'first',
        words: [{ w: 'first', start: 1, end: 2, timingOrigin: 'actual' }],
      },
      {
        id: 'turn-2',
        segmentId: 'segment-2',
        text: 'missing',
        words: [{ w: 'missing', start: 1, end: 2, timingOrigin: 'actual' }],
      },
      {
        id: 'turn-3',
        segmentId: 'segment-3',
        text: 'last',
        words: [{ w: 'last', start: 1, end: 2, timingOrigin: 'actual' }],
      },
    ]
    const words = buildReprocessTimelineWords(resolvedSegments, turns)

    expect(words.map((word) => [word.w, word.start, word.end])).toEqual([
      ['first', 1, 2],
      ['last', 11, 12],
    ])
    expect(buildReprocessTimelineTranscript(resolvedSegments, turns)).toBe('first last')
    expect(
      buildReprocessTranscripts('first missing last', resolvedSegments, turns),
    ).toEqual({
      contentTranscript: 'first missing last',
      deliveryTranscript: 'first last',
    })
  })
})
