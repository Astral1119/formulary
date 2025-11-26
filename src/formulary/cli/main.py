import typer
import asyncio
from pathlib import Path
from rich.console import Console
from rich.panel import Panel

from ..config import get_sheet_url, set_sheet_url, CONFIG_DIR
from ..sheets.driver import PlaywrightDriver
from ..sheets.client import SheetClient
from ..sheets.metadata import MetadataManager
from ..registry.github import GitHubRegistry
from ..registry.cache import LocalCache
from ..resolution.resolver import Resolver
from ..bundling.packager import Packager
from ..services.install import InstallService
from ..services.remove import RemoveService
from ..services.upgrade import UpgradeService
from ..services.publish import PublishService
from ..services.dev import DevService
from ..services.info import InfoService
from ..services.self import SelfManagementService
from ..profiles import ProfileManager, ProfileError
from ..ui.progress import ProgressManager
from .profile_commands import app as profile_app

app = typer.Typer()
console = Console()

# add profile subcommand
app.add_typer(profile_app, name="profile", help="Manage authentication profiles")

# TODO: make this configurable
REGISTRY_URL = "https://raw.githubusercontent.com/Astral1119/formulary-registry/main"

def get_install_service(url: str, headless: bool = True) -> InstallService:
    # get active profile
    profile_manager = ProfileManager(CONFIG_DIR)
    active_profile = profile_manager.ensure_active_profile()
    # use separate profile for headless to avoid keychain issues
    profile_path = profile_manager.get_profile_path(active_profile, headless=headless)
    user_agent = profile_manager.get_user_agent(active_profile)
    cookies = profile_manager.get_cookies(active_profile)
    
    driver = PlaywrightDriver(
        headless=headless, 
        user_data_dir=profile_path,
        user_agent=user_agent,
        cookies=cookies
    )
    progress_manager = ProgressManager(console)
    sheet_client = SheetClient(driver, url, progress_manager)
    registry_client = GitHubRegistry(REGISTRY_URL)
    cache = LocalCache(CONFIG_DIR / "cache")
    resolver = Resolver(registry_client)
    packager = Packager()
    # progress_manager already created above
    return InstallService(sheet_client, registry_client, cache, resolver, packager, progress_manager)

def get_dev_service(url: str, headless: bool = True) -> DevService:
    # get active profile
    profile_manager = ProfileManager(CONFIG_DIR)
    active_profile = profile_manager.ensure_active_profile()
    # use separate profile for headless to avoid keychain issues
    profile_path = profile_manager.get_profile_path(active_profile, headless=headless)
    user_agent = profile_manager.get_user_agent(active_profile)
    cookies = profile_manager.get_cookies(active_profile)
    
    driver = PlaywrightDriver(
        headless=headless, 
        user_data_dir=profile_path,
        user_agent=user_agent,
        cookies=cookies
    )
    progress_manager = ProgressManager(console)
    sheet_client = SheetClient(driver, url, progress_manager)
    registry_client = GitHubRegistry(REGISTRY_URL)
    cache = LocalCache(CONFIG_DIR / "cache")
    resolver = Resolver(registry_client)
    packager = Packager()
    # progress_manager already created above
    install_service = InstallService(sheet_client, registry_client, cache, resolver, packager, progress_manager)
    return DevService(sheet_client, registry_client, install_service, packager, progress_manager)

def get_info_service() -> InfoService:
    registry_client = GitHubRegistry(REGISTRY_URL)
    return InfoService(registry_client)

@app.callback(invoke_without_command=True)
def main_callback(ctx: typer.Context):
    """callback that runs before every command to check for updates."""
    # only check for updates if a subcommand is being invoked
    if ctx.invoked_subcommand is None:
        return
    
    # skip update check for self-update and self-uninstall commands to avoid recursion
    if ctx.invoked_subcommand in ["self-update", "self_update", "self-uninstall", "self_uninstall"]:
        return
    
    try:
        service = SelfManagementService()
        result = service.check_for_updates(use_cache=True)
        
        if result.get("update_available"):
            console.print("[dim]ℹ A new version of Formulary is available. Run 'formulary self-update' to upgrade.[/dim]")
    except Exception:
        # silently fail - don't interrupt user's command with update check errors
        pass

