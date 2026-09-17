"""Tests for MCP module."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from agent_backend.backends.remote import RemoteFilesystemBackend
from agent_backend.backends.transports.daemon_endpoint import (
    daemon_scheme,
    merge_daemon_headers,
)
from agent_backend.mcp_integration.client import build_remote_mcp_headers, create_http_transport
from agent_backend.mcp_integration.transport import (
    _StdioTransportWrapper,
    create_backend_mcp_transport,
)
from agent_backend.types import BackendError, BackendType, RemoteFilesystemBackendConfig


class TestMCPTransportCreation:
    async def test_unsupported_backend_type(self):
        class FakeBackend:
            type = "unsupported"

        with pytest.raises(BackendError):
            await create_backend_mcp_transport(FakeBackend())

    async def test_stdio_wrapper_close(self):
        wrapper = _StdioTransportWrapper(None)
        await wrapper.close()

    async def test_local_transport_creation(self):
        class FakeLocalBackend:
            type = BackendType.LOCAL_FILESYSTEM
            root_dir = "/workspace"
            _isolation = "software"
            _shell = "bash"

        transport = await create_backend_mcp_transport(FakeLocalBackend())
        assert hasattr(transport, "params")
        assert transport.params.command == "agent-backend"
        assert "--rootDir" in transport.params.args
        assert "/workspace" in transport.params.args
        assert "--local-only" in transport.params.args
        assert "--isolation" in transport.params.args
        assert "--shell" in transport.params.args

    async def test_local_transport_with_scope(self):
        class FakeLocalBackend:
            type = BackendType.LOCAL_FILESYSTEM
            root_dir = "/workspace"
            _isolation = None
            _shell = None

        transport = await create_backend_mcp_transport(FakeLocalBackend(), scope_path="sub")
        assert "/workspace/sub" in transport.params.args

    async def test_memory_transport_creation(self):
        class FakeMemoryBackend:
            type = BackendType.MEMORY
            root_dir = "/"

        transport = await create_backend_mcp_transport(FakeMemoryBackend())
        assert hasattr(transport, "params")
        assert "--backend" in transport.params.args
        assert "memory" in transport.params.args

    async def test_memory_transport_with_scope(self):
        class FakeMemoryBackend:
            type = BackendType.MEMORY
            root_dir = "/"

        transport = await create_backend_mcp_transport(FakeMemoryBackend(), scope_path="data")
        assert "//data" in transport.params.args

    async def test_remote_transport_creation(self):
        class FakeRemoteConfig:
            mcp_server_host_override = None
            host = "example.com"
            mcp_port = 3001
            auth_token = "tok"
            port = None
            secure = None
            headers = None

        class FakeRemoteBackend:
            type = BackendType.REMOTE_FILESYSTEM
            root_dir = "/remote"
            config = FakeRemoteConfig()

        transport = await create_backend_mcp_transport(FakeRemoteBackend())
        assert hasattr(transport, "url")
        assert transport.url == "http://example.com:3001"
        assert transport.auth_token == "tok"
        assert transport.root_dir == "/remote"

    async def test_remote_transport_with_mcp_host_override(self):
        class FakeRemoteConfig:
            mcp_server_host_override = "override.host"
            host = "original.host"
            mcp_port = 4000
            auth_token = "tok"
            port = None
            secure = None
            headers = None

        class FakeRemoteBackend:
            type = BackendType.REMOTE_FILESYSTEM
            root_dir = "/remote"
            config = FakeRemoteConfig()

        transport = await create_backend_mcp_transport(FakeRemoteBackend())
        assert transport.url == "http://override.host:4000"


class TestStdioTransportWrapper:
    def test_wrapper_params(self):
        wrapper = _StdioTransportWrapper("test-params")
        assert wrapper.params == "test-params"
        assert wrapper._process is None

    async def test_wrapper_close_with_process(self):
        class FakeProcess:
            def terminate(self):
                self.terminated = True

        wrapper = _StdioTransportWrapper(None)
        wrapper._process = FakeProcess()
        await wrapper.close()
        assert wrapper._process.terminated

    async def test_wrapper_close_with_failing_process(self):
        class BadProcess:
            def terminate(self):
                raise RuntimeError("already dead")

        wrapper = _StdioTransportWrapper(None)
        wrapper._process = BadProcess()
        # Should not raise
        await wrapper.close()


class TestHttpTransport:
    def test_create_http_transport(self):
        transport = create_http_transport(
            url="http://example.com",
            auth_token="token123",
            root_dir="/root",
            scope_path="scope/path",
        )
        assert transport.url == "http://example.com"
        assert transport.auth_token == "token123"
        assert transport.root_dir == "/root"
        assert transport.scope_path == "scope/path"

    def test_create_http_transport_no_scope(self):
        transport = create_http_transport(
            url="http://example.com",
            auth_token="tok",
            root_dir="/root",
        )
        assert transport.scope_path is None

    async def test_http_transport_close(self):
        transport = create_http_transport(
            url="http://example.com",
            auth_token="tok",
            root_dir="/root",
        )
        # Should be a no-op but not raise
        await transport.close()


def _remote(
    secure: bool | None = None,
    mcp_port: int = 3001,
    headers: dict[str, str] | None = None,
) -> RemoteFilesystemBackend:
    return RemoteFilesystemBackend(
        RemoteFilesystemBackendConfig(
            root_dir="/var/workspace",
            host="d.example.com",
            auth_token="tok",
            secure=secure,
            mcp_port=mcp_port,
            headers=headers,
        )
    )


class TestDaemonTLSAndHeaders:
    @pytest.mark.parametrize(
        ("secure", "port", "http", "ws"),
        [
            (True, 3001, "https", "wss"),
            (True, 443, "https", "wss"),
            (False, 3001, "http", "ws"),
            (False, 443, "http", "ws"),
            (None, 3001, "http", "ws"),
            (None, 443, "https", "wss"),
        ],
    )
    def test_scheme_table(self, secure, port, http, ws):
        assert daemon_scheme("http", port, secure) == http
        assert daemon_scheme("ws", port, secure) == ws

    @pytest.mark.parametrize(("secure", "port", "url"), [
        (True, 3001, "https://d.example.com:3001"),
        (None, 443, "https://d.example.com:443"),
        (None, 3001, "http://d.example.com:3001"),
    ])
    async def test_remote_transport_url(self, secure, port, url):
        transport = await create_backend_mcp_transport(_remote(secure=secure, mcp_port=port))
        assert transport.url == url

    async def test_port_drives_both_channels(self):
        backend = RemoteFilesystemBackend(
            RemoteFilesystemBackendConfig(root_dir="/w", host="d.example.com", port=443)
        )
        transport = await create_backend_mcp_transport(backend)
        assert transport.url == "https://d.example.com:443"

    def test_reserved_headers_not_overridable(self):
        headers = build_remote_mcp_headers(
            "tok",
            "/var/workspace",
            None,
            {"authorization": "Bearer evil", "X-ROOT-DIR": "/", "x-scope-path": "..", "x-route": "a"},
        )
        assert headers == {
            "x-route": "a",
            "X-Root-Dir": "/var/workspace",
            "Authorization": "Bearer tok",
        }

    def test_merge_drops_collisions_with_own(self):
        assert merge_daemon_headers({"Foo": "x", "bar": "y"}, {"foo": "z"}) == {"bar": "y", "foo": "z"}

    async def test_scoped_get_mcp_client_sends_scope_and_headers(self):
        backend = _remote(mcp_port=443, headers={"x-route": "a"})
        scoped: Any = backend.scope("a/b")
        with patch(
            "agent_backend.mcp_integration.client.create_remote_mcp_client",
            new=AsyncMock(return_value=AsyncMock()),
        ) as create:
            await scoped.get_mcp_client()
        assert create.await_args is not None
        kwargs = create.await_args.kwargs
        assert kwargs["url"] == "https://d.example.com:443"
        assert kwargs["root_dir"] == "/var/workspace"
        assert kwargs["scope_path"] == "a/b"
        assert kwargs["headers"] == {"x-route": "a"}
        assert build_remote_mcp_headers(
            kwargs["auth_token"], kwargs["root_dir"], kwargs["scope_path"], kwargs["headers"]
        ) == {
            "x-route": "a",
            "X-Root-Dir": "/var/workspace",
            "Authorization": "Bearer tok",
            "X-Scope-Path": "a/b",
        }

    @pytest.mark.parametrize(("secure", "port", "url"), [
        (True, 3001, "wss://d.example.com:3001/ssh"),
        (None, 443, "wss://d.example.com:443/ssh"),
        (None, 3001, "ws://d.example.com:3001/ssh"),
    ])
    async def test_ws_upgrade_url_and_headers(self, secure, port, url):
        from agent_backend.backends.transports.websocket_ssh import WebSocketSSHTransport

        transport = WebSocketSSHTransport(
            "d.example.com",
            port,
            auth_token="tok",
            secure=secure,
            headers={"x-route": "a", "Authorization": "Bearer evil"},
        )
        with patch(
            "agent_backend.backends.transports.websocket_ssh.websockets.connect",
            new=AsyncMock(side_effect=RuntimeError("stop")),
        ) as connect, pytest.raises(RuntimeError, match="stop"):
            await transport.connect()
        assert connect.await_args is not None
        (called_url,) = connect.await_args.args
        assert called_url == url
        assert "tok" not in called_url
        assert connect.await_args.kwargs["additional_headers"] == {
            "x-route": "a",
            "Authorization": "Bearer tok",
        }
