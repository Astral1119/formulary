"""Test suite for utility functions."""
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.utils.hash import hash_function_object


class TestHashFunction:
    def test_hash_consistency(self):
        """Test that same object produces same hash."""
        obj = {"name": "test", "definition": "=A1+B1", "description": "test"}
        hash1 = hash_function_object(obj)
        hash2 = hash_function_object(obj)
        assert hash1 == hash2
    
    def test_hash_different_objects(self):
        """Test that different objects produce different hashes."""
        # Hash only includes description, definition, arguments - not name
        # So these will have the same hash since description/definition/arguments are same
        obj1 = {"name": "test1", "definition": "=A1+B1", "description": "test"}
        obj2 = {"name": "test2", "definition": "=A2+B2", "description": "test"}
        hash1 = hash_function_object(obj1)
        hash2 = hash_function_object(obj2)
        assert hash1 != hash2
    
    def test_hash_format(self):
        """Test that hash is a hex string."""
        obj = {"name": "test", "definition": "=A1+B1"}
        hash_val = hash_function_object(obj)
        assert isinstance(hash_val, str)
        # Truncated hash produces 12 hex characters
        assert len(hash_val) == 12
        # Should only contain hex characters
        assert all(c in "0123456789abcdef" for c in hash_val)
    
    def test_hash_with_nested_dict(self):
        """Test hashing with nested structures."""
        obj = {
            "name": "test",
            "definition": "=A1+B1",
            "arguments": {
                "arg1": {"description": "First arg"},
                "arg2": {"description": "Second arg"}
            }
        }
        hash_val = hash_function_object(obj)
        assert isinstance(hash_val, str)
        assert len(hash_val) == 12


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
