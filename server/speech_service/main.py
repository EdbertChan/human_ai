# Copyright (c) 2026 EdbertChan
"""FastAPI entrypoint for expressive ElevenLabs speech."""

import logging
import math
import os
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Final

import anyio
import httpx
from elevenlabs.client import AsyncElevenLabs
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, StrictStr, field_validator
from pydantic_core import PydanticCustomError

logger = logging.getLogger(__name__)

DEFAULT_VOICE_ID: Final = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_INITIAL_CHUNK_TIMEOUT: Final = 10.0
MODEL_ID: Final = "eleven_v3"
OUTPUT_FORMAT: Final = "mp3_44100_128"
API_KEY_ENV: Final = "ELEVENLABS_API_KEY"
TIMEOUT_ENV: Final = "ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS"
SPEECH_FAILURE_DETAIL: Final = "ElevenLabs speech generation failed."
INITIAL_TIMEOUT_DETAIL: Final = "ElevenLabs initial audio chunk timed out."
BLANK_ERROR_TYPE: Final = "blank_string"
BLANK_ERROR_MESSAGE: Final = "must not be blank"
STREAM_FAILURE_MESSAGE: Final = "ElevenLabs speech stream failed."
PROVIDER_TIMEOUT: Final = 240.0
PROVIDER_FAILURE: Final = Exception


@dataclass(frozen=True, slots=True)
class ConfigurationError(Exception):
    """Report invalid service environment configuration."""

    setting_name: str

    def __str__(self) -> str:
        """Return a safe configuration error without exposing its value."""
        return f"Invalid or missing {self.setting_name}."


class SpeechStreamError(Exception):
    """Terminate a started stream without exposing provider details."""

    def __str__(self) -> str:
        """Return the fixed safe message exposed to outer ASGI logging."""
        return STREAM_FAILURE_MESSAGE


class ClientUnavailableError(Exception):
    """Report dependency access outside the application lifespan."""


class ClientLifecycle:
    """Hold the provider client only while the application is running."""

    def __init__(self) -> None:
        """Initialize without an active provider client."""
        self.provider: AsyncElevenLabs | None = None


_client_lifecycle: Final = ClientLifecycle()


@dataclass(frozen=True, slots=True)
class Settings:
    """Hold validated process configuration."""

    api_key: str
    voice_id: str
    initial_chunk_timeout: float


class SpeechRequest(BaseModel):
    """Parse speech requests without changing caller-provided text."""

    model_config = ConfigDict(frozen=True)

    text: StrictStr
    tone: StrictStr

    @field_validator("text", "tone")
    @classmethod
    def _require_content(cls, value: str) -> str:
        if not value.strip():
            raise PydanticCustomError(BLANK_ERROR_TYPE, BLANK_ERROR_MESSAGE)
        return value


def settings() -> Settings:
    """Parse and validate service configuration from the environment."""
    api_key = os.getenv(API_KEY_ENV, "")
    if not api_key.strip():
        raise ConfigurationError(API_KEY_ENV)

    timeout_value = os.getenv(
        TIMEOUT_ENV,
        str(DEFAULT_INITIAL_CHUNK_TIMEOUT),
    )
    try:
        timeout = float(timeout_value)
    except ValueError as error:
        raise ConfigurationError(TIMEOUT_ENV) from error
    if not math.isfinite(timeout) or timeout <= 0:
        raise ConfigurationError(TIMEOUT_ENV)

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "").strip() or DEFAULT_VOICE_ID
    return Settings(api_key, voice_id, timeout)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
    """Validate configuration before accepting requests."""
    config = settings()
    async with httpx.AsyncClient(timeout=PROVIDER_TIMEOUT, follow_redirects=True) as http_client:
        _client_lifecycle.provider = AsyncElevenLabs(
            api_key=config.api_key,
            httpx_client=http_client,
        )
        try:
            yield
        finally:
            _client_lifecycle.provider = None


def get_client() -> AsyncElevenLabs:
    """Return the application-owned ElevenLabs client dependency."""
    provider = _client_lifecycle.provider
    if provider is None:
        raise ClientUnavailableError
    return provider


app = FastAPI(lifespan=lifespan)


async def _initial_chunk(chunks: AsyncIterator[bytes], deadline_seconds: float) -> bytes:
    with anyio.fail_after(deadline_seconds):
        async for chunk in chunks:
            if chunk:
                return chunk
    raise HTTPException(status.HTTP_502_BAD_GATEWAY, SPEECH_FAILURE_DETAIL)


@app.post("/v1/speech", response_class=StreamingResponse)
async def speech(
    payload: SpeechRequest,
    client: Annotated[AsyncElevenLabs, Depends(get_client)],
) -> StreamingResponse:
    """Preflight and stream expressive MP3 speech."""
    config = settings()
    stack = AsyncExitStack()
    try:
        response = await stack.enter_async_context(
            client.text_to_speech.with_raw_response.stream(
                config.voice_id,
                text=f"[{payload.tone.strip()}] {payload.text}",
                model_id=MODEL_ID,
                output_format=OUTPUT_FORMAT,
                request_options={"max_retries": 0},
            )
        )
        chunks = response.data.__aiter__()
        first_chunk = await _initial_chunk(chunks, config.initial_chunk_timeout)
    except TimeoutError as error:
        await stack.aclose()
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, INITIAL_TIMEOUT_DETAIL) from error
    except HTTPException:
        await stack.aclose()
        raise
    except PROVIDER_FAILURE as error:
        await stack.aclose()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, SPEECH_FAILURE_DETAIL) from error
    except anyio.get_cancelled_exc_class():
        with anyio.CancelScope(shield=True):
            await stack.aclose()
        raise

    request_id = response.headers.get("request-id")

    async def audio() -> AsyncIterator[bytes]:
        try:
            yield first_chunk
            async for chunk in chunks:
                if chunk:
                    yield chunk
        except PROVIDER_FAILURE:
            logger.warning(
                "elevenlabs_stream_failed",
                extra={"request_id": request_id or "unavailable"},
            )
            raise SpeechStreamError from None
        finally:
            with anyio.CancelScope(shield=True):
                await stack.aclose()

    return StreamingResponse(
        audio(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-AI-Generated-Voice": "true"},
    )
