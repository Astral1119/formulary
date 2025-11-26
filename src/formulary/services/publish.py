from typing import Dict, Optional
from pathlib import Path
import re
import tempfile
import shutil
import subprocess
import json
from packaging.version import Version, InvalidVersion

from ..sheets.client import SheetClient  
from ..sheets.metadata import MetadataManager
from ..bundling.packager import Packager
from ..domain.models import Function, Lockfile
from ..github.client import GitHubClient
from ..ui.progress import ProgressManager


class PublishService:
    """handles package publishing from sheet to .gspkg file and registry."""
    
    def __init__(
        self, 
        sheet_client: SheetClient, 
        packager: Packager, 
        registry_url: str = "https://github.com/Astral1119/formulary-registry",
        progress_manager: ProgressManager = None
    ):
        self.sheet_client = sheet_client
        self.packager = packager
        self.metadata_manager = MetadataManager(sheet_client)
        self.registry_url = registry_url
        self.progress_manager = progress_manager or ProgressManager()
    
    async def pack(self, output_dir: Path) -> Path:
        """
        create a .gspkg package from current sheet state (local only).
        
        args:
            output_dir: directory to save the package
            
        returns:
            path to created package file
            
        Raises:
            ValueError: If metadata is invalid or missing
        """
        await self.sheet_client.connect()
        
        try:
            return await self._create_package(output_dir)
        finally:
            await self.sheet_client.close()
    
    async def _create_package(self, output_dir: Path, lockfile: Optional[Lockfile] = None) -> Path:
        """
        internal helper to create package (assumes connection already established).
        
        args:
            output_dir: directory to save the package
            
        returns:
            path to created package file
        """
        # load and validate metadata
        metadata, lockfile = await self._get_and_validate_metadata()
        
        package_name = metadata["name"]
        version = metadata["version"]
        
        # get package functions (excluding metadata and dependencies)
        with self.progress_manager.spinner("extracting package functions"):
            package_functions = await self._get_package_functions(metadata, lockfile)
        
        # create output directory
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # create package file
        package_filename = f"{package_name}-{version}.gspkg"
        package_path = output_dir / package_filename
        
        with self.progress_manager.spinner(f"creating package {package_filename}"):
            self.packager.create_package(
                package_path,
                metadata,
                package_functions
            )
        
        return package_path

    async def publish_dry_run(self) -> Dict:
        """
        show what would be published without creating a PR.
        
        returns:
            dict with package details
        """
        await self.sheet_client.connect()
        
        try:
            metadata, _ = await self._get_and_validate_metadata()
            package_functions = await self._get_package_functions(metadata)
            
            return {
                "name": metadata["name"],
                "version": metadata["version"],
                "description": metadata.get("description", ""),
                "functions": list(package_functions.keys()),
                "dependencies": metadata.get("dependencies", []),
                "registry_url": self.registry_url
            }
        finally:
            await self.sheet_client.close()

    async def publish(self) -> str:
        """
        publish package to registry via GitHub PR.
        
        returns:
            URL of created pull request
            
        raises:
            ValueError: if metadata/package is invalid
            RuntimeError: if GitHub operations fail
        """
        await self.sheet_client.connect()
        
        try:
            # 1. validate metadata and get package info
            metadata, lockfile = await self._get_and_validate_metadata()
            package_name = metadata["name"]
            version = metadata["version"]
            
            # 2. validate package name follows rules
            self._validate_package_name(package_name)
            
            # 3. create GitHub client and check auth
            gh_client = GitHubClient()
            
            if not gh_client.check_gh_cli():
                raise RuntimeError(
                    "GitHub CLI not found or not authenticated. Please install and authenticate with:\n"
                    "  brew install gh\n"
                    "  gh auth login"
                )
            
            username = gh_client.get_authenticated_user()
            if not username:
                raise RuntimeError("Could not determine GitHub username")
            
            # 4. create package locally
            with tempfile.TemporaryDirectory() as tmpdir:
                tmpdir_path = Path(tmpdir)
                package_path = await self._create_package(tmpdir_path, lockfile)
                
                # 5. clone or update fork
                fork_path = tmpdir_path / "registry-fork"
                
                if gh_client.check_fork_exists(username):
                    # clone existing fork
                    with self.progress_manager.spinner("cloning fork"):
                        try:
                            subprocess.run(
                                ["git", "clone", f"https://github.com/{username}/formulary-registry.git", str(fork_path)],
                                check=True,
                                capture_output=True,
                                text=True
                            )
                        except subprocess.CalledProcessError as e:
                            raise RuntimeError(
                                f"failed to clone fork: {e.stderr}\n"
                                "ensure git is installed and you have network access."
                            ) from e
                    
                    # sync with upstream and reset to upstream/main
                    with self.progress_manager.spinner("syncing with upstream"):
                        gh_client.sync_fork(username)
                    
                    try:
                        subprocess.run(
                            ["git", "fetch", "origin"],
                            cwd=fork_path,
                            check=True,
                            capture_output=True,
                            text=True
                        )
                        subprocess.run(
                            ["git", "checkout", "main"],
                            cwd=fork_path,
                            check=True,
                            capture_output=True,
                            text=True
                        )
                        subprocess.run(
                            ["git", "reset", "--hard", "origin/main"],
                            cwd=fork_path,
                            check=True,
                            capture_output=True,
                            text=True
                        )
                    except subprocess.CalledProcessError as e:
                        raise RuntimeError(
                            f"failed to sync fork with upstream: {e.stderr}"
                        ) from e
                else:
                    # create fork
                    with self.progress_manager.spinner("creating fork"):
                        gh_client.create_fork()
                    # clone it
                    with self.progress_manager.spinner("cloning fork"):
                        try:
                            subprocess.run(
                                ["git", "clone", f"https://github.com/{username}/formulary-registry.git", str(fork_path)],
                                check=True,
                                capture_output=True,
                                text=True
                            )
                        except subprocess.CalledProcessError as e:
                            raise RuntimeError(
                                f"failed to clone new fork: {e.stderr}\n"
                                "ensure git is installed and you have network access."
                            ) from e
                
                # 6. create branch
                branch_name = f"publish/{package_name}-{version}"
                gh_client.create_branch(fork_path, branch_name)
                
                # 7. update registry files
                self._update_registry_files(fork_path, package_path, metadata, username)
                
                # 8. commit and push
                commit_message = f"Add {package_name} v{version}"
                with self.progress_manager.spinner(f"pushing to {branch_name}"):
                    gh_client.commit_and_push(fork_path, branch_name, commit_message, username)
                
                # 9. create PR
                pr_title = f"📦 {package_name} v{version}"
                pr_body = self._generate_pr_body(metadata, package_name, version)
                
                with self.progress_manager.spinner("creating pull request"):
                    pr_url = gh_client.create_pull_request(
                        branch_name,
                        pr_title,
                        pr_body,
                        username
                    )
                
                return pr_url
                
        finally:
            await self.sheet_client.close()
    
    def _update_registry_files(self, fork_path: Path, package_path: Path, metadata: Dict, username: str):
        """update index.json and add package file to registry."""
        
        package_name = metadata["name"]
        version = metadata["version"]
        
        # 1. read current index.json from fork
        index_path = fork_path / "index.json"
        if index_path.exists():
            with open(index_path) as f:
                index = json.load(f)
        else:
            index = {}
        
        # 2. update ONLY the package being published
        if package_name not in index:
            # new package - create entry
            index[package_name] = {
                "owners": [username],
                "versions": {},
                "latest": version
            }
        else:
            # existing package - preserve owners, update latest
            if "owners" not in index[package_name]:
                index[package_name]["owners"] = [username]
            # update latest version
            index[package_name]["latest"] = version
            
        # update description if provided
        if "description" in metadata and metadata["description"]:
            index[package_name]["description"] = metadata["description"]
        
        # add this specific version
        package_dir = f"packages/{package_name}/{version}"
        package_filename = f"{package_name}-{version}.gspkg"
        
        index[package_name]["versions"][version] = {
            "path": f"{package_dir}/{package_filename}",
            "dependencies": metadata.get("dependencies", [])
        }
        
        # 3. write updated index.json
        with open(index_path, 'w') as f:
            json.dump(index, f, indent=2)
            f.write('\n')  # add trailing newline
        
        # 4. copy package file to packages directory
        dest_dir = fork_path / "packages" / package_name / version
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        dest_path = dest_dir / package_filename
        shutil.copy(package_path, dest_path)
    
    def _generate_pr_body(self, metadata: Dict, package_name: str, version: str) -> str:
        """generate PR description."""
        functions = metadata.get("functions", [])
        dependencies = metadata.get("dependencies", [])
        description = metadata.get("description", "No description provided")
        author = metadata.get("author", "Unknown")
        license_id = metadata.get("license", "Unknown")
        homepage = metadata.get("homepage", "")
        
        body = f"""## package: {package_name} v{version}

**Description:** {description}
**Author:** {author}
**License:** {license_id}
"""
        if homepage:
            body += f"**Homepage:** {homepage}\n"
            
        body += "\n**Functions:**\n"
        if functions:
            for func in functions:
                body += f"- `{func}`\n"
        else:
            body += "- _(Functions will be extracted from package)_\n"
        
        body += "\n**Dependencies:**\n"
        if dependencies:
            for dep in dependencies:
                body += f"- {dep}\n"
        else:
            body += "- None\n"
        
        body += "\n---\n_Generated by formulary CLI_"
        
        return body

    async def _get_and_validate_metadata(self) -> tuple[Dict, Optional[Lockfile]]:
        """load and validate project metadata, also return lockfile.
        
        returns:
            tuple of (metadata, lockfile)
        """
        metadata, lockfile = await self.metadata_manager.get_all_metadata()
        if not metadata:
            raise ValueError(
                "No project metadata found. Ensure __GSPROJECT__ is defined with name and version."
            )
        
        # validate required fields
        if "name" not in metadata:
            raise ValueError("Project metadata must include 'name'")
        if "version" not in metadata:
            raise ValueError("Project metadata must include 'version'")
        if "description" not in metadata or not metadata["description"]:
            # warn but don't fail for now, or enforce? Let's enforce for new packages
            # for now just log warning if we had a logger
            pass
        if "license" not in metadata:
             # default to MIT if missing? No, let's require it or set default in init
             pass
        
        # validate version format
        self._validate_version(metadata["version"])
        
        return metadata, lockfile

    async def _get_package_functions(self, metadata: Dict, lockfile: Optional[Lockfile] = None) -> Dict[str, Function]:
        """get functions that belong to this package (excluding metadata and dependencies).
        
        args:
            metadata: project metadata
            lockfile: optional pre-loaded lockfile to avoid redundant get_named_functions call
        """
        all_functions = await self.sheet_client.get_named_functions()
        
        # get lockfile to identify dependency functions (use provided or fetch)
        if lockfile is None:
            lockfile = await self.metadata_manager.get_lockfile()
        
        # collect all function names from dependencies
        dependency_functions = set()
        if lockfile and lockfile.packages:
            for package_name, package_lock in lockfile.packages.items():
                # add all functions from this dependency package
                dependency_functions.update(package_lock.functions)
        
        package_functions: Dict[str, Function] = {}
        
        for fname, func in all_functions.items():
            # skip metadata functions
            if fname in ["__GSPROJECT__", "__LOCK__"]:
                continue
            
            # skip dependency functions
            if fname in dependency_functions:
                continue
            
            package_functions[fname] = func
        
        if not package_functions:
            raise ValueError("No functions to publish. Add some named functions to your sheet.")
        
        return package_functions

    def _validate_version(self, version: str):
        """validate version string is valid semver."""
        
        try:
            Version(version)
        except InvalidVersion:
            raise ValueError(
                f"Invalid version '{version}'. Must be valid semantic version (e.g., '1.0.0')"
            )

    def _validate_package_name(self, name: str):
        """validate package name follows naming rules."""
        # lowercase-with-hyphens, no underscores
        if not re.match(r'^[a-z][a-z0-9\-]*$', name):
            raise ValueError(
                f"Invalid package name '{name}'. Must be lowercase, start with a letter, "
                "and contain only lowercase letters, numbers, and hyphens (no underscores)."
            )
        
        # check against Sheets restrictions
        if name.upper() in ['SUM', 'TRUE', 'FALSE']:  # basic built-ins
            raise ValueError(f"Package name '{name}' conflicts with built-in Sheets function")
        
        # check A1/R1C1 syntax
        if re.match(r'^[A-Z]+\d+$', name.upper()) or re.match(r'^R\d+C\d+$', name.upper()):
            raise ValueError(f"Package name '{name}' uses A1 or R1C1 syntax (not allowed)")
        
        # check length
        if len(name) >= 255:
            raise ValueError(f"Package name '{name}' must be shorter than 255 characters")
        
        # check doesn't start with number
        if name[0].isdigit():
            raise ValueError(f"Package name '{name}' cannot start with a number")
