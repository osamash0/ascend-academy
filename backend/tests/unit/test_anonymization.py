"""Unit tests for backend.domain.anonymization."""
import pytest

from backend.domain.anonymization import pseudonymize_user_id


class TestPseudonymize:
    def test_returns_string(self):
        assert isinstance(pseudonymize_user_id("abc-123"), str)

    def test_deterministic(self):
        assert pseudonymize_user_id("u1") == pseudonymize_user_id("u1")

    def test_different_users_different_names(self):
        # Pigeonhole: not strict but very high probability
        names = {pseudonymize_user_id(f"user-{i}") for i in range(50)}
        assert len(names) > 30  # mostly unique

    def test_format_theme_hex(self):
        name = pseudonymize_user_id("user-x")
        theme, hex_part = name.split("-")
        assert theme in {
            "Nexus", "Quantum", "Neural", "Prism",
            "Cortex", "Vector", "Logic", "Pulse",
        }
        assert len(hex_part) == 4
        # uppercase hex
        assert hex_part == hex_part.upper()
        int(hex_part, 16)  # parses as hex

    def test_handles_uuid_input(self):
        out = pseudonymize_user_id("9b8b4fc4-2d0e-48d7-a132-831b6b8d2c79")
        assert "-" in out
        assert len(out.split("-")[1]) == 4

    def test_no_pii_leak(self):
        # Anonymized name must not contain the original ID substring
        uid = "alice@example.test"
        out = pseudonymize_user_id(uid)
        assert "alice" not in out.lower()
        assert "@" not in out

    @pytest.mark.parametrize("uid", ["", "0", "1", "a"])
    def test_short_inputs_dont_crash(self, uid):
        out = pseudonymize_user_id(uid)
        assert len(out) > 4
