from typing import List, Dict
from pathlib import Path
from ..sheets.client import SheetClient
from ..sheets.metadata import MetadataManager
from ..registry.client import RegistryClient
from ..registry.cache import LocalCache
from ..resolution.resolver import Resolver
from ..bundling.packager import Packager
from ..domain.models import Lockfile, PackageLock, Dependency
from ..utils.hash import hash_function_object
import hashlib

class InstallService:
    def __init__(
        self,
        sheet_client: SheetClient,
        registry_client: RegistryClient,
        cache: LocalCache,
        resolver: Resolver,
        packager: Packager
    ):
        self.sheet_client = sheet_client
        self.registry_client = registry_client
        self.cache = cache
        self.resolver = resolver
        self.packager = packager
        self.metadata_manager = MetadataManager(sheet_client)

    async def install(self, packages: List[str], local: bool = False, resolutions: Dict[str, Dict[str, str]] = None):
        """
        install packages.
        
        args:
            packages: list of package names or paths.
            local: whether to treat packages as local paths.
            resolutions: map of {package_name: {old_func_name: new_func_name}} for renaming functions.
        """
        resolutions = resolutions or {}
        
        # 1. load current project metadata
        await self.sheet_client.connect()
        try:
            project_metadata = await self.metadata_manager.get_project_metadata()
            if not project_metadata:
                project_metadata = {"name": "my-project", "version": "0.1.0", "dependencies": []}

            # get current functions to check for collisions
            current_functions = await self.sheet_client.get_named_functions()
            existing_func_names = set(current_functions.keys())

            # 2. update dependencies
            current_deps = project_metadata.get("dependencies", [])
            for pkg in packages:
                dep_entry = pkg
                if local:
                    path = Path(pkg).resolve()
                    if not path.exists():
                        raise FileNotFoundError(f"Local package not found: {path}")
                    
                    metadata, _, functions, integrity = self.packager.extract_package(path)
                    pkg_name = metadata["name"]
                    dep_entry = f"{pkg_name}@file:{path}"
                
                if dep_entry not in current_deps:
                    pkg_name = dep_entry.split('@')[0] if '@' in dep_entry else dep_entry
                    current_deps = [d for d in current_deps if not (d.startswith(f"{pkg_name}@") or d == pkg_name)]
                    current_deps.append(dep_entry)
            
            project_metadata["dependencies"] = current_deps
            
            # 3. resolve dependencies
            requirements = []
            local_packages = {} # map name -> path
            
            for d in current_deps:
                if "@file:" in d:
                    name, path_str = d.split("@file:")
                    path = Path(path_str)
                    local_packages[name] = path
                    if path.exists():
                        metadata, _, functions, _ = self.packager.extract_package(path)
                        for dep in metadata.get("dependencies", []):
                             requirements.append(Dependency(name=dep))
                else:
                    import re
                    match = re.match(r"^([A-Za-z0-9_\-]+)(.*)$", d)
                    if match:
                        name, spec = match.groups()
                        requirements.append(Dependency(name=name, specifier=spec.strip() or ""))
                    else:
                        requirements.append(Dependency(name=d))

            resolved_packages = self.resolver.resolve(requirements)
            
            # 4. download, extract, and refactor
            all_functions = {}
            lockfile = Lockfile()
            
            # load previous lockfile for ownership check
            previous_lock = await self.metadata_manager.get_lockfile()
            previous_packages = previous_lock.packages if previous_lock else {}
            
            packages_to_install = []
            
            # local packages
            for name, path in local_packages.items():
                if not path.exists(): continue
                packages_to_install.append({
                    "name": name,
                    "version": "local",
                    "path": path,
                    "resolved": f"file:{path}",
                    "is_local": True
                })

            # remote packages
            for pkg in resolved_packages:
                if pkg.name in local_packages: continue
                if not self.cache.has_artifact(pkg.name, pkg.version):
                    target_path = self.cache.get_artifact_path(pkg.name, pkg.version)
                    self.registry_client.download_package(pkg.name, pkg.version, target_path)
                
                path = self.cache.get_artifact_path(pkg.name, pkg.version)
                packages_to_install.append({
                    "name": pkg.name,
                    "version": pkg.version,
                    "path": path,
                    "resolved": f"registry:{pkg.name}/{pkg.version}",
                    "is_local": False
                })
            
            # phase 1: extraction and collision detection
            from ..domain.errors import CollisionError
            
            # build ownership map from current lockfile
            current_ownership = {}
            if previous_lock:
                for pkg_name, pkg_lock in previous_lock.packages.items():
                    for f in pkg_lock.functions:
                        current_ownership[f] = pkg_name
            
            # track functions being added to detect inter-package collisions
            new_functions_map = {}
            
            processed_packages = []
            
            for pkg_info in packages_to_install:
                name = pkg_info["name"]
                path = pkg_info["path"]
                
                metadata, _, functions, integrity = self.packager.extract_package(path)
                pkg_info["metadata"] = metadata
                pkg_info["integrity"] = integrity
                
                # apply resolutions (renaming happens before collision check)
                pkg_resolutions = resolutions.get(name, {})
                if pkg_resolutions:
                    renamed_functions = {}
                    for fname, func in functions.items():
                        new_fname = pkg_resolutions.get(fname, fname)
                        renamed_functions[new_fname] = func
                    functions = renamed_functions
                
                pkg_info["functions"] = functions
                
                # check collisions against existing functions
                conflicts = []
                for fname in functions:
                    # check against existing sheet functions
                    if fname in existing_func_names:
                        owner = current_ownership.get(fname)
                        if owner != name:
                            conflicts.append(fname)
                    
                    # check against other packages in this batch
                    if fname in new_functions_map:
                        other_pkg = new_functions_map[fname]
                        if other_pkg != name:
                            conflicts.append(fname)
                    
                    new_functions_map[fname] = name
                
                if conflicts:
                    raise CollisionError(name, conflicts)
                
                processed_packages.append(pkg_info)

            # phase 2: refactoring and lockfile generation
            from ..refactoring.refactorer import Refactorer
            
            for pkg_info in processed_packages:
                name = pkg_info["name"]
                functions = pkg_info["functions"]
                pkg_resolutions = resolutions.get(name, {})
                
                if pkg_resolutions:
                    refactorer = Refactorer(pkg_resolutions)
                    for fname, func in functions.items():
                        func.name = fname
                        func.definition = refactorer.refactor(func.definition)
                
                # add to lockfile
                lockfile.packages[name] = PackageLock(
                    version=pkg_info["version"],
                    resolved=pkg_info["resolved"],
                    integrity=pkg_info["integrity"],
                    dependencies=pkg_info["metadata"].get("dependencies", []),
                    functions=list(functions.keys())
                )
                
                for fname, func in functions.items():
                    all_functions[fname] = func

            # 5. update sheet
            await self.metadata_manager.set_project_metadata(project_metadata)
            await self.metadata_manager.set_lockfile(lockfile)
            
            # sync functions (remove old ones)
            if previous_lock:
                for pkg_lock in previous_lock.packages.values():
                    for fname in pkg_lock.functions:
                        if fname not in all_functions:
                            await self.sheet_client.delete_function(fname)

            # create/update functions
            for fname, func in all_functions.items():
                if fname in existing_func_names:
                    await self.sheet_client.update_function(func)
                else:
                    await self.sheet_client.create_function(func)
            
        finally:
            await self.sheet_client.close()
