from pathlib import Path
from typing import Optional

CONFIG_DIR = Path.home() / ".formulary"
CONFIG_FILE = CONFIG_DIR / "config"

def get_sheet_url() -> Optional[str]:
    """get the configured sheet URL from config file."""
    if not CONFIG_FILE.exists():
        return None
    
    try:
        with open(CONFIG_FILE, "r") as f:
            for line in f:
                if line.startswith("FORMULARY_SHEET_URL="):
                    return line.strip().split("=", 1)[1]
    except (IOError, PermissionError, OSError):
        # if we can't read the file, treat as not configured
        return None
    return None

def set_sheet_url(url: str):
    """set the sheet URL in config file, preserving other config values."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    
    # read existing config
    config = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line:
                        key, value = line.split("=", 1)
                        config[key] = value
        except (IOError, PermissionError, OSError):
            # if we can't read existing config, start fresh
            pass
    
    # update URL
    config["FORMULARY_SHEET_URL"] = url
    
    # write back
    try:
        with open(CONFIG_FILE, "w") as f:
            for key, value in config.items():
                f.write(f"{key}={value}\n")
    except (IOError, PermissionError, OSError) as e:
        raise RuntimeError(f"failed to write config file: {e}") from e
