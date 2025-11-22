from abc import ABC, abstractmethod
from typing import List, Optional
from pathlib import Path

class RegistryClient(ABC):
    @abstractmethod
    def get_versions(self, package_name: str) -> List[str]:
        """Get available versions for a package."""
        pass

    @abstractmethod
    def get_package_metadata(self, package_name: str, version: str) -> dict:
        """Get metadata for a specific package version."""
        pass

    @abstractmethod
    def download_package(self, package_name: str, version: str, target_path: Path) -> Path:
        """Download the package artifact to the target path."""
        pass
