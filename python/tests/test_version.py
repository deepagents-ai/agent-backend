"""Test basic package functionality."""

import agent_backend


def test_version() -> None:
    """Test that version is defined."""
    assert agent_backend.__version__ == "0.1.0"


def test_package_imports() -> None:
    """Test that package can be imported."""
    assert agent_backend is not None
