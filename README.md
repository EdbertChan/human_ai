# EmapthyAi

EmapthyAi helps you say what you mean with the right tone. It works as a
keyboard companion for messages: choose a persona, rewrite the complete draft,
or speak the result in your own saved voice fingerprint.

## What it does

- **Rewrite:** sends the current text-box contents to the configured language
  model and returns a complete rewrite.
- **Personas:** choose Corporate, Personable, Warm, or Empathy when available.
- **Speak:** rewrites the current draft first, then sends that complete text to
  ElevenLabs for voice playback with persona-specific delivery.
- **Voice input:** transcribes a spoken message, rewrites it, and lets you use
  or play either version.
- **Review first:** the original stays available so you decide what to use;
  EmapthyAi does not send messages for you.

## Demo

[Watch or download the desktop recording](website/VIDEO_SUBMISSION.mp4).

The [landing page](website/index.html) includes the same demo in an embedded
player plus a visual walkthrough of the text and voice flows.

## Run locally

Node 22+, Postgres, and server-side provider configuration are required:

```sh
cd website
cp .env.example .env
npm test
npm run start:api
```

See [website/README.md](website/README.md) for database configuration, local
iOS and Android setup, browser-extension behavior, and verification commands.

Provider keys stay on the server; they are never embedded in a client build.
