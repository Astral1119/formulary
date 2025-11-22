from typing import Optional
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..registry.client import RegistryClient

class InfoService:
    """handles fetching and displaying package information."""
    
    def __init__(self, registry_client: RegistryClient):
        self.registry_client = registry_client
        self.console = Console()
        
    def show_info(self, package_name: str, version: Optional[str] = None):
        """
        fetch and display information about a package.
        
        args:
            package_name: name of the package
            version: optional specific version
        """
        try:
            # get versions first to check existence and latest
            versions = self.registry_client.get_versions(package_name)
            if not versions:
                self.console.print(f"[red]Package '{package_name}' not found in registry.[/red]")
                return
            
            # find target version
            if not version:
                from packaging.version import Version
                sorted_versions = sorted(versions, key=lambda v: Version(v), reverse=True)
                target_version = sorted_versions[0]
            else:
                target_version = version
            
            # get version-level metadata (dependencies, path)
            version_metadata = self.registry_client.get_package_metadata(package_name, target_version)
            
            # get package-level metadata (description, author, license, etc.)
            # we need to access the index directly for this
            # gitHubRegistry has _get_index() but it's private, so we'll use a workaround
            # actually, let's just fetch the index ourselves since it's public
            index = self.registry_client._get_index()
            pkg_data = index.get(package_name, {})
            
            # display info
            grid = Table.grid(expand=True)
            grid.add_column(style="bold cyan", justify="right")
            grid.add_column(style="white")
            
            # basic info
            grid.add_row("Name:", package_name)
            grid.add_row("Version:", target_version)
            
            # description (from package level)
            description = pkg_data.get("description", "No description provided.")
            grid.add_row("Description:", description)
            
            # author (from package level)
            author = pkg_data.get("author")
            if author:
                grid.add_row("Author:", author)
                
            # license (from package level)
            license_id = pkg_data.get("license")
            if license_id:
                grid.add_row("License:", license_id)
                
            # homepage (from package level)
            homepage = pkg_data.get("homepage")
            if homepage:
                grid.add_row("Homepage:", homepage)
                
            # dependencies (from version level)
            dependencies = version_metadata.get("dependencies", [])
            if dependencies:
                grid.add_row("Dependencies:", ", ".join(dependencies))
            else:
                grid.add_row("Dependencies:", "None")
                
            # available versions (if showing latest)
            if not version:
                grid.add_row("Latest:", target_version)
                if len(versions) > 1:
                    other_versions = [v for v in versions if v != target_version]
                    # show top 5 recent
                    from packaging.version import Version
                    sorted_others = sorted(other_versions, key=lambda v: Version(v), reverse=True)[:5]
                    grid.add_row("Other Versions:", ", ".join(sorted_others))

            self.console.print(Panel(grid, title=f"📦 Package Info: {package_name}", border_style="cyan"))
            
        except Exception as e:
            self.console.print(f"[red]Error fetching package info:[/red] {e}")
