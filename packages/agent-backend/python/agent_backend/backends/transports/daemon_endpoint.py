"""URL scheme and header rules shared by both daemon channels (MCP over HTTP and SSH-over-WebSocket)."""

from __future__ import annotations

from typing import Literal

_RESERVED_HEADERS = frozenset({"authorization", "x-root-dir", "x-scope-path"})
"""Headers the library sets itself; caller-supplied headers can never override these."""


def daemon_scheme(channel: Literal["http", "ws"], port: int, secure: bool | None) -> str:
    """Pick the URL scheme for a daemon channel.

    An explicit ``secure`` wins; otherwise port 443 implies TLS.
    """
    tls = port == 443 if secure is None else secure
    return f"{channel}s" if tls else channel


def merge_daemon_headers(extra: dict[str, str] | None, own: dict[str, str]) -> dict[str, str]:
    """Merge caller-supplied headers under the library's own headers.

    Entries that collide (case-insensitively) with a reserved header or with any of
    ``own`` are dropped.
    """
    own_keys = {k.lower() for k in own}
    merged = {
        key: value
        for key, value in (extra or {}).items()
        if key.lower() not in _RESERVED_HEADERS and key.lower() not in own_keys
    }
    merged.update(own)
    return merged