@app.command()
def init(url: str, name: str = None, force: bool = False, interactive: bool = True, headed: bool = False):
    """initialize a new project with the given Google Sheet URL."""
    set_sheet_url(url)
    headless = not headed
    
    # check if metadata already exists first
    # ensure active profile exists
    profile_manager = ProfileManager(CONFIG_DIR)
    try:
        active_profile = profile_manager.ensure_active_profile()
        # use separate profile for headless to avoid keychain issues
        profile_path = profile_manager.get_profile_path(active_profile, headless=headless)
        user_agent = profile_manager.get_user_agent(active_profile)
        cookies = profile_manager.get_cookies(active_profile)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    
    driver = PlaywrightDriver(
        headless=not headed, 
        user_data_dir=profile_path,
        user_agent=user_agent,
        cookies=cookies
    )
    sheet_client = SheetClient(driver, url, ProgressManager(console))
    
    # step 1: check if metadata exists
    async def check_existing():
        await sheet_client.connect()
        try:
            metadata_manager = MetadataManager(sheet_client)
            existing_metadata, existing_lockfile = await metadata_manager.get_all_metadata()
            return existing_metadata or existing_lockfile
        finally:
            await sheet_client.close()
    
    try:
        has_existing = asyncio.run(check_existing())
        if has_existing and not force:
            console.print("[yellow]Project metadata already exists in this sheet.[/yellow]")
            console.print("Use --force to overwrite existing metadata.")
            raise typer.Exit(code=0)
    except typer.Exit:
        raise
    except Exception as e:
        console.print(f"[red]Error checking existing metadata:[/red] {e}")
        raise typer.Exit(code=1)
    
    # step 2: prompt for project details (after confirming we can proceed)
    if interactive:
        from rich.prompt import Prompt, Confirm
        
        console.print("[bold]📦 Initialize new Formulary package[/bold]")
        
        # name
        default_name = name or "my-project"
        project_name = Prompt.ask("Package name", default=default_name)
        
        # version
        version = Prompt.ask("Version", default="0.1.0")
        
        # description
        description = Prompt.ask("Description", default="")
        
        # author (try to get from git)
        import subprocess
        default_author = None
        try:
            git_name = subprocess.check_output(["git", "config", "user.name"]).decode().strip()
            git_email = subprocess.check_output(["git", "config", "user.email"]).decode().strip()
            if git_name and git_email:
                default_author = f"{git_name} <{git_email}>"
        except:
            pass
        
        # only provide default if we found git config, otherwise no default
        if default_author:
            author = Prompt.ask("Author", default=default_author)
        else:
            author = Prompt.ask("Author")
        
        # license
        console.print("\n[bold]License:[/bold]")
        console.print("  1. MIT (recommended - permissive, simple)")
        console.print("  2. Apache-2.0 (permissive with patent protection)")
        console.print("  3. BSD-3-Clause (permissive, academic)")
        console.print("  4. GPL-3.0 (copyleft, requires derivatives be open source)")
        console.print("  5. CC0-1.0 (public domain)")
        console.print("  6. Custom (enter SPDX identifier)")
        
        license_choice = Prompt.ask("Choice", choices=["1", "2", "3", "4", "5", "6"], default="1")
        
        licenses = {
            "1": "MIT",
            "2": "Apache-2.0",
            "3": "BSD-3-Clause",
            "4": "GPL-3.0",
            "5": "CC0-1.0"
        }
        
        if license_choice == "6":
            license_id = Prompt.ask("Enter SPDX License Identifier")
        else:
            license_id = licenses[license_choice]
            
        # homepage
        homepage = Prompt.ask("Homepage (optional)", default="")
        
        # keywords
        keywords_str = Prompt.ask("Keywords (comma-separated, optional)", default="")
        keywords = [k.strip() for k in keywords_str.split(",") if k.strip()]
        
    else:
        project_name = name or "my-project"
        version = "0.1.0"
        description = ""
        author = None
        license_id = "MIT"
        homepage = None
        keywords = []
    
    # step 3: create metadata in sheet
    async def initialize_metadata():
        await sheet_client.connect()
        try:
            metadata_manager = MetadataManager(sheet_client)
            
            # create default project metadata
            project_metadata = {
                "name": project_name,
                "version": version,
                "description": description,
                "author": author,
                "license": license_id,
                "homepage": homepage,
                "keywords": keywords,
                "dependencies": []
            }
            
            await metadata_manager.set_project_metadata(project_metadata)
            
            # wait for first function to complete before creating second
            await asyncio.sleep(1)
            
            # create empty lockfile
            from ..domain.models import Lockfile
            lockfile = Lockfile()
            await metadata_manager.set_lockfile(lockfile)
        finally:
            await sheet_client.close()

    
    try:
        asyncio.run(initialize_metadata())
        
        console.print(Panel.fit(
            f"[bold green]Project Initialized[/bold green]\n"
            f"URL: {url}\n"
            f"Name: {project_name}\n"
            f"Version: {version}\n"
            f"License: {license_id}\n"
            f"Created: __GSPROJECT__ and __LOCK__ functions",
            border_style="green"
        ))
    except Exception as e:
        console.print(f"[red]Error initializing project:[/red] {e}")
        raise typer.Exit(code=1)

