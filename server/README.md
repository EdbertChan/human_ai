# ElevenLabs speech server

This FastAPI service turns trusted application text and a delivery phrase into a streaming ElevenLabs MP3 response.

## Run locally

Python 3.12 or newer and `uv` are required.

```bash
uv sync
export ELEVENLABS_API_KEY="your-backend-only-key"
export ELEVENLABS_VOICE_ID="JBFqnCBsd6RMkjVDRZzb"
export ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS="10.0"
uv run uvicorn speech_service.main:app --host 127.0.0.1 --port 8000
```

The API key must be non-blank. The initial-chunk timeout must be finite and greater than zero. The voice and timeout exports are optional: George (`JBFqnCBsd6RMkjVDRZzb`) and `10.0` seconds are the defaults. Environment files are not loaded by the service.

In another terminal:

```bash
curl --no-buffer \
  -D response.headers \
  -o response.mp3 \
  -H 'content-type: application/json' \
  -d '{"text":"Maya Chen, your $1,249.50 refund will arrive by September 18, 2026.","tone":"warm, relieved, and reassuring"}' \
  http://127.0.0.1:8000/v1/speech
```

Stop Uvicorn with `Ctrl-C`, then remove the request artifacts with `rm response.headers response.mp3`.

## Request and response contract

`text` and `tone` are required strings; missing, non-string, or whitespace-only values return 422 before ElevenLabs is contacted. `text` passes through unchanged. `tone` is an unbracketed delivery phrase; only its outer whitespace is removed before the service sends `[{tone}] {text}`. Trusted Eleven v3 audio tags such as `[short pause]` or `[whispers]` belong in `text` and pass through unchanged.

Successful responses stream ordered bytes as `audio/mpeg` with `Cache-Control: no-store` and `X-AI-Generated-Voice: true`. The service uses model `eleven_v3`, output `mp3_44100_128`, and `request_options={"max_retries": 0}` so provider requests are not retried.

- 502 `{"detail":"ElevenLabs speech generation failed."}`: provider rejection or no audio.
- 504 `{"detail":"ElevenLabs initial audio chunk timed out."}`: no first non-empty chunk before the configured timeout.
- Failure or caller disconnect after streaming starts terminates the incomplete response and closes provider resources.

Logs never contain the API key, `text`, `tone`, or provider body. A post-start failure records only `elevenlabs_stream_failed` and the provider `request_id`, or `unavailable`.

## Listening matrix

Run each row through the curl command above by replacing its JSON body. Confirm literal text fidelity, recognizable tone, natural sentence-aware pacing, and no exaggerated effects.

| Case | `tone` | `text` |
| --- | --- | --- |
| Reassurance | `warm, relieved, and reassuring` | `Maya Chen, your $1,249.50 refund will arrive by September 18, 2026.` |
| Urgency | `urgent, clear, and composed` | `The ETA changed to 4:30 PM. Call +1 (415) 555-0137 now.` |
| Excitement | `quietly excited and celebratory` | `Great news! Your prototype passed every demo check.` |
| Apology | `sincere, calm, and accountable` | `I am sorry we missed your delivery window. We are fixing it now.` |
| Sadness | `gentle, subdued, and compassionate` | `[short pause] I am sorry to hear that the community center is closing.` |
| Understated humor | `dry and understated` | `The printer has formed another strong opinion about paper.` |

## Attribution

When audio is generated under the ElevenLabs free plan, the consuming UI must display the visible linked text [Voice generated with ElevenLabs](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform). Verify the current terms before every public or commercial use; this backend documents the downstream requirement but does not implement a UI.
