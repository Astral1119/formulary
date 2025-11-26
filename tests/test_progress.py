"""test suite for progress manager."""
import pytest
from pathlib import Path
import sys
from io import StringIO
from unittest.mock import Mock, patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.ui.progress import ProgressManager, _DummyProgress


class TestProgressManager:
    """test progress manager functionality."""
    
    def test_initialization_default(self):
        """test progress manager initializes with default console."""
        pm = ProgressManager()
        assert pm.console is not None
    
    def test_initialization_custom_console(self):
        """test progress manager accepts custom console."""
        from rich.console import Console
        custom_console = Console()
        pm = ProgressManager(console=custom_console)
        assert pm.console is custom_console
    
    def test_tty_detection_interactive(self):
        """test progress is enabled in interactive terminal."""
        with patch('sys.stdout.isatty', return_value=True):
            pm = ProgressManager()
            assert pm._enabled is True
    
    def test_tty_detection_non_interactive(self):
        """test progress is disabled in non-interactive environment."""
        with patch('sys.stdout.isatty', return_value=False):
            pm = ProgressManager()
            assert pm._enabled is False
    
    def test_print_method(self):
        """test print method delegates to console."""
        from rich.console import Console
        mock_console = Mock(spec=Console)
        pm = ProgressManager(console=mock_console)
        
        pm.print("test message", style="bold")
        mock_console.print.assert_called_once_with("test message", style="bold")
    
    def test_spinner_context_interactive(self):
        """test spinner context in interactive mode."""
        with patch('sys.stdout.isatty', return_value=True):
            pm = ProgressManager()
            
            with pm.spinner("test operation") as task_id:
                # task_id should be a valid TaskID
                assert task_id is not None
    
    def test_spinner_context_non_interactive(self):
        """test spinner context in non-interactive mode prints message."""
        with patch('sys.stdout.isatty', return_value=False):
            from rich.console import Console
            mock_console = Mock(spec=Console)
            pm = ProgressManager(console=mock_console)
            
            with pm.spinner("test operation") as task_id:
                # should yield None in non-interactive mode
                assert task_id is None
            
            # should print the message
            mock_console.print.assert_called_once_with("test operation...")
    
    def test_download_progress_context_interactive(self):
        """test download progress context in interactive mode."""
        with patch('sys.stdout.isatty', return_value=True):
            pm = ProgressManager()
            
            with pm.download_progress() as progress:
                # should yield a Progress instance
                assert progress is not None
                # verify we can add tasks
                task_id = progress.add_task("downloading", total=100)
                assert task_id is not None
    
    def test_download_progress_context_non_interactive(self):
        """test download progress context in non-interactive mode."""
        with patch('sys.stdout.isatty', return_value=False):
            pm = ProgressManager()
            
            with pm.download_progress() as progress:
                # should yield a _DummyProgress instance
                assert isinstance(progress, _DummyProgress)
    
    def test_task_progress_context_interactive(self):
        """test task progress context in interactive mode."""
        with patch('sys.stdout.isatty', return_value=True):
            pm = ProgressManager()
            
            with pm.task_progress("installing functions", total=10) as (progress, task_id):
                # should yield Progress instance and task_id
                assert progress is not None
                assert task_id is not None
                
                # verify we can advance
                progress.advance(task_id, 1)
    
    def test_task_progress_context_non_interactive(self):
        """test task progress context in non-interactive mode."""
        with patch('sys.stdout.isatty', return_value=False):
            from rich.console import Console
            mock_console = Mock(spec=Console)
            pm = ProgressManager(console=mock_console)
            
            with pm.task_progress("installing functions", total=10) as (progress, task_id):
                # should yield _DummyProgress and None
                assert isinstance(progress, _DummyProgress)
                assert task_id is None
            
            # should print the message
            mock_console.print.assert_called_once_with("installing functions...")
    
    def test_progress_context_custom_columns(self):
        """test progress context with custom columns."""
        with patch('sys.stdout.isatty', return_value=True):
            from rich.progress import TextColumn, BarColumn
            
            pm = ProgressManager()
            
            with pm.progress_context(TextColumn("test"), BarColumn()) as progress:
                assert progress is not None
                task_id = progress.add_task("custom task", total=100)
                assert task_id is not None


class TestDummyProgress:
    """test dummy progress fallback."""
    
    def test_add_task(self):
        """test adding a task returns a task id."""
        dp = _DummyProgress()
        task_id = dp.add_task("test", total=10)
        assert task_id is not None
    
    def test_update(self):
        """test update method is a no-op."""
        dp = _DummyProgress()
        task_id = dp.add_task("test", total=10)
        # should not raise
        dp.update(task_id, completed=5)
    
    def test_advance(self):
        """test advance method is a no-op."""
        dp = _DummyProgress()
        task_id = dp.add_task("test", total=10)
        # should not raise
        dp.advance(task_id, 1)
    
    def test_remove_task(self):
        """test remove_task method is a no-op."""
        dp = _DummyProgress()
        task_id = dp.add_task("test", total=10)
        # should not raise
        dp.remove_task(task_id)


class TestProgressIntegration:
    """integration tests for progress tracking."""
    
    def test_nested_progress_contexts(self):
        """test that progress contexts can be nested."""
        with patch('sys.stdout.isatty', return_value=True):
            pm = ProgressManager()
            
            # outer progress
            with pm.task_progress("overall", total=5) as (progress1, task1):
                assert progress1 is not None
                
                # inner spinner
                with pm.spinner("processing"):
                    pass
                
                progress1.advance(task1, 1)
    
    def test_progress_with_exceptions(self):
        """test progress contexts handle exceptions gracefully."""
        with patch('sys.stdout.isatty', return_value=True):
            pm = ProgressManager()
            
            with pytest.raises(ValueError):
                with pm.task_progress("failing task", total=10) as (progress, task_id):
                    progress.advance(task_id, 1)
                    raise ValueError("test error")
            
            # context should clean up properly


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
