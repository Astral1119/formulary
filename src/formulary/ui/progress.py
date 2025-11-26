"""centralized progress management for formulary operations."""

import sys
from contextlib import contextmanager
from typing import Optional
from rich.console import Console
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    DownloadColumn,
    TransferSpeedColumn,
    TimeRemainingColumn,
    TaskProgressColumn,
    TaskID,
)


class ProgressManager:
    """central manager for all progress tracking operations."""
    
    def __init__(self, console: Optional[Console] = None):
        """
        initialize progress manager.
        
        args:
            console: optional rich console instance. if not provided, creates new one.
        """
        self.console = console or Console()
        self._enabled = self._should_show_progress()
    
    def _should_show_progress(self) -> bool:
        """
        check if we should show progress bars.
        
        returns false in non-interactive environments (ci/cd, piped output).
        """
        return sys.stdout.isatty() and not sys.stdout.closed
    
    def print(self, *args, **kwargs):
        """print through managed console to avoid interference with progress bars."""
        self.console.print(*args, **kwargs)
    
    @contextmanager
    def progress_context(self, *columns, **kwargs):
        """
        create a general progress context with custom columns.
        
        args:
            *columns: rich progress columns to display
            **kwargs: additional arguments for Progress constructor
            
        yields:
            Progress instance for tracking tasks
        """
        if not self._enabled:
            # in non-interactive mode, yield a dummy progress
            yield _DummyProgress()
            return
        
        progress = Progress(*columns, console=self.console, **kwargs)
        with progress:
            yield progress
    
    @contextmanager
    def spinner(self, description: str, transient: bool = True):
        """
        create an indeterminate spinner for unknown-duration tasks.
        
        args:
            description: text to display next to spinner
            transient: if true, spinner disappears when done
            
        yields:
            task id for the spinner (can be used to update description)
        """
        if not self._enabled:
            # in non-interactive mode, just print the message
            self.console.print(f"{description}...")
            yield None
            return
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=self.console,
            transient=transient,
        ) as progress:
            task_id = progress.add_task(description, total=None)
            yield task_id
    
    @contextmanager
    def download_progress(self):
        """
        create a download progress context with transfer speed tracking.
        
        yields:
            Progress instance configured for downloads
        """
        if not self._enabled:
            yield _DummyProgress()
            return
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            TimeRemainingColumn(),
            console=self.console,
        ) as progress:
            yield progress
    
    @contextmanager
    def task_progress(self, description: str, total: int):
        """
        create a simple task progress bar (e.g., function installation).
        
        args:
            description: description of the task
            total: total number of items to process
            
        yields:
            tuple of (Progress instance, task_id)
        """
        if not self._enabled:
            # in non-interactive mode, just print the message
            self.console.print(f"{description}...")
            yield _DummyProgress(), None
            return
        
        with Progress(
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=self.console,
        ) as progress:
            task_id = progress.add_task(description, total=total)
            yield progress, task_id


class _DummyProgress:
    """dummy progress object for non-interactive mode."""
    
    def add_task(self, description: str, total: Optional[int] = None, **kwargs) -> TaskID:
        """add a task (no-op)."""
        return TaskID(0)
    
    def update(self, task_id: TaskID, **kwargs):
        """update a task (no-op)."""
        pass
    
    def advance(self, task_id: TaskID, advance: float = 1):
        """advance a task (no-op)."""
        pass
    
    def remove_task(self, task_id: TaskID):
        """remove a task (no-op)."""
        pass
