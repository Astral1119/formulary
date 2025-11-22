import json
from pathlib import Path
from typing import Optional
from .models import ProfileData, ProfileInfo


class ProfileStore:
    """handles profile persistence to JSON."""
    
    def __init__(self, profiles_file: Path):
        self.profiles_file = profiles_file
        
    def load(self) -> ProfileData:
        """load profiles from JSON file."""
        if not self.profiles_file.exists():
            return ProfileData.empty()
        
        try:
            with open(self.profiles_file, 'r') as f:
                data = json.load(f)
            return ProfileData(**data)
        except (json.JSONDecodeError, ValueError) as e:
            # corrupted file, return empty
            return ProfileData.empty()
    
    def save(self, data: ProfileData) -> None:
        """save profiles to JSON file."""
        # ensure parent directory exists
        self.profiles_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(self.profiles_file, 'w') as f:
            json.dump(data.model_dump(), f, indent=2)
    
    def add_profile(self, profile: ProfileInfo) -> None:
        """add new profile to store."""
        data = self.load()
        data.profiles[profile.alias] = profile
        
        # if this is the first profile, make it active
        if not data.active:
            data.active = profile.alias
        
        self.save(data)
    
    def remove_profile(self, alias: str) -> None:
        """remove profile from store."""
        data = self.load()
        
        if alias in data.profiles:
            del data.profiles[alias]
            
            # if this was the active profile, clear it
            if data.active == alias:
                # try to switch to another profile
                if data.profiles:
                    data.active = list(data.profiles.keys())[0]
                else:
                    data.active = None
            
            self.save(data)
    
    def set_active(self, alias: str) -> None:
        """set active profile."""
        data = self.load()
        
        if alias not in data.profiles:
            raise ValueError(f"Profile '{alias}' does not exist")
        
        data.active = alias
        self.save(data)
    
    def get_active(self) -> Optional[str]:
        """get active profile alias."""
        data = self.load()
        return data.active
    
    def update_last_used(self, alias: str) -> None:
        """update last_used timestamp for profile."""
        data = self.load()
        
        if alias in data.profiles:
            from datetime import datetime
            data.profiles[alias].last_used = datetime.now().isoformat()
            self.save(data)
