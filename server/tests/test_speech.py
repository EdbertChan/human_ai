# Copyright (c) 2026 EdbertChan
"""Speech service configuration and streaming tests."""

import json
import logging
from math import inf, nan

import anyio
import httpx
import pytest
from elevenlabs.client import AsyncElevenLabs
from fastapi import status
from starlette.types import Message, Scope

from speech_service.main import (
    ConfigurationError,
    SpeechStreamError,
    app,
    get_client,
    settings,
)
from tests.support import ObservedStream, post_with_provider

EXPECTED_TIMEOUT = 10.0


def expect(*, condition: bool) -> None:
    """Fail the active pytest case when its expectation is false."""
    if not condition:
        pytest.fail("expectation failed")


@pytest.fixture(autouse=True)
def configured_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provide valid default environment configuration."""
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)
    monkeypatch.delenv("ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS", raising=False)


@pytest.fixture
def anyio_backend() -> str:
    """Use the SDK-compatible AnyIO backend."""
    return "asyncio"


def test_configuration_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reject startup configuration without an API key."""
    # Given
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)

    # When / Then
    with pytest.raises(ConfigurationError, match="ELEVENLABS_API_KEY"):
        settings()


@pytest.mark.parametrize("timeout", ["0", "-1", str(inf), str(nan), "invalid"])
def test_configuration_rejects_invalid_timeout(
    monkeypatch: pytest.MonkeyPatch, timeout: str
) -> None:
    """Reject non-positive, non-finite, and malformed timeouts."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    monkeypatch.setenv("ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS", timeout)

    # When / Then
    with pytest.raises(ConfigurationError, match="INITIAL_CHUNK_TIMEOUT"):
        settings()


def test_configuration_uses_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use George and ten seconds when overrides are absent."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)
    monkeypatch.delenv("ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS", raising=False)

    # When
    result = settings()

    # Then
    expect(condition=result.voice_id == "JBFqnCBsd6RMkjVDRZzb")
    expect(condition=result.initial_chunk_timeout == EXPECTED_TIMEOUT)


def test_voice_override_is_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    """Preserve a distinct configured voice identifier."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "different-voice")

    # When
    result = settings()

    # Then
    expect(condition=result.voice_id == "different-voice")


@pytest.mark.anyio
@pytest.mark.parametrize(
    "payload",
    [
        {"tone": "warm"},
        {"text": "hello"},
        {"text": "", "tone": "warm"},
        {"text": " \t", "tone": "warm"},
        {"text": "hello", "tone": ""},
        {"text": "hello", "tone": " \n"},
        {"text": 1, "tone": "warm"},
        {"text": "hello", "tone": 1},
    ],
)
async def test_validation_rejects_invalid_fields_without_provider_call(
    payload: dict[str, str],
) -> None:
    """Reject missing, blank, and non-string fields before provider I/O."""
    # Given
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, stream=ObservedStream((b"audio",)))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When
        response = await post_with_provider(provider, payload)

    # Then
    expect(condition=response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT)
    expect(condition=requests == [])


