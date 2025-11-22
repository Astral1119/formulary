import subprocess
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import httpx
from rich.console import Console

console = Console()

class SelfManagementService:
    """service for managing Formulary installation."""
    
    # expected installation directory
    INSTALL_DIR = Path.home() / ".formulary" / "repo"
    CACHE_FILE = Path.home() / ".formulary" / "update_check_cache.json"
    CACHE_DURATION = timedelta(hours=24)
    
    def __init__(self):
        """initialize the self-management service."""
        self._is_standard_install = self._check_standard_install()
    
    def _check_standard_install(self) -> bool:
        """check if Formulary is installed via the standard installation script."""
        return self.INSTALL_DIR.exists() and (self.INSTALL_DIR / ".git").exists()
    
    def _ensure_standard_install(self):
        """raise an error if not installed via standard method."""
        if not self._is_standard_install:
            raise RuntimeError(
                "This command is only available for standard installations.\n"
                "You appear to be running Formulary from source.\n"
                "To use self-management commands, install Formulary using:\n"
                "  curl -fsSL https://raw.githubusercontent.com/Astral1119/formulary/main/scripts/install.sh | bash"
            )
    
    def _get_local_commit(self) -> Optional[str]:
        """get the current local commit SHA."""
        if not self._is_standard_install:
            return None
        
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=self.INSTALL_DIR,
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError:
            return None
    
    def _get_remote_commit(self) -> Optional[str]:
        """get the latest commit SHA from GitHub."""
        try:
            response = httpx.get(
                "https://api.github.com/repos/Astral1119/formulary/commits/main",
                timeout=5.0
            )
            response.raise_for_status()
            data = response.json()
            return data.get("sha")
        except (httpx.HTTPError, httpx.TimeoutException, KeyError):
            return None
    
    def _load_cache(self) -> Optional[Dict[str, Any]]:
        """load cached update check results."""
        if not self.CACHE_FILE.exists():
            return None
        
        try:
            with open(self.CACHE_FILE, "r") as f:
                cache = json.load(f)
            
            # check if cache is still valid
            cached_time = datetime.fromisoformat(cache.get("timestamp", ""))
            if datetime.now() - cached_time < self.CACHE_DURATION:
                return cache
        except (json.JSONDecodeError, ValueError, KeyError):
            pass
        
        return None
    
    def _save_cache(self, data: Dict[str, Any]):
        """save update check results to cache."""
        cache_data = {
            **data,
            "timestamp": datetime.now().isoformat()
        }
        
        # ensure cache directory exists
        self.CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        
        with open(self.CACHE_FILE, "w") as f:
            json.dump(cache_data, f, indent=2)
    
    def check_for_updates(self, use_cache: bool = True) -> Dict[str, Any]:
        """
        check if a newer version of Formulary is available.
        
        args:
            use_cache: if True, use cached results if available
        
        returns:
            dictionary with:
                - update_available (bool): whether an update is available
                - local_commit (str|None): current local commit SHA
                - remote_commit (str|None): latest remote commit SHA
                - cached (bool): whether results are from cache
        """
        # try to use cache first
        if use_cache:
            cached = self._load_cache()
            if cached:
                return {**cached, "cached": True}
        
        # if not a standard install, return no update
        if not self._is_standard_install:
            return {
                "update_available": False,
                "local_commit": None,
                "remote_commit": None,
                "cached": False
            }
        
        local = self._get_local_commit()
        remote = self._get_remote_commit()
        
        result = {
            "update_available": bool(local and remote and local != remote),
            "local_commit": local,
            "remote_commit": remote,
            "cached": False
        }
        
        # save to cache
        self._save_cache(result)
        
        return result
    
    def self_update(self):
        """
        run the update script to update Formulary.
        
        Raises:
            RuntimeError: if not installed via standard method
            subprocess.CalledProcessError: if update script fails
        """
        self._ensure_standard_install()
        
        update_script = self.INSTALL_DIR / "scripts" / "update.sh"
        
        if not update_script.exists():
            raise FileNotFoundError(
                f"Update script not found at {update_script}\n"
                "Your installation may be corrupted."
            )
        
        console.print("[blue]Running update script...[/blue]")
        
        # run the update script
        subprocess.run(
            ["bash", str(update_script)],
            check=True
        )
        
        # clear the update check cache after successful update
        if self.CACHE_FILE.exists():
            self.CACHE_FILE.unlink()
    
    def self_uninstall(self):
        """
        run the uninstall script to remove Formulary.
        
        Raises:
            RuntimeError: if not installed via standard method
            subprocess.CalledProcessError: if uninstall script fails
        """
        self._ensure_standard_install()
        
        uninstall_script = self.INSTALL_DIR / "scripts" / "uninstall.sh"
        
        if not uninstall_script.exists():
            raise FileNotFoundError(
                f"Uninstall script not found at {uninstall_script}\n"
                "Your installation may be corrupted."
            )
        
        console.print("[yellow]Running uninstall script...[/yellow]")
        
        # run the uninstall script with --yes flag since user already confirmed in CLI
        subprocess.run(
            ["bash", str(uninstall_script), "--yes"],
            check=True
        )
