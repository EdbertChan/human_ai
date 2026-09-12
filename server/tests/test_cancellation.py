# Copyright (c) 2026 EdbertChan
"""Cancellation regression tests for speech preflight."""

import anyio
import httpx
import pytest
from elevenlabs.client import AsyncElevenLabs

from speech_service.main import SpeechRequest, speech
from tests.support import CancellationStream


def expect(*, condition: bool) -> None:
    """Fail the active pytest case when its expectation is false."""
    if not condition:
        pytest.fail("expectation failed")


@pytest.fixture
def anyio_backend() -> str:
    """Use the SDK-compatible AnyIO backend."""
    return "asyncio"


@pytest.mark.anyio
async def test_cancelled_initial_prefetch_propagates_and_closes_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Close raw provider I/O when cancellation interrupts initial audio."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    stream = CancellationStream()

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=stream)

    cancellation_propagated = False

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as provider_http:
        provider = AsyncElevenLabs(api_key="test", httpx_client=provider_http)

        async def invoke_speech() -> None:
            nonlocal cancellation_propagated
            try:
                await speech(SpeechRequest(text="hello", tone="warm"), provider)
            except anyio.get_cancelled_exc_class():
                cancellation_propagated = True
                raise

        # When
        async with anyio.create_task_group() as task_group:
            task_group.start_soon(invoke_speech)
            await stream.started.wait()
            task_group.cancel_scope.cancel()

        # Then
        expect(condition=cancellation_propagated)
        expect(condition=stream.closed)
