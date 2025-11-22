import typer
from rich.console import Console
from rich.table import Table
from pathlib import Path

from ..config import CONFIG_DIR
from ..profiles import ProfileManager, ProfileError, AuthenticationError

app = typer.Typer()
console = Console()


def get_profile_manager() -> ProfileManager:
    """get profile manager instance."""
    return ProfileManager(CONFIG_DIR)


@app.command("add")
def add_profile(alias: str):
    """
    create a new profile with Google authentication.
    
    this will open a browser window for you to sign in with Google.
    the authentication will be saved for future use.
    """
    manager = get_profile_manager()
    
    try:
        manager.create_profile(alias)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except AuthenticationError as e:
        console.print(f"[red]Authentication failed:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Unexpected error:[/red] {e}")
        raise typer.Exit(1)


@app.command("remove")
def remove_profile(
    alias: str,
    force: bool = typer.Option(False, "--force", "-f", help="Remove even if it's the only/active profile")
):
    """remove a profile."""
    manager = get_profile_manager()
    
    try:
        manager.remove_profile(alias, force=force)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("list")
def list_profiles():
    """list all profiles."""
    manager = get_profile_manager()
    
    profiles = manager.list_profiles()
    active = manager.get_active_profile()
    
    if not profiles:
        console.print("[yellow]No profiles found.[/yellow]")
        console.print("\nCreate one with: [cyan]formulary profile add <alias>[/cyan]")
        return
    
    # create table
    table = Table(title="Profiles")
    table.add_column("Alias", style="cyan")
    table.add_column("Email", style="white")
    table.add_column("Created", style="dim")
    table.add_column("Status", style="green")
    
    for profile in profiles:
        status = "active" if profile.alias == active else ""
        created = profile.created.split('T')[0]  # just the date
        table.add_row(profile.alias, profile.email, created, status)
    
    console.print(table)


@app.command("switch")
def switch_profile(alias: str):
    """switch to a different profile."""
    manager = get_profile_manager()
    
    try:
        manager.switch_profile(alias)
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


@app.command("show")
def show_active():
    """show active profile details."""
    manager = get_profile_manager()
    
    try:
        active = manager.ensure_active_profile()
        profiles = manager.list_profiles()
        
        # find the active profile
        profile = next(p for p in profiles if p.alias == active)
        
        console.print(f"\n[bold]Active Profile:[/bold] [cyan]{profile.alias}[/cyan]")
        console.print(f"  Email:      {profile.email}")
        console.print(f"  Created:    {profile.created}")
        console.print(f"  Last used:  {profile.last_used}\n")
        
    except ProfileError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
