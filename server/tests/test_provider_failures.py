# Copyright (c) 2026 EdbertChan
"""Unexpected provider failure regression tests."""

import logging

import httpx
import pytest
from elevenlabs.client import AsyncElevenLabs
from fastapi import status

from speech_service.main import SpeechStreamError
from tests.support import (
    UNEXPECTED_PROVIDER_FAILURE,
    UnexpectedFailureStream,
    post_with_provider,
)


def expect(*, condition: bool) -> None:
    """Fail the active pytest case when its expectation is false."""
    if not condition:
        pytest.fail("expectation failed")


@pytest.fixture
def anyio_backend() -> str:
    """Use the SDK-compatible AnyIO backend."""
    return "asyncio"


@pytest.mark.anyio
async def test_generic_prefetch_failure_returns_502_and_closes_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Map unexpected pre-audio failures and close raw provider I/O."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    stream = UnexpectedFailureStream()

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
async def test_generic_post_start_failure_logs_request_id_and_closes(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Redact unexpected failures after streaming starts and re-raise."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    stream = UnexpectedFailureStream((b"I" * 1024,))

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"request-id": "req-generic"}, stream=stream)

    caplog.set_level(logging.WARNING)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        # When / Then
        with pytest.raises(SpeechStreamError) as caught:
            await post_with_provider(
                provider,
                {"text": "SECRET_GENERIC_TEXT", "tone": "SECRET_GENERIC_TONE"},
            )

        expect(condition=str(caught.value) == "ElevenLabs speech stream failed.")
        expect(condition=UNEXPECTED_PROVIDER_FAILURE not in str(caught.value))
        expect(condition=len(caplog.records) == 1)
        record = caplog.records[0]
        expect(condition=record.message == "elevenlabs_stream_failed")
        expect(condition=vars(record).get("request_id") == "req-generic")
        expect(condition="SECRET_GENERIC" not in caplog.text)
        expect(condition=UNEXPECTED_PROVIDER_FAILURE not in caplog.text)
        expect(condition=stream.closed)
