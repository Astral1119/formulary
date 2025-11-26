from typing import List, Optional, Dict
from pathlib import Path
from ..sheets.client import SheetClient
from ..sheets.metadata import MetadataManager
from ..registry.client import RegistryClient
from ..registry.cache import LocalCache
from ..resolution.resolver import Resolver
from ..bundling.packager import Packager
from ..domain.models import Dependency, Lockfile, Package, PackageLock
from ..utils.hash import hash_function_object
from ..ui.progress import ProgressManager


class UpgradeService:
    """handles package upgrades to newer versions."""
    
    def __init__(
        self,
        sheet_client: SheetClient,
        registry_client: RegistryClient,
        cache: LocalCache,
        resolver: Resolver,
        packager: Packager,
        progress_manager: ProgressManager = None
    ):
        self.sheet_client = sheet_client
        self.registry_client = registry_client
        self.cache = cache
        self.resolver = resolver
        self.packager = packager
        self.metadata_manager = MetadataManager(sheet_client)
        self.progress_manager = progress_manager or ProgressManager()
    
    async def upgrade(self, packages: Optional[List[str]] = None):
        """
        upgrade specified packages to their latest compatible versions.
        
        args:
            packages: list of packages to upgrade
            
        returns:
            dict of upgraded packages: {package_name: {"old": ver, "new": ver}}
        """
        upgrades = {}  # initialize at function start
        
        try:
            # 1. connect to sheet
            await self.sheet_client.connect()
            
            # 2. load current state
            project_metadata, old_lockfile = await self.metadata_manager.get_all_metadata()
            if not project_metadata:
                raise ValueError("No project initialized. Run 'init' first.")
            
            if not old_lockfile:
                old_lockfile = Lockfile()
            
            current_deps = project_metadata.get("dependencies", [])
            
            # 3. determine packages to upgrade
            if packages:
                # upgrade specific packages
                packages_to_upgrade = packages
            else:
                # upgrade all installed packages
                packages_to_upgrade = list(old_lockfile.packages.keys())
            
            # 4. validate packages are installed
            for pkg_name in packages_to_upgrade:
                if pkg_name not in old_lockfile.packages:
                    raise ValueError(f"Packages not installed: {pkg_name}")
            
            # 5. resolve dependencies
            deps = [Dependency(name=pkg) for pkg in packages_to_upgrade]
            with self.progress_manager.spinner("checking for updates"):
                resolved_packages = self.resolver.resolve(deps)
            
            # 6. find upgrades
            for pkg in resolved_packages:
                old_version = self._get_package_version(pkg.name, old_lockfile)
                if old_version and old_version != pkg.version:
                    upgrades[pkg.name] = {
                        "old": old_version,
                        "new": pkg.version
                    }
            
            if not upgrades:
                print("All packages are up to date.")
                return {}
            
            # 7. download and extract packages
            all_functions = {}
            new_lockfile = Lockfile()
            
            # identify packages needing download
            packages_to_download = [
                pkg for pkg in resolved_packages 
                if not self.cache.has_artifact(pkg.name, pkg.version)
            ]
            
            if packages_to_download:
                with self.progress_manager.download_progress() as progress:
                    for pkg in packages_to_download:
                        target_path = self.cache.get_artifact_path(pkg.name, pkg.version)
                        task_id = progress.add_task(f"downloading {pkg.name}@{pkg.version}", total=None)
                        self.registry_client.download_package(
                            pkg.name, 
                            pkg.version, 
                            target_path,
                            progress,
                            task_id
                        )

            for pkg in resolved_packages:
                # check cache (should be there now)
                if not self.cache.has_artifact(pkg.name, pkg.version):
                    # fallback if download failed or logic error
                    target_path = self.cache.get_artifact_path(pkg.name, pkg.version)
                    self.registry_client.download_package(pkg.name, pkg.version, target_path)
                
                artifact_path = self.cache.get_artifact_path(pkg.name, pkg.version)
                # extract functions
                _, _, funcs, integrity = self.packager.extract_package(artifact_path)
                
                # update package in lockfile
                new_lockfile.packages[pkg.name] = PackageLock(
                    version=pkg.version,
                    integrity=integrity,
                    functions=list(funcs.keys())
                )
                
                # collect all functions
                for fname, func in funcs.items():
                    all_functions[fname] = func
            
            # 8. update functions in sheet
            # get current functions to compare
            current_functions = await self.sheet_client.get_named_functions()
            
            total_functions = len(all_functions)
            with self.progress_manager.task_progress("updating functions", total=total_functions) as (progress, task_id):
                for fname, new_func in all_functions.items():
                    if fname in current_functions:
                        # update existing function
                        await self.sheet_client.delete_function(fname)
                    await self.sheet_client.create_function(fname, new_func.definition)
                    if progress and task_id is not None:
                        progress.advance(task_id, 1)
            
            # 9. save updated metadata and lockfile
            await self.metadata_manager.set_lockfile(new_lockfile)
            
            return upgrades
        except Exception as e:
            print(f"Upgrade failed: {e}")
            raise
        finally:
            await self.sheet_client.close()
    
    def _get_package_version(self, package_name: str, lockfile: Lockfile) -> Optional[str]:
        """get the version of a package from lockfile."""
        # look up package directly in the packages dict
        if package_name in lockfile.packages:
            return lockfile.packages[package_name].version
        return None