@app.command()
def dev(url: str, package_name: str, version: str = None, headed: bool = False):
    """
    initialize a development environment for an existing package.
    
    installs the package and its dependencies into the sheet, and sets up
    the project metadata so you can modify and republish it.
    """
    set_sheet_url(url)
    
    dev_service = get_dev_service(url, headless=not headed)
    
    try:
        asyncio.run(dev_service.init_dev_environment(package_name, version))
        console.print(Panel.fit(
            f"[bold green]Development Environment Ready[/bold green]\n"
            f"Package: {package_name}\n"
            f"URL: {url}\n"
            f"You can now modify functions and use 'formulary pack' or 'formulary publish'.",
            border_style="green"
        ))
    except Exception as e:
        console.print(f"[red]Error setting up dev environment:[/red] {e}")
        raise typer.Exit(code=1)

@app.command()
def info(
    package_name: str, 
    version: str = typer.Argument(None, help="Optional specific version")
):
    """
    show information about a package.
    """
    info_service = get_info_service()
    info_service.show_info(package_name, version)

@app.command()
def cache(
    action: str = typer.Argument(..., help="Action to perform: 'clear' or 'update'"),
    target: str = typer.Argument("all", help="Target to clear: 'packages', 'index', or 'all' (default)")
):
    """
    manage the local cache (for testing purposes).
    
    actions:
      clear  - clear cached data
      update - update/refresh the registry index
      
    targets (for clear):
      packages - clear only downloaded package artifacts
      index    - clear only the registry index cache
      all      - clear everything (default)
    """
    if action == "clear":
        if target in ("packages", "all"):
            cache_obj = LocalCache(CONFIG_DIR / "cache")
            cache_obj.clear()
            console.print("[green]✓ Package cache cleared[/green]")
        
        if target in ("index", "all"):
            # clear the in-memory index cache by creating a fresh registry client
            console.print("[green]✓ Registry index cache cleared[/green]")
            console.print("[dim]Note: Index will be re-fetched on next operation[/dim]")
        
        if target not in ("packages", "index", "all"):
            console.print(f"[red]Invalid target '{target}'. Use 'packages', 'index', or 'all'.[/red]")
            raise typer.Exit(code=1)
    
    elif action == "update":
        # force refresh the registry index
        registry_client = GitHubRegistry(REGISTRY_URL)
        try:
            # clear any existing cache first
            if hasattr(registry_client, "_index_cache"):
                delattr(registry_client, "_index_cache")
            
            # fetch fresh index
            index = registry_client._get_index()
            package_count = len(index)
            
            console.print(Panel.fit(
                f"[bold green]Registry Index Updated[/bold green]\n"
                f"Packages available: {package_count}\n"
                f"Registry URL: {REGISTRY_URL}",
                border_style="green"
            ))
        except Exception as e:
            console.print(f"[red]Error updating registry index:[/red] {e}")
            raise typer.Exit(code=1)
    
    else:
        console.print(f"[red]Invalid action '{action}'. Use 'clear' or 'update'.[/red]")
        raise typer.Exit(code=1)

