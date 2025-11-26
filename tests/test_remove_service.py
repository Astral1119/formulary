"""test suite for RemoveService."""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.services.remove import RemoveService
from formulary.domain.models import Lockfile, PackageLock


class TestRemoveService:
    @pytest.fixture
    def mock_sheet_client(self):
        """create mock sheet client."""
        client = AsyncMock()
        client.connect = AsyncMock()
        client.close = AsyncMock()
        client.delete_function = AsyncMock()
        return client
    
    @pytest.fixture
    def mock_metadata_manager(self, mock_sheet_client):
        """create mock metadata manager."""
        with patch('formulary.services.remove.MetadataManager') as MockManager:
            manager = MockManager.return_value
            manager.get_project_metadata = AsyncMock(return_value={
                "name": "test-project",
                "version": "1.0.0",
                "dependencies": ["hash", "pkg-a>=1.0.0"]
            })
            
            lockfile = Lockfile()
            lockfile.packages["hash"] = PackageLock(
                version="0.1.0",
                functions=["HASH_MD5"]
            )
            lockfile.packages["pkg-a"] = PackageLock(
                version="1.0.0",
                functions=["PKG_A_FUNC"]
            )
            manager.get_lockfile = AsyncMock(return_value=lockfile)
            manager.get_all_metadata = AsyncMock(return_value=(
                {
                    "name": "test-project",
                    "version": "1.0.0",
                    "dependencies": ["hash", "pkg-a>=1.0.0"]
                },
                lockfile
            ))
            manager.set_project_metadata = AsyncMock()
            manager.set_lockfile = AsyncMock()
            
            yield manager
    
    @pytest.fixture
    def service(self, mock_sheet_client, mock_metadata_manager):
        """create RemoveService instance."""
        service = RemoveService(mock_sheet_client)
        service.metadata_manager = mock_metadata_manager
        return service
    
    def test_remove_single_package(self, service, mock_sheet_client, mock_metadata_manager):
        """test removing a single package."""
        asyncio.run(service.remove(["hash"]))
        
        # should connect and close
        mock_sheet_client.connect.assert_called_once()
        mock_sheet_client.close.assert_called_once()
        
        # should delete function
        mock_sheet_client.delete_function.assert_called()
        
        # should update metadata
        mock_metadata_manager.set_project_metadata.assert_called_once()
        updated_metadata = mock_metadata_manager.set_project_metadata.call_args[0][0]
        assert "hash" not in str(updated_metadata["dependencies"])
    
    def test_remove_nonexistent_package(self, service):
        """test removing a package that isn't installed."""
        with pytest.raises(ValueError, match="not installed"):
            asyncio.run(service.remove(["nonexistent"]))
    
    def test_remove_no_project(self, service, mock_metadata_manager):
        """test removing when no project is initialized."""
        mock_metadata_manager.get_project_metadata = AsyncMock(return_value=None)
        mock_metadata_manager.get_all_metadata = AsyncMock(return_value=(None, None))
        
        with pytest.raises(ValueError, match="No project initialized"):
            asyncio.run(service.remove(["hash"]))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
