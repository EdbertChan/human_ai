# Copyright (c) 2026 EdbertChan
"""FastAPI entrypoint for expressive ElevenLabs speech."""

import math
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Final

from elevenlabs.client import AsyncElevenLabs
from fastapi import FastAPI

DEFAULT_VOICE_ID: Final = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_INITIAL_CHUNK_TIMEOUT: Final = 10.0
MODEL_ID: Final = "eleven_v3"
OUTPUT_FORMAT: Final = "mp3_44100_128"
API_KEY_ENV: Final = "ELEVENLABS_API_KEY"
TIMEOUT_ENV: Final = "ELEVENLABS_INITIAL_CHUNK_TIMEOUT_SECONDS"


@dataclass(frozen=True, slots=True)
class ConfigurationError(Exception):
    """Report invalid service environment configuration."""

    setting_name: str

    def __str__(self) -> str:
        """Return a safe configuration error without exposing its value."""
        return f"Invalid or missing {self.setting_name}."


@dataclass(frozen=True, slots=True)
class Settings:
    """Hold validated process configuration."""

    api_key: str
    voice_id: str
    initial_chunk_timeout: float


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
    settings()
    yield


def get_client() -> AsyncElevenLabs:
    """Create the request-scoped ElevenLabs client dependency."""
    return AsyncElevenLabs(api_key=settings().api_key)


app = FastAPI(lifespan=lifespan)