@pytest.mark.anyio
async def test_provider_receives_exact_text_and_fixed_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Preserve text and send the fixed model, output, and voice settings."""
    # Given
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice-override")
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, stream=ObservedStream((b"audio",)))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When
        response = await post_with_provider(
            provider,
            {"text": "  Maya [short pause] stays.  ", "tone": "  softly  "},
        )

    # Then
    expect(condition=response.status_code == status.HTTP_200_OK)
    expect(condition=len(requests) == 1)
    request = requests[0]
    expect(condition=request.url.path.endswith("/voice-override/stream"))
    expect(condition=request.url.params["output_format"] == "mp3_44100_128")
    expect(
        condition=json.loads(request.content)
        == {
            "text": "[softly]   Maya [short pause] stays.  ",
            "model_id": "eleven_v3",
        }
    )


@pytest.mark.anyio
async def test_provider_rejection_returns_502() -> None:
    """Map a pre-stream provider rejection to HTTP 502 without retries."""
    # Given
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(500, json={"error": "fixture-provider-body"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When
        response = await post_with_provider(provider, {"text": "hello", "tone": "warm"})

    # Then
    expect(condition=response.status_code == status.HTTP_502_BAD_GATEWAY)
    expect(condition=response.json() == {"detail": "ElevenLabs speech generation failed."})
    expect(condition=len(requests) == 1)


@pytest.mark.anyio
async def test_empty_provider_stream_returns_502_and_closes() -> None:
    """Map clean pre-audio EOF to HTTP 502 and close the response."""
    # Given
    stream = ObservedStream()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When
        response = await post_with_provider(provider, {"text": "hello", "tone": "warm"})

    # Then
    expect(condition=response.status_code == status.HTTP_502_BAD_GATEWAY)
    expect(condition=response.json() == {"detail": "ElevenLabs speech generation failed."})
    expect(condition=stream.closed)


@pytest.mark.anyio
async def test_initial_chunk_timeout_returns_504_and_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Map initial audio latency to HTTP 504 and close the response."""
    # Given
    monkeypatch.setenv("ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS", "0.01")
    stream = ObservedStream(block=True)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When
        response = await post_with_provider(provider, {"text": "hello", "tone": "warm"})

    # Then
    expect(condition=response.status_code == status.HTTP_504_GATEWAY_TIMEOUT)
    expect(condition=response.json() == {"detail": "ElevenLabs initial audio chunk timed out."})
    expect(condition=stream.closed)


@pytest.mark.anyio
async def test_audio_chunks_and_headers_are_forwarded_in_order() -> None:
    """Forward ordered audio with disclosure and cache headers."""
    # Given
    stream = ObservedStream((b"", b"ID3", b"abc"))

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When
        response = await post_with_provider(provider, {"text": "hello", "tone": "warm"})

    # Then
    expect(condition=response.status_code == status.HTTP_200_OK)
    expect(condition=response.content == b"ID3abc")
    expect(condition=response.headers["content-type"] == "audio/mpeg")
    expect(condition=response.headers["cache-control"] == "no-store")
    expect(condition=response.headers["x-ai-generated-voice"] == "true")
    expect(condition=stream.closed)


@pytest.mark.anyio
async def test_post_start_failure_logs_only_request_id(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Redact request content when a started provider stream fails."""
    # Given
    stream = ObservedStream((b"I" * 1024,), fail_after_chunks=True)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"request-id": "req-123"}, stream=stream)

    caplog.set_level(logging.WARNING)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When / Then
        with pytest.raises(SpeechStreamError) as caught:
            await post_with_provider(
                provider,
                {"text": "SECRET_FIXTURE_TEXT", "tone": "SECRET_FIXTURE_TONE"},
            )

    expect(condition=str(caught.value) == "ElevenLabs speech stream failed.")
    expect(condition="fixture-provider-body" not in str(caught.value))
    expect(condition=len(caplog.records) == 1)
    record = caplog.records[0]
    expect(condition=record.message == "elevenlabs_stream_failed")
    expect(condition=vars(record).get("request_id") == "req-123")
    expect(condition="SECRET_FIXTURE" not in caplog.text)
    expect(condition="fixture-provider-body" not in caplog.text)
    expect(condition=stream.closed)


@pytest.mark.anyio
async def test_disconnect_after_first_body_closes_provider() -> None:
    """Close provider I/O after a caller disconnects during playback."""
    # Given
    stream = ObservedStream((b"I" * 2048,), block=True)

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    first_body = anyio.Event()
    request_received = False

    async def receive() -> Message:
        nonlocal request_received
        if not request_received:
            request_received = True
            return {
                "type": "http.request",
                "body": b'{"text":"hello","tone":"warm"}',
                "more_body": False,
            }
        await first_body.wait()
        return {"type": "http.disconnect"}

    sent: list[Message] = []

    async def send(message: Message) -> None:
        sent.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            first_body.set()

    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/speech",
        "raw_path": b"/v1/speech",
        "query_string": b"",
        "root_path": "",
        "headers": [(b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1234),
        "server": ("test", 80),
        "state": {},
    }

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)
        app.dependency_overrides[get_client] = lambda: provider
        try:
            # When
            with anyio.fail_after(1):
                await app(scope, receive, send)
        finally:
            app.dependency_overrides.clear()

    # Then
    expect(condition=first_body.is_set())
    expect(condition=stream.closed)
    expect(condition=any(message["type"] == "http.response.body" for message in sent))
