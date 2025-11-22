"""Test suite for UpgradeService."""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import sys
from pathlib import Path
import tempfile

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.services.upgrade import UpgradeService
from formulary.domain.models import Lockfile, PackageLock, Package, Function


class TestUpgradeService:
    @pytest.fixture
    def mock_components(self):
        """Create all mock components."""
        sheet_client = AsyncMock()
        sheet_client.connect = AsyncMock()
        sheet_client.close = AsyncMock()
        sheet_client.get_named_functions = AsyncMock(return_value={})
        sheet_client.delete_function = AsyncMock()
        sheet_client.create_function = AsyncMock()
        
        registry = MagicMock()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            cache = MagicMock()
            cache.has_artifact = MagicMock(return_value=True)
            cache.get_artifact_path = MagicMock(return_value=Path(tmpdir) / "test.gspkg")
            
            resolver = MagicMock()
            resolver.resolve = MagicMock(return_value=[
                Package(name="hash", version="0.2.0")  # Upgraded from 0.1.0
            ])
            
            packager = MagicMock()
            
            yield {
                "sheet_client": sheet_client,
                "registry": registry,
                "cache": cache,
                "resolver": resolver,
                "packager": packager
            }
    
    @pytest.fixture
    def mock_metadata_manager(self):
        """Create mock metadata manager."""
        with patch('formulary.services.upgrade.MetadataManager') as MockManager:
            manager = MockManager.return_value
            manager.get_project_metadata = AsyncMock(return_value={
                "name": "test-project",
                "version": "1.0.0",
                "dependencies": ["hash"]
            })
            
            # Fix: Replaced lockfile.add_entry with direct package dictionary assignment
            # and ensured the lockfile content matches test expectations.
            old_lockfile = Lockfile()
            old_lockfile.packages["hash"] = PackageLock(version="0.1.0")
            manager.get_lockfile = AsyncMock(return_value=old_lockfile)
            manager.set_project_metadata = AsyncMock()
            manager.set_lockfile = AsyncMock()
            
            yield manager
    
    @pytest.fixture
    def service(self, mock_components, mock_metadata_manager):
        """Create UpgradeService instance."""
        service = UpgradeService(
            mock_components["sheet_client"],
            mock_components["registry"],
            mock_components["cache"],
            mock_components["resolver"],
            mock_components["packager"]
        )
        service.metadata_manager = mock_metadata_manager
        return service
    
    def test_upgrade_with_available_upgrade(self, service, mock_components):
        """Test upgrading when newer version is available."""
        # Setup packager to return functions
        func = Function(name="HASH_MD5", definition="=MD5(A1)", description="Test")
        mock_components["packager"].extract_package = MagicMock(return_value=(
            {},
            Lockfile(),
            {"HASH_MD5": func},
            "sha256:abc123"  # integrity
        ))
        
        upgrades = asyncio.run(service.upgrade(["hash"]))
        
        # Should find upgrade from 0.1.0 to 0.2.0
        assert "hash" in upgrades
        assert upgrades["hash"]["old"] == "0.1.0"
        assert upgrades["hash"]["new"] == "0.2.0"
    
    def test_upgrade_no_updates_available(self, service, mock_components):
        """Test upgrading when already at latest version."""
        # Resolver returns same version
        mock_components["resolver"].resolve = MagicMock(return_value=[
            Package(name="hash", version="0.1.0")  # Same as current
        ])
        
        upgrades = asyncio.run(service.upgrade(["hash"]))
        
        # Should return empty dict (no upgrades)
        assert upgrades == {}
    
    def test_upgrade_nonexistent_package(self, service):
        """Test upgrading a package that isn't installed."""
        with pytest.raises(ValueError, match="not installed"):
            asyncio.run(service.upgrade(["nonexistent"]))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
