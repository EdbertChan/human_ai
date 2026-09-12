# Copyright (c) 2026 EdbertChan
"""Provider client lifecycle regression tests."""

import httpx
import pytest
from elevenlabs.client import AsyncElevenLabs

import speech_service.main as speech_main
from speech_service.main import ClientUnavailableError


def expect(*, condition: bool) -> None:
    """Fail the active pytest case when its expectation is false."""
    if not condition:
        pytest.fail("expectation failed")


@pytest.fixture
def anyio_backend() -> str:
    """Use the SDK-compatible AnyIO backend."""
    return "asyncio"


@pytest.mark.anyio
async def test_lifespan_reuses_provider_and_closes_http_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Own one shared provider transport for the application lifespan."""
    # Given
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test")
    created: list[tuple[AsyncElevenLabs, httpx.AsyncClient | None]] = []
    real_client = AsyncElevenLabs

    def build_provider(
        *, api_key: str, httpx_client: httpx.AsyncClient | None = None
    ) -> AsyncElevenLabs:
        provider = real_client(api_key=api_key, httpx_client=httpx_client)
        created.append((provider, httpx_client))
        return provider

    monkeypatch.setattr(speech_main, "AsyncElevenLabs", build_provider)

    # When
    async with speech_main.lifespan(speech_main.app):
        first = speech_main.get_client()
        second = speech_main.get_client()

        # Then
        expect(condition=first is second)
        expect(condition=len(created) == 1)
        provider_http = created[0][1]
        if provider_http is None:
            pytest.fail("provider HTTP client was not injected")
        expect(condition=not provider_http.is_closed)

    expect(condition=provider_http.is_closed)
    with pytest.raises(ClientUnavailableError):
        speech_main.get_client()
