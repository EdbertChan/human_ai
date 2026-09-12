# Copyright (c) 2026 EdbertChan
"""Deterministic provider support for speech tests."""

from collections.abc import AsyncIterator

import anyio
import httpx
from elevenlabs.client import AsyncElevenLabs
from elevenlabs.core.api_error import ApiError

from speech_service.main import app, get_client


class ObservedStream(httpx.AsyncByteStream):
    """Expose deterministic provider chunks and closure state."""

    def __init__(
        self,
        chunks: tuple[bytes, ...] = (),
        *,
        block: bool = False,
        fail_after_chunks: bool = False,
    ) -> None:
        """Configure provider chunks and terminal behavior."""
        self.chunks = chunks
        self.block = block
        self.fail_after_chunks = fail_after_chunks
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        """Yield configured bytes before blocking or failing."""
        for chunk in self.chunks:
            yield chunk
        if self.block:
            await anyio.sleep_forever()
        if self.fail_after_chunks:
            raise ApiError(status_code=500, headers={}, body="fixture-provider-body")

    async def aclose(self) -> None:
        """Record provider response cleanup."""
        self.closed = True


async def post_with_provider(provider: AsyncElevenLabs, payload: dict[str, str]) -> httpx.Response:
    """Send one ASGI request through an injected provider client."""
    app.dependency_overrides[get_client] = lambda: provider
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/v1/speech", json=payload)
    finally:
        app.dependency_overrides.clear()
