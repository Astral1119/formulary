"""test suite for PublishService."""
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import sys
from pathlib import Path
import tempfile
import zipfile
import json

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.services.publish import PublishService
from formulary.domain.models import Lockfile, Function


class TestPublishService:
    @pytest.fixture
    def mock_sheet_client(self):
        """create mock sheet client."""
        client = AsyncMock()
        client.connect = AsyncMock()
        client.close = AsyncMock()
        client.get_named_functions = AsyncMock(return_value={
            "TEST_FUNC": Function(
                name="TEST_FUNC",
                definition="=A1+B1",
                description="Test function"
            ),
            "__GSPROJECT__": Function(name="__GSPROJECT__", definition="{}"),
            "__LOCK__": Function(name="__LOCK__", definition="{}")
        })
        return client
    
    @pytest.fixture
    def mock_metadata_manager(self):
        """create mock metadata manager."""
        with patch('formulary.services.publish.MetadataManager') as MockManager:
            manager = MockManager.return_value
            manager.get_project_metadata = AsyncMock(return_value={
                "name": "test-package",
                "version": "1.0.0",
                "description": "Test package"
            })
            manager.get_lockfile = AsyncMock(return_value=Lockfile())
            manager.get_all_metadata = AsyncMock(return_value=(
                {
                    "name": "test-package",
                    "version": "1.0.0",
                    "description": "Test package"
                },
                Lockfile()
            ))
            yield manager
    
    @pytest.fixture
    def packager(self):
        """create real Packager instance."""
        from formulary.bundling.packager import Packager
        return Packager()
    
    @pytest.fixture
    def service(self, mock_sheet_client, packager, mock_metadata_manager):
        """create PublishService instance."""
        service = PublishService(mock_sheet_client, packager)
        service.metadata_manager = mock_metadata_manager
        return service
    
    def test_publish_success(self, service, mock_sheet_client):
        """test successful package publishing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            package_path = asyncio.run(service.pack(output_dir))
            
            # should create package file
            assert package_path.exists()
            assert package_path.name == "test-package-1.0.0.gspkg"
            
            # verify package content
            with zipfile.ZipFile(package_path, 'r') as zf:
                assert '__GSPROJECT__.json' in zf.namelist()
                assert 'functions.json' in zf.namelist()
                
                # check functions
                functions_data = json.loads(zf.read('functions.json'))
                assert 'TEST_FUNC' in functions_data
                assert '__GSPROJECT__' not in functions_data # should be excluded
    
    def test_publish_no_metadata(self, service, mock_metadata_manager):
        """test publishing when no metadata exists."""
        mock_metadata_manager.get_project_metadata = AsyncMock(return_value=None)
        mock_metadata_manager.get_all_metadata = AsyncMock(return_value=(None, None))
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(ValueError, match="No project metadata"):
                asyncio.run(service.pack(Path(tmpdir)))
    
    def test_publish_missing_name(self, service, mock_metadata_manager):
        """test publishing when name is missing."""
        metadata = {"version": "1.0.0"}
        mock_metadata_manager.get_project_metadata = AsyncMock(return_value=metadata)
        mock_metadata_manager.get_all_metadata = AsyncMock(return_value=(metadata, Lockfile()))
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(ValueError, match="must include 'name'"):
                asyncio.run(service.pack(Path(tmpdir)))
    
    def test_publish_invalid_version(self, service, mock_metadata_manager):
        """test publishing with invalid version."""
        metadata = {
            "name": "test-package",
            "version": "invalid-version"
        }
        mock_metadata_manager.get_project_metadata = AsyncMock(return_value=metadata)
        mock_metadata_manager.get_all_metadata = AsyncMock(return_value=(metadata, Lockfile()))
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(ValueError, match="Invalid version"):
                asyncio.run(service.pack(Path(tmpdir)))
    
    def test_publish_no_functions(self, service, mock_sheet_client, mock_metadata_manager):
        """test publishing when no functions exist."""
        # only metadata functions
        mock_sheet_client.get_named_functions = AsyncMock(return_value={
            "__GSPROJECT__": Function(name="__GSPROJECT__", definition="{}"),
            "__LOCK__": Function(name="__LOCK__", definition="{}")
        })
        
        with tempfile.TemporaryDirectory() as tmpdir:
            with pytest.raises(ValueError, match="No functions to publish"):
                asyncio.run(service.pack(Path(tmpdir)))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