@app.command()
def install(packages: list[str], local: bool = False, headed: bool = False):
    """install packages. Use --local to install from a local .gspkg file."""
    url = get_sheet_url()
    if not url:
        console.print("[red]No project initialized. Run 'init' first.[/red]")
        raise typer.Exit(code=1)

    service = get_install_service(url, headless=not headed)
    from ..domain.errors import CollisionError
    
    resolutions = {}
    while True:
        try:
            asyncio.run(service.install(packages, local=local, resolutions=resolutions))
            console.print(f"[green]Successfully installed: {', '.join(packages)}[/green]")
            break
        except CollisionError as e:
            console.print(f"[yellow]Collision detected in package '{e.package_name}':[/yellow]")
            pkg_resolutions = resolutions.get(e.package_name, {})
            
            for conflict in e.conflicts:
                console.print(f"  Function [bold]{conflict}[/bold] already exists.")
                alias = typer.prompt(f"  Rename '{conflict}' to")
                pkg_resolutions[conflict] = alias
            
            resolutions[e.package_name] = pkg_resolutions
            console.print("[blue]Retrying installation with aliases...[/blue]")
        except Exception as e:
            console.print(f"[red]Error:[/red] {e}")
            raise typer.Exit(code=1)

@app.command()
def remove(packages: list[str], force: bool = False, headed: bool = False):
    """remove installed packages."""
    url = get_sheet_url()
    if not url:
        console.print("[red]No project initialized. Run 'init' first.[/red]")
        raise typer.Exit(code=1)
    headless = not headed

    # ensure active profile exists
    profile_manager = ProfileManager(CONFIG_DIR)
    try:
        active_profile = profile_manager.ensure_active_profile()
        # use separate profile for headless to avoid keychain issues
        profile_path = profile_manager.get_profile_path(active_profile, headless=headless)
        user_agent = profile_manager.get_user_agent(active_profile)
        cookies = profile_manager.get_cookies(active_profile)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    
    driver = PlaywrightDriver(
        headless=not headed, 
        user_data_dir=profile_path,
        user_agent=user_agent,
        cookies=cookies
    )
    progress_manager = ProgressManager(console)
    sheet_client = SheetClient(driver, url, progress_manager)
    service = RemoveService(sheet_client, progress_manager)
    
    try:
        asyncio.run(service.remove(packages, force=force))
        console.print(f"[green]Successfully removed: {', '.join(packages)}[/green]")
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)

@app.command()
def upgrade(packages: list[str] = None, headed: bool = False):
    """upgrade packages to latest versions."""
    url = get_sheet_url()
    if not url:
        console.print("[red]No project initialized. Run 'init' first.[/red]")
        raise typer.Exit(code=1)

    service = get_install_service(url, headless=not headed)
    # create upgrade service with same dependencies
    from ..services.upgrade import UpgradeService
    upgrade_service = UpgradeService(
        service.sheet_client,
        service.registry_client,
        service.cache,
        service.resolver,
        service.packager,
        service.progress_manager
    )
    
    try:
        upgrades = asyncio.run(upgrade_service.upgrade(packages))
        if upgrades:
            console.print("[green]Upgrades completed:[/green]")
            for pkg, versions in upgrades.items():
                console.print(f"  {pkg}: {versions['old']} → {versions['new']}")
        else:
            console.print("[yellow]No upgrades available[/yellow]")
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)

