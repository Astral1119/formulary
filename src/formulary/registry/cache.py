from pathlib import Path
import shutil
from typing import Optional

class LocalCache:
    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def get_artifact_path(self, package_name: str, version: str) -> Path:
        package_dir = self.cache_dir / package_name
        package_dir.mkdir(exist_ok=True)
        return package_dir / f"{version}.gspkg"

    def has_artifact(self, package_name: str, version: str) -> bool:
        return self.get_artifact_path(package_name, version).exists()
    
    def clear(self):
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
            self.cache_dir.mkdir()
