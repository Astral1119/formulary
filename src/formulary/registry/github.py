import httpx
from typing import List, Optional, TYPE_CHECKING
from pathlib import Path
from .client import RegistryClient

if TYPE_CHECKING:
    from rich.progress import TaskID

class GitHubRegistry(RegistryClient):
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client()

    def get_versions(self, package_name: str) -> List[str]:
        index = self._get_index()
        if package_name not in index:
            return []
        
        # the index structure is {pkg: {versions: {v: ...}, latest: ...}}
        pkg_data = index[package_name]
        if "versions" in pkg_data:
            return list(pkg_data["versions"].keys())
        return []

    def get_package_metadata(self, package_name: str, version: str) -> dict:
        index = self._get_index()
        if package_name not in index:
            raise ValueError(f"Package {package_name} not found")
            
        pkg_data = index[package_name]
        versions = pkg_data.get("versions", {})
        if version not in versions:
            raise ValueError(f"Version {version} not found for package {package_name}")
            
        return versions[version]

    def download_package(
        self, 
        package_name: str, 
        version: str, 
        target_path: Path,
        progress = None,
        task_id: Optional["TaskID"] = None
    ) -> Path:
        """
        download a package from the registry.
        
        args:
            package_name: name of the package
            version: version to download
            target_path: where to save the package
            progress: optional Progress instance for tracking download
            task_id: optional task id for updating progress
            
        returns:
            path to downloaded package
        """
        metadata = self.get_package_metadata(package_name, version)
        
        # metadata contains 'path' relative to registry root
        relative_path = metadata.get("path")
        
        # helper to download with progress tracking
        def download_with_progress(url: str) -> None:
            with self.client.stream("GET", url) as response:
                response.raise_for_status()
                
                # get total size if available
                total_size = None
                if "content-length" in response.headers:
                    total_size = int(response.headers["content-length"])
                    if progress and task_id is not None:
                        progress.update(task_id, total=total_size)
                
                # download and track progress
                downloaded = 0
                with open(target_path, "wb") as f:
                    for chunk in response.iter_bytes():
                        f.write(chunk)
                        downloaded += len(chunk)
                        if progress and task_id is not None:
                            progress.update(task_id, completed=downloaded)
        
        # try primary path from metadata
        if relative_path:
            download_url = f"{self.base_url}/{relative_path}"
            try:
                download_with_progress(download_url)
                return target_path
            except httpx.HTTPStatusError as e:
                if e.response.status_code != 404:
                    raise
                # if 404, fall through to legacy path
        
        # fallback to legacy path: packages/{name}/{version}/{name}@{version}.gspkg
        legacy_url = f"{self.base_url}/packages/{package_name}/{version}/{package_name}@{version}.gspkg"
        download_with_progress(legacy_url)
        
        return target_path

    def _get_index(self) -> dict:
        if hasattr(self, "_index_cache"):
            return self._index_cache
            
        url = f"{self.base_url}/index.json"
        response = self.client.get(url)
        response.raise_for_status()
        data = response.json()
        
        self._index_cache = data
        return data
