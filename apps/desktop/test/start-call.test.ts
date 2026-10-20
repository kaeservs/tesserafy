/**
 * Starting a call both sides of which are heard: the call exists before its
 * transcription is asked for, the request names it, and a step that fails
 * stops the ones after it and lets the audio go.
 */
import { describe, expect, it } from 'vitest';
import { startCall, type StartSteps } from '../src/renderer/start-call';

const CALL = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';

/** Steps that record what was asked, in order, each answering as told. */
function steps(answers: {
  audio?: Awaited<ReturnType<StartSteps<string>['audio']>>;
  call?: Awaited<ReturnType<StartSteps<string>['call']>>;
  transcribe?: Awaited<ReturnType<StartSteps<string>['transcribe']>>;
} = {}) {
  const asked: string[] = [];
  const released: string[] = [];
  const run: StartSteps<string> = {
    audio: async () => {
      asked.push('audio');
      return answers.audio ?? 'microphone and sound output';
    },
    call: async () => {
      asked.push('call');
      return answers.call ?? { conversationId: CALL };
    },
    transcribe: async (conversationId) => {
      asked.push(`transcribe ${conversationId}`);
      return answers.transcribe ?? { ok: true };
    },
    release: (audio) => {
      released.push(audio);
    },
  };
  return { run, asked, released };
}

describe('starting a call that both sides of are heard', () => {
  it('takes the audio, then creates the call, then asks for its transcription by its id', async () => {
    const { run, asked, released } = steps();

    expect(await startCall(run)).toEqual({ audio: 'microphone and sound output', conversationId: CALL });
    expect(asked).toEqual(['audio', 'call', `transcribe ${CALL}`]);
    expect(released).toEqual([]);
  });

  it('never asks for a transcription without a call, and lets the audio go', async () => {
    const { run, asked, released } = steps({ call: { error: 'Live is not on your plan.' } });

    expect(await startCall(run)).toEqual({ error: 'Live is not on your plan.' });
    expect(asked).toEqual(['audio', 'call']);
    expect(released).toEqual(['microphone and sound output']);
  });

  it('treats a call with no id as no call', async () => {
    const { run, asked } = steps({ call: {} });

    expect(await startCall(run)).toEqual({ error: 'The call could not be started.' });
    expect(asked).toEqual(['audio', 'call']);
  });

  it('says why when there is no microphone, and creates no call nobody can be heard on', async () => {
    const { run, asked, released } = steps({ audio: { error: 'the microphone is not available' } });

    expect(await startCall(run)).toEqual({ error: 'the microphone is not available' });
    expect(asked).toEqual(['audio']);
    expect(released).toEqual([]);
  });

  it('passes on a refused transcription with its plan page, and lets the audio go', async () => {
    const { run, released } = steps({ transcribe: { error: 'Your plan has no live minutes left this month.', upgrade: true } });

    expect(await startCall(run)).toEqual({ error: 'Your plan has no live minutes left this month.', upgrade: true });
    expect(released).toEqual(['microphone and sound output']);
  });
});
