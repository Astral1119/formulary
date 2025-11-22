"""test suite for registry cache."""
import pytest
from pathlib import Path
import tempfile
import shutil
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.registry.cache import LocalCache


class TestLocalCache:
    @pytest.fixture
    def temp_cache_dir(self):
        """create a temporary cache directory."""
        temp_dir = Path(tempfile.mkdtemp())
        yield temp_dir
        # cleanup
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def cache(self, temp_cache_dir):
        """create a LocalCache instance."""
        return LocalCache(temp_cache_dir)
    
    def test_cache_creation(self, temp_cache_dir):
        cache = LocalCache(temp_cache_dir)
        assert cache.cache_dir == temp_cache_dir
        assert temp_cache_dir.exists()
    
    def test_get_artifact_path(self, cache):
        path = cache.get_artifact_path("test-pkg", "1.0.0")
        assert "test-pkg" in str(path)
        assert "1.0.0" in str(path)
        assert path.suffix == ".gspkg"
    
    def test_has_artifact_not_present(self, cache):
        assert not cache.has_artifact("nonexistent", "1.0.0")
    
    def test_has_artifact_present(self, cache, temp_cache_dir):
        # create a fake artifact
        artifact_path = cache.get_artifact_path("test-pkg", "1.0.0")
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text("fake artifact")
        
        assert cache.has_artifact("test-pkg", "1.0.0")
    
    def test_clear_cache(self, cache, temp_cache_dir):
        # create some artifacts
        for i in range(3):
            artifact_path = cache.get_artifact_path(f"pkg{i}", "1.0.0")
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            artifact_path.write_text(f"artifact {i}")
        
        cache.clear()
        
        # cache dir should be recreated but empty
        assert temp_cache_dir.exists()
        assert list(temp_cache_dir.iterdir()) == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