@app.command()
def pack(output: str = "./dist", headed: bool = False):
    """package current sheet as .gspkg file (local only)."""
    url = get_sheet_url()
    if not url:
        console.print("[red]No sheet URL configured. Run 'formulary init' first.[/red]")
        raise typer.Exit(code=1)
    headless = not headed
    
    # ensure active profile exists
    profile_manager = ProfileManager(CONFIG_DIR)
    try:
        active_profile = profile_manager.ensure_active_profile()
        # use separate profile for headless to avoid keychain issues
        profile_path = profile_manager.get_profile_path(active_profile, headless=headless)
        user_agent = profile_manager.get_user_agent(active_profile)
        cookies = profile_manager.get_cookies(active_profile)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    
    driver = PlaywrightDriver(
        headless=not headed, 
        user_data_dir=profile_path,
        user_agent=user_agent,
        cookies=cookies
    )
    progress_manager = ProgressManager(console)
    sheet_client = SheetClient(driver, url, progress_manager)
    packager = Packager()
    service = PublishService(sheet_client, packager, progress_manager=progress_manager)
    
    try:
        package_path = asyncio.run(service.pack(Path(output)))
        console.print(Panel.fit(
            f"[bold green]Package Created[/bold green]\n"
            f"File: {package_path}",
            border_style="green"
        ))
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)

@app.command()
def publish(dry_run: bool = False, headed: bool = False):
    """publish package to registry via GitHub PR."""
    url = get_sheet_url()
    if not url:
        console.print("[red]No sheet URL configured. Run 'formulary init' first.[/red]")
        raise typer.Exit(code=1)
    headless = not headed
    
    # ensure active profile exists
    profile_manager = ProfileManager(CONFIG_DIR)
    try:
        active_profile = profile_manager.ensure_active_profile()
        # use separate profile for headless to avoid keychain issues
        profile_path = profile_manager.get_profile_path(active_profile, headless=headless)
        user_agent = profile_manager.get_user_agent(active_profile)
        cookies = profile_manager.get_cookies(active_profile)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    
    driver = PlaywrightDriver(
        headless=not headed, 
        user_data_dir=profile_path,
        user_agent=user_agent,
        cookies=cookies
    )
    progress_manager = ProgressManager(console)
    sheet_client = SheetClient(driver, url, progress_manager)
    packager = Packager()
    service = PublishService(sheet_client, packager, progress_manager=progress_manager)
    
    try:
        if dry_run:
            result = asyncio.run(service.publish_dry_run())
            console.print("[yellow]Dry run - no PR created[/yellow]")
            console.print(Panel.fit(
                f"[bold]Package Details[/bold]\n"
                f"Name: {result['name']}\n"
                f"Version: {result['version']}\n"
                f"Functions: {', '.join(result['functions'])}\n"
                f"Would create PR to: {result['registry_url']}",
                border_style="blue"
            ))
        else:
            pr_url = asyncio.run(service.publish())
            console.print(Panel.fit(
                f"[bold green]Package Published![/bold green]\n"
                f"Pull Request: {pr_url}\n"
                f"Your package will be available after PR is merged.",
                border_style="green"
            ))
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)

@app.command(name="self-update")
def self_update():
    """update Formulary to the latest version."""
    service = SelfManagementService()
    
    try:
        service.self_update()
    except RuntimeError as e:
        console.print(f"[yellow]{e}[/yellow]")
        raise typer.Exit(code=1)
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1)
    except Exception as e:
        console.print(f"[red]Error updating Formulary:[/red] {e}")
        raise typer.Exit(code=1)

@app.command(name="self-uninstall")
def self_uninstall():
    """uninstall Formulary from your system."""
    from rich.prompt import Confirm
    
    # extra confirmation for destructive operation
    if not Confirm.ask("[yellow]Are you sure you want to uninstall Formulary?[/yellow]"):
        console.print("[dim]Uninstall cancelled.[/dim]")
        return
    
    service = SelfManagementService()
    
    try:
        service.self_uninstall()
    except RuntimeError as e:
        console.print(f"[yellow]{e}[/yellow]")
        raise typer.Exit(code=1)
    except FileNotFoundError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(code=1)
    except Exception as e:
        console.print(f"[red]Error uninstalling Formulary:[/red] {e}")
        raise typer.Exit(code=1)

if __name__ == "__main__":
    app()
