"""data models for profile management."""
from typing import Dict, Optional
from datetime import datetime
from pydantic import BaseModel


class ProfileInfo(BaseModel):
    """information about a single profile."""
    alias: str
    path: str  # relative path to profile directory
    email: str
    user_agent: Optional[str] = None
    cookies: Optional[list] = None
    created: str  # ISO format datetime
    last_used: str  # ISO format datetime


class ProfileData(BaseModel):
    """complete profile configuration."""
    active: Optional[str] = None
    profiles: Dict[str, ProfileInfo] = {}
    
    @classmethod
    def empty(cls) -> "ProfileData":
        """create empty profile data."""
        return cls(active=None, profiles={})
