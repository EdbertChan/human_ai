# Copyright (c) 2026 EdbertChan
"""Speech service configuration tests."""

from math import inf, nan

import pytest

from speech_service.main import ConfigurationError, settings

EXPECTED_TIMEOUT = 10.0


def expect(*, condition: bool) -> None:
    """Fail the active pytest case when its expectation is false."""
    if not condition:
        pytest.fail("expectation failed")


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
