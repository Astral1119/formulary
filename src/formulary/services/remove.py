import sys
from typing import List, Set, Dict
from pathlib import Path
from ..sheets.client import SheetClient
from ..sheets.metadata import MetadataManager
from ..domain.models import Lockfile


class RemoveService:
    """handles package removal with dependency tracking."""
    
    def __init__(self, sheet_client: SheetClient):
        self.sheet_client = sheet_client
        self.metadata_manager = MetadataManager(sheet_client)
    
    async def remove(self, packages: List[str], force: bool = False):
        """
        remove packages from the sheet.
        
        args:
            packages: list of package names to remove
            force: if True, remove even if other packages depend on them
            
        raises:
            ValueError: if package not installed or has dependents (without force)
        """
        # 1. connect to sheet
        await self.sheet_client.connect()
        
        try:
            # 2. load current state
            project_metadata, lockfile = await self.metadata_manager.get_all_metadata()
            if not project_metadata:
                raise ValueError("No project initialized. Run 'init' first.")
            
            if not lockfile:
                lockfile = Lockfile()
            
            # 3. validate packages exist and resolve names
            current_deps = project_metadata.get("dependencies", [])
            resolved_packages = set()
            
            for pkg_input in packages:
                found = False
                # 1. check if it's a direct package name match
                for dep in current_deps:
                    # check for exact name or name with version/specifier
                    # e.g. "pkg", "pkg@1.0", "pkg>=1.0"
                    # we want to match the NAME part.
                    dep_name = dep
                    if "@" in dep:
                        dep_name = dep.split("@")[0]
                    elif "=" in dep: # >=, <=, ==
                         dep_name = dep.split("=")[0].split(">")[0].split("<")[0]
                    
                    if pkg_input == dep_name:
                        resolved_packages.add(dep_name)
                        found = True
                        break
                
                if found:
                    continue
                    
                # 2. check if it matches a file path in a local dependency
                # dep format: name@file:path
                for dep in current_deps:
                    if "@file:" in dep:
                        name, path_str = dep.split("@file:")
                        # check if input matches path
                        try:
                            # check absolute path equality
                            dep_path = Path(path_str).resolve()
                            input_path = Path(pkg_input).resolve()
                            if dep_path == input_path:
                                resolved_packages.add(name)
                                found = True
                                break
                        except Exception:
                            pass
                            
                        # fallback: check if input string is suffix of path string
                        # e.g. input="dist/pkg.gspkg", path="/abs/dist/pkg.gspkg"
                        if pkg_input in path_str and path_str.endswith(pkg_input):
                            resolved_packages.add(name)
                            found = True
                            break
                
                if not found:
                    raise ValueError(f"Package '{pkg_input}' is not installed")
            
            # use resolved names for the rest of the logic
            packages = list(resolved_packages)

            # 4. calculate new dependencies (what we want to keep)
            new_deps = []
            for dep in current_deps:
                is_removed = False
                for pkg in packages:
                    if dep == pkg or dep.startswith(f"{pkg}@") or dep.startswith(f"{pkg}="):
                        is_removed = True
                        break
                if not is_removed:
                    new_deps.append(dep)

            # 5. determine packages to keep (direct + transitive)
            # we can use the lockfile to trace dependencies!
            packages_to_keep = set()
            
            # add direct dependencies
            for dep in new_deps:
                # parse name
                if "@file:" in dep:
                    name = dep.split("@file:")[0]
                else:
                    # simple parse
                    name = dep.split("@")[0].split("=")[0].split(">")[0].split("<")[0]
                packages_to_keep.add(name)
            
            # trace transitive dependencies using lockfile
            # we need to iterate until stable
            changed = True
            while changed:
                changed = False
                # iterate over all packages in lockfile
                for pkg_name, pkg_lock in lockfile.packages.items():
                    if pkg_name in packages_to_keep:
                        # add its dependencies
                        for dep in pkg_lock.dependencies:
                            # parse dependency name
                            # dep string in metadata might be "name" or "name>=1.0"
                            import re
                            match = re.match(r"^([A-Za-z0-9_\-]+)(.*)$", dep)
                            if match:
                                dep_name = match.group(1)
                                if dep_name not in packages_to_keep:
                                    packages_to_keep.add(dep_name)
                                    changed = True
                            else:
                                if dep not in packages_to_keep:
                                    packages_to_keep.add(dep)
                                    changed = True

            # 6. identify packages to remove (installed but not in packages_to_keep)
            packages_to_remove = []
            for pkg_name in lockfile.packages.keys():
                if pkg_name not in packages_to_keep:
                    packages_to_remove.append(pkg_name)
            
            # 7. remove packages
            for pkg_name in packages_to_remove:
                pkg_lock = lockfile.packages[pkg_name]
                
                # delete functions
                for func_name in pkg_lock.functions:
                    await self.sheet_client.delete_function(func_name)
                
                # remove from lockfile
                del lockfile.packages[pkg_name]
            
            if packages_to_remove:
                console = __import__('rich.console').console.Console()
                removed_names = [p for p in packages_to_remove if p not in packages]
                if removed_names:
                    console.print(f"[dim]Also removed orphaned dependencies: {', '.join(removed_names)}[/dim]")

            # 8. update metadata
            project_metadata["dependencies"] = new_deps
            await self.metadata_manager.set_project_metadata(project_metadata)
            await self.metadata_manager.set_lockfile(lockfile)
            
        finally:
            await self.sheet_client.close()
