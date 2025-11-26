"""test suite for phase 2 progress integration."""
import pytest
from unittest.mock import Mock, AsyncMock, patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.services.remove import RemoveService
from formulary.services.upgrade import UpgradeService
from formulary.ui.progress import ProgressManager
from formulary.domain.models import Lockfile, PackageLock

class TestRemoveServiceProgress:
    """test progress integration in RemoveService."""
    
    def test_remove_progress(self):
        """test that remove operation triggers progress indicators."""
        import asyncio
        
        # mocks
        sheet_client = Mock()
        sheet_client.connect = AsyncMock()
        sheet_client.close = AsyncMock()
        sheet_client.delete_function = AsyncMock()
        
        progress_manager = Mock(spec=ProgressManager)
        progress_manager.spinner.return_value.__enter__ = Mock()
        progress_manager.spinner.return_value.__exit__ = Mock()
        progress_manager.task_progress.return_value.__enter__ = Mock(return_value=(Mock(), Mock()))
        progress_manager.task_progress.return_value.__exit__ = Mock()
        
        service = RemoveService(sheet_client, progress_manager)
        
        # mock metadata
        service.metadata_manager.get_all_metadata = AsyncMock(return_value=(
            {"dependencies": ["pkg1"]}, 
            Lockfile(packages={"pkg1": PackageLock(version="1.0.0", integrity="hash", functions=["f1"])})
        ))
        service.metadata_manager.set_project_metadata = AsyncMock()
        service.metadata_manager.set_lockfile = AsyncMock()
        
        # execute
        asyncio.run(service.remove(["pkg1"]))
        
        # verify progress calls
        progress_manager.spinner.assert_called_with("analyzing dependencies")
        progress_manager.task_progress.assert_called_with("removing functions", total=1)


class TestUpgradeServiceProgress:
    """test progress integration in UpgradeService."""
    
    def test_upgrade_progress(self):
        """test that upgrade operation triggers progress indicators."""
        import asyncio
        
        # mocks
        sheet_client = Mock()
        sheet_client.connect = AsyncMock()
        sheet_client.close = AsyncMock()
        sheet_client.get_named_functions = AsyncMock(return_value={})
        sheet_client.create_function = AsyncMock()
        
        registry_client = Mock()
        registry_client.download_package = Mock()
        
        cache = Mock()
        cache.has_artifact.return_value = False
        cache.get_artifact_path.return_value = Path("/tmp/pkg.gspkg")
        
        resolver = Mock()
        # mock resolved package
        pkg = Mock()
        pkg.name = "pkg1"
        pkg.version = "2.0.0"
        resolver.resolve.return_value = [pkg]
        
        packager = Mock()
        packager.extract_package.return_value = ({}, {}, {"f1": Mock()}, "hash")
        
        progress_manager = Mock(spec=ProgressManager)
        progress_manager.spinner.return_value.__enter__ = Mock()
        progress_manager.spinner.return_value.__exit__ = Mock()
        progress_manager.download_progress.return_value.__enter__ = Mock(return_value=Mock())
        progress_manager.download_progress.return_value.__exit__ = Mock()
        progress_manager.task_progress.return_value.__enter__ = Mock(return_value=(Mock(), Mock()))
        progress_manager.task_progress.return_value.__exit__ = Mock()
        
        service = UpgradeService(
            sheet_client, registry_client, cache, resolver, packager, progress_manager
        )
        
        # mock metadata
        service.metadata_manager.get_all_metadata = AsyncMock(return_value=(
            {"dependencies": ["pkg1"]}, 
            Lockfile(packages={"pkg1": PackageLock(version="1.0.0", integrity="hash", functions=["f1"])})
        ))
        service.metadata_manager.set_lockfile = AsyncMock()
        
        # execute
        asyncio.run(service.upgrade(["pkg1"]))
        
        # verify progress calls
        progress_manager.spinner.assert_called_with("checking for updates")
        progress_manager.download_progress.assert_called()
        progress_manager.task_progress.assert_called_with("updating functions", total=1)
