# ElevenLabs expressive speech pipeline

## Scope and flow

The implemented pipeline converts completed application messages to expressive audio. Its input is already text; speech recognition, microphone capture, emotion classification, rewriting, auth, persistence, and browser playback are outside this service.

```text
Completed message text + trusted delivery phrase
  -> construct Eleven v3 delivery tag
  -> ElevenLabs raw streaming response
  -> preflight first non-empty chunk
  -> stream MP3 bytes through FastAPI
```

## API boundary

`POST /v1/speech` accepts:

```json
{
  "text": "I found your order. It will arrive tomorrow.",
  "tone": "warm, relieved, and reassuring"
}
```

Both fields must be strings with non-whitespace content. Invalid requests return 422 without a provider call. The frozen request model validates without changing either value. `text` is preserved byte-for-byte. `tone` is an unbracketed delivery phrase; the service strips only its outer whitespace and sends:

```text
[warm, relieved, and reassuring] I found your order. It will arrive tomorrow.
```

Trusted audio tags such as `[short pause]`, `[whispers]`, `[sighs]`, or `[laughs]` belong in `text` and pass through unchanged. The service does not invent tags, laughter, sighs, filler, breathing, SSML, or rewritten prose.

## Provider contract

- SDK: official `AsyncElevenLabs` raw response stream.
- Model: `eleven_v3`.
- Output: `mp3_44100_128`.
- API key: backend-only `ELEVENLABS_API_KEY`; missing or blank fails startup.
- Voice: `ELEVENLABS_VOICE_ID`, defaulting to George (`JBFqnCBsd6RMkjVDRZzb`) when missing or blank.
- Initial audio timeout: positive finite `ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS`, default `10.0` seconds.
- Retry policy: `request_options={"max_retries": 0}`; quota-spending speech requests are never retried automatically.
- Voice settings: provider defaults; no stability, similarity, or speed tuning until listening evidence identifies a repeatable issue.

The endpoint owns the raw response with an `AsyncExitStack`. Before committing HTTP headers, `anyio.fail_after` bounds iteration until the first non-empty chunk. Remaining non-empty chunks are forwarded unchanged and in order.

## HTTP and lifecycle behavior

A successful response is `audio/mpeg` with:

```text
Cache-Control: no-store
X-AI-Generated-Voice: true
```

- A provider rejection or clean end-of-stream before audio maps to 502 with `{"detail":"ElevenLabs speech generation failed."}`.
- Failure to receive initial audio before the timeout maps to 504 with `{"detail":"ElevenLabs initial audio chunk timed out."}`.
- A provider failure after playback begins terminates the incomplete response; its HTTP status cannot be replaced after headers are sent.
- Timeout, empty stream, provider failure, normal completion, cancellation, and caller disconnect all close the provider response context.

Post-start failure logging emits the stable event `elevenlabs_stream_failed` with only the provider `request_id`, or `unavailable`. The API key, `text`, `tone`, provider response body, and audio bytes are never logged.

## Listening acceptance matrix

Each fixed case must preserve the literal message, make the requested delivery recognizable, use natural sentence-aware pacing, and avoid exaggerated effects.

| Case | `tone` | `text` |
| --- | --- | --- |
| Reassurance | `warm, relieved, and reassuring` | `Maya Chen, your $1,249.50 refund will arrive by September 18, 2026.` |
| Urgency | `urgent, clear, and composed` | `The ETA changed to 4:30 PM. Call +1 (415) 555-0137 now.` |
| Excitement | `quietly excited and celebratory` | `Great news! Your prototype passed every demo check.` |
| Apology | `sincere, calm, and accountable` | `I am sorry we missed your delivery window. We are fixing it now.` |
| Sadness | `gentle, subdued, and compassionate` | `[short pause] I am sorry to hear that the community center is closing.` |
| Understated humor | `dry and understated` | `The printer has formed another strong opinion about paper.` |

## Operations and attribution

Install and run from `server/`:

```bash
uv sync
export ELEVENLABS_API_KEY="your-backend-only-key"
uv run uvicorn speech_service.main:app --host 127.0.0.1 --port 8000
```

Stop Uvicorn with `Ctrl-C`; client disconnects also close their active provider streams. The operational curl request and artifact cleanup are in `README.md`.

Whenever the ElevenLabs free plan is used, the consuming UI must visibly show [Voice generated with ElevenLabs](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform). Current terms must be checked before public or commercial use. This backend establishes that downstream contract; it does not claim the consuming UI is complete.
