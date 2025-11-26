from pathlib import Path
from typing import Optional
import tempfile

from ..sheets.client import SheetClient
from ..sheets.metadata import MetadataManager
from ..registry.client import RegistryClient
from ..bundling.packager import Packager
from ..domain.models import Lockfile, PackageLock, Dependency
from ..services.install import InstallService
from ..ui.progress import ProgressManager

class DevService:
    """handles initialization of development environments."""
    
    def __init__(
        self,
        sheet_client: SheetClient,
        registry_client: RegistryClient,
        install_service: InstallService,
        packager: Packager,
        progress_manager: ProgressManager = None
    ):
        self.sheet_client = sheet_client
        self.registry_client = registry_client
        self.install_service = install_service
        self.packager = packager
        self.metadata_manager = MetadataManager(sheet_client)
        self.progress_manager = progress_manager or ProgressManager()
        
    async def init_dev_environment(self, package_name: str, version: Optional[str] = None):
        """
        initialize a development environment for the specified package.
        
        args:
            package_name: name of the package to clone
            version: optional specific version (defaults to latest)
        """
        await self.sheet_client.connect()
        
        try:
            # 1. check if sheet is empty (safe to overwrite?)
            existing_metadata = await self.metadata_manager.get_project_metadata()
            if existing_metadata:
                raise ValueError("Sheet already contains a project. Use a blank sheet for development.")
            
            # 2. get package metadata from registry
            if not version:
                versions = self.registry_client.get_versions(package_name)
                if not versions:
                    raise ValueError(f"Package '{package_name}' not found in registry")
                version = versions[0] # latest
            
            self.progress_manager.print(f"[blue]Initializing development environment for {package_name} v{version}...[/blue]")
            
            # 3. download package to temp dir
            with tempfile.TemporaryDirectory() as tmpdir:
                tmp_path = Path(tmpdir)
                package_file = tmp_path / f"{package_name}-{version}.gspkg"
                
                # download main package with progress
                with self.progress_manager.download_progress() as progress:
                    task_id = progress.add_task(f"downloading {package_name}@{version}", total=None)
                    self.registry_client.download_package(
                        package_name, version, package_file, progress, task_id
                    )
                
                # 4. extract package to get metadata and functions
                metadata, _, functions, integrity = self.packager.extract_package(package_file)
                
                # 5. install dependencies
                # we use InstallService to handle dependency resolution and installation
                dependencies = metadata.get("dependencies", [])
                if dependencies:
                    self.progress_manager.print(f"[blue]Installing dependencies: {', '.join(dependencies)}[/blue]")
                    # resolve dependencies with spinner
                    from ..domain.models import Dependency
                    requirements = []
                    for d in dependencies:
                        # parse dependency string
                        import re
                        match = re.match(r"^([A-Za-z0-9_\-]+)(.*)$", d)
                        if match:
                            name, spec = match.groups()
                            requirements.append(Dependency(name=name, specifier=spec.strip() or ""))
                        else:
                            requirements.append(Dependency(name=d))
                    
                    with self.progress_manager.spinner("resolving dependencies"):
                        resolved_packages = self.install_service.resolver.resolve(requirements)
                    
                    # install resolved dependencies
                    lockfile = Lockfile()
                    
                    # download all dependencies with progress
                    with self.progress_manager.download_progress() as progress:
                        for pkg in resolved_packages:
                            pkg_path = tmp_path / f"{pkg.name}-{pkg.version}.gspkg"
                            task_id = progress.add_task(f"downloading {pkg.name}@{pkg.version}", total=None)
                            self.registry_client.download_package(
                                pkg.name, pkg.version, pkg_path, progress, task_id
                            )
                    
                    # extract and install functions for all dependencies
                    total_dep_functions = 0
                    pkg_data = []
                    for pkg in resolved_packages:
                        pkg_path = tmp_path / f"{pkg.name}-{pkg.version}.gspkg"
                        
                        pkg_meta, _, pkg_funcs, pkg_integrity = self.packager.extract_package(pkg_path)
                        
                        # add to lockfile
                        lockfile.packages[pkg.name] = PackageLock(
                            version=pkg.version,
                            integrity=pkg_integrity,
                            dependencies=pkg_meta.get("dependencies", []),
                            functions=list(pkg_funcs.keys())
                        )
                        
                        pkg_data.append((pkg.name, pkg_funcs))
                        total_dep_functions += len(pkg_funcs)
                    
                    # install all dependency functions with progress
                    with self.progress_manager.task_progress("installing dependency functions", total=total_dep_functions) as (progress, task_id):
                        for pkg_name, pkg_funcs in pkg_data:
                            for fname, func in pkg_funcs.items():
                                await self.sheet_client.create_function(func)
                                if progress and task_id is not None:
                                    progress.advance(task_id, 1)
                    
                    # set lockfile
                    await self.metadata_manager.set_lockfile(lockfile)
                else:
                    # empty lockfile
                    await self.metadata_manager.set_lockfile(Lockfile())
                
                # 6. install package functions (as source)
                total_source_functions = len(functions)
                with self.progress_manager.task_progress("installing source functions", total=total_source_functions) as (progress, task_id):
                    for fname, func in functions.items():
                        await self.sheet_client.create_function(func)
                        if progress and task_id is not None:
                            progress.advance(task_id, 1)
                
                # 7. set project metadata
                # we use the package's metadata as the project metadata
                await self.metadata_manager.set_project_metadata(metadata)
                
                self.progress_manager.print(f"[green]✓ Development environment ready for {package_name} v{version}[/green]")
                
        finally:
            await self.sheet_client.close()
