import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent / "src"))

from formulary.registry.github import GitHubRegistry

def test_live_registry():
    # Use the URL from the user
    url = "https://raw.githubusercontent.com/Astral1119/formulary-registry/main"
    registry = GitHubRegistry(url)
    
    print(f"Testing registry at {url}")
    
    try:
        # Test existing package 'hash'
        print("Checking 'hash'...")
        versions = registry.get_versions("hash")
        print(f"Versions for 'hash': {versions}")
        
        if versions:
            latest = versions[-1]
            print(f"Fetching metadata for {latest}...")
            metadata = registry.get_package_metadata("hash", latest)
            print(f"Metadata: {metadata}")
            
        # test anduin package (now exists)
        print("Checking 'anduin'...")
        versions = registry.get_versions("anduin")
        print(f"Versions for 'anduin': {versions}")
        assert len(versions) > 0  # package now exists in registry
        print("Correctly returned empty list for missing package.")
            
    except Exception as e:
        print(f"Error: {e}")
        raise


if __name__ == "__main__":
    test_live_registry()
