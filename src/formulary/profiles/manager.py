import shutil
from pathlib import Path
from typing import List, Optional
from datetime import datetime
from rich.console import Console

from .store import ProfileStore, ProfileInfo
from .auth import authenticate_profile, AuthenticationError
from .models import ProfileData

console = Console()


class ProfileError(Exception):
    """raised when profile operations fail."""
    pass


class ProfileManager:
    """manages user profiles for Google authentication."""
    
    def __init__(self, config_dir: Path):
        self.config_dir = config_dir
        self.profiles_file = config_dir / "profiles.json"
        self.profiles_dir = config_dir / "profiles"
        self.store = ProfileStore(self.profiles_file)
    
    def create_profile(self, alias: str) -> ProfileInfo:
        """
        create new profile with immediate authentication.
        
        args:
            alias: name for the profile
            
        returns:
            created profile info
            
        raises:
            ProfileError: if alias already exists or invalid
            AuthenticationError: if Google auth fails
        """
        # validate alias
        if not alias or not alias.strip():
            raise ProfileError("Profile alias cannot be empty")
        
        # check for restricted characters
        import re
        if not re.match(r'^[a-z0-9_-]+$', alias):
            raise ProfileError(
                f"Invalid alias '{alias}'. "
                "Use only lowercase letters, numbers, hyphens, and underscores."
            )
        
        # check reserved names
        if alias in ['default', 'temp', 'tmp']:
            console.print(f"[yellow]Warning:[/yellow] '{alias}' is a reserved name")
        
        # check if alias already exists
        data = self.store.load()
        if alias in data.profiles:
            raise ProfileError(f"Profile '{alias}' already exists")
        
        # create profile directory
        profile_path = self.profiles_dir / alias
        profile_path.mkdir(parents=True, exist_ok=True)
        
        try:
            # authenticate with Google (opens browser)
            import asyncio
            email, user_agent, cookies = asyncio.run(authenticate_profile(profile_path))
            
            # create profile info
            now = datetime.now().isoformat()
            profile = ProfileInfo(
                alias=alias,
                path=f"profiles/{alias}",
                email=email,
                user_agent=user_agent,
                cookies=cookies,
                created=now,
                last_used=now
            )
            
            # save to store
            self.store.add_profile(profile)
            
            console.print(f"[green]✓[/green] Profile '{alias}' created and activated")
            
            return profile
            
        except AuthenticationError as e:
            # cleanup profile directory if auth failed
            if profile_path.exists():
                shutil.rmtree(profile_path)
            raise
        except Exception as e:
            # cleanup on any error
            if profile_path.exists():
                shutil.rmtree(profile_path)
            raise ProfileError(f"Failed to create profile: {e}")
    
    def remove_profile(self, alias: str, force: bool = False) -> None:
        """
        remove profile.
        
        args:
            alias: profile to remove
            force: if True, remove even if it's the active profile
            
        raises:
            ProfileError: if profile not found or is active without force
        """
        data = self.store.load()
        
        if alias not in data.profiles:
            raise ProfileError(f"Profile '{alias}' not found")
        
        # check if it's the active profile
        if alias == data.active:
            other_profiles = [p for p in data.profiles if p != alias]
            
            if other_profiles and not force:
                # auto-switch to another profile
                new_active = other_profiles[0]
                console.print(
                    f"[yellow]Note:[/yellow] '{alias}' is active. "
                    f"Switching to '{new_active}'"
                )
                self.store.set_active(new_active)
            elif not force:
                # last profile - require force
                raise ProfileError(
                    f"'{alias}' is the only profile. "
                    "Use --force to remove anyway (you'll need to create a new profile to continue)."
                )
        
        # remove profile directory
        profile_path = self.config_dir / data.profiles[alias].path
        if profile_path.exists():
            shutil.rmtree(profile_path)
        
        # remove from store
        self.store.remove_profile(alias)
        
        console.print(f"[green]✓[/green] Profile '{alias}' removed")
    
    def list_profiles(self) -> List[ProfileInfo]:
        """list all profiles."""
        data = self.store.load()
        return list(data.profiles.values())
    
    def get_active_profile(self) -> Optional[str]:
        """get active profile alias, returns None if no profiles exist."""
        return self.store.get_active()
    
    def switch_profile(self, alias: str) -> None:
        """
        switch active profile.
        
        raises:
            ProfileError: if profile not found
        """
        data = self.store.load()
        
        if alias not in data.profiles:
            available = ", ".join(data.profiles.keys())
            raise ProfileError(
                f"Profile '{alias}' not found.\n"
                f"Available profiles: {available}"
            )
        
        self.store.set_active(alias)
        console.print(f"[green]✓[/green] Switched to profile '{alias}'")
    
    def get_profile_path(self, alias: str, headless: bool = False) -> Path:
        """
        get Playwright profile path for alias.
        
        args:
            alias: profile alias
            headless: if True, return a separate path for headless execution
                     to avoid Keychain locking issues on macOS.
        """
        data = self.store.load()
        
        if alias not in data.profiles:
            raise ProfileError(f"Profile '{alias}' not found")
        
        path = self.config_dir / data.profiles[alias].path
        
        if headless:
            # use a separate directory for headless execution
            # this avoids "headless_shell wants to use your confidential information"
            # prompts on macOS because we won't touch the headed profile's Keychain-encrypted data.
            # we will inject cookies into this clean profile instead.
            return path.parent / f"{path.name}_headless"
            
        return path

    def get_user_agent(self, alias: str) -> Optional[str]:
        """get User-Agent string for alias."""
        data = self.store.load()
        
        if alias not in data.profiles:
            raise ProfileError(f"Profile '{alias}' not found")
        
        return data.profiles[alias].user_agent
    
    def get_cookies(self, alias: str) -> Optional[List]:
        """get cookies for alias."""
        data = self.store.load()
        
        if alias not in data.profiles:
            raise ProfileError(f"Profile '{alias}' not found")
        
        return data.profiles[alias].cookies

    def ensure_active_profile(self) -> str:
        """
        ensure active profile exists.
        
        returns:
            active profile alias
            
        raises:
            ProfileError: with helpful message if no active profile
        """
        data = self.store.load()
        
        if not data.profiles:
            raise ProfileError(
                "No profiles exist. Create one with:\n"
                "  formulary profile add <alias>"
            )
        
        if not data.active:
            raise ProfileError(
                "No active profile. Switch to one with:\n"
                "  formulary profile switch <alias>"
            )
        
        if data.active not in data.profiles:
            available = ", ".join(data.profiles.keys())
            raise ProfileError(
                f"Active profile '{data.active}' not found.\n"
                f"Available profiles: {available}"
            )
        
        # update last_used timestamp
        self.store.update_last_used(data.active)
        
        return data.active
