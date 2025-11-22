"""test suite for dependency resolution."""
import pytest
import sys
from pathlib import Path
from unittest.mock import Mock, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.resolution.provider import FormularyProvider
from formulary.resolution.resolver import Resolver
from formulary.domain.models import Dependency, Package
from formulary.registry.client import RegistryClient


class MockRegistryClient(RegistryClient):
    """mock registry client for testing."""
    
    def __init__(self):
        self.packages = {
            "pkg-a": {
                "1.0.0": Package(name="pkg-a", version="1.0.0", dependencies=[]),
                "2.0.0": Package(name="pkg-a", version="2.0.0", dependencies=[]),
            },
            "pkg-b": {
                "1.0.0": Package(name="pkg-b", version="1.0.0", dependencies=["pkg-a>=1.0.0"]),
                "2.0.0": Package(name="pkg-b", version="2.0.0", dependencies=["pkg-a>=2.0.0"]),
            },
            "pkg-c": {
                "1.0.0": Package(name="pkg-c", version="1.0.0", dependencies=["pkg-a", "pkg-b"]),
            }
        }
    
    def get_versions(self, package_name: str):
        if package_name in self.packages:
            return list(self.packages[package_name].keys())
        return []
    
    def get_package_metadata(self, package_name: str, version: str):
        if package_name in self.packages and version in self.packages[package_name]:
            return self.packages[package_name][version].model_dump()
        raise ValueError(f"Package {package_name}@{version} not found")
    
    def download_package(self, package_name: str, version: str, target_path):
        pass


class TestFormularyProvider:
    @pytest.fixture
    def mock_registry(self):
        return MockRegistryClient()
    
    @pytest.fixture
    def provider(self, mock_registry):
        return FormularyProvider(mock_registry)
    
    def test_identify(self, provider):
        dep = Dependency(name="test-pkg", specifier=">=1.0.0")
        identifier = provider.identify(dep)
        assert identifier == "test-pkg"
    
    def test_get_preference(self, provider):
        candidates = {
            "pkg-a": [
                Package(name="pkg-a", version="1.0.0"),
                Package(name="pkg-a", version="2.0.0"),
            ]
        }
        
        # should return count of candidates
        pref = provider.get_preference("pkg-a", {}, candidates, {}, [])
        assert pref == 2
    
    def test_find_matches(self, provider, mock_registry):
        dep = Dependency(name="pkg-a", specifier=">=1.0.0")
        # requirements dict maps identifier to list of requirements
        requirements = {"pkg-a": [dep]}
        matches = provider.find_matches("pkg-a", requirements, {})
        
        # should return all matching versions
        assert len(matches) == 2
        versions = {m.version for m in matches}
        assert versions == {"1.0.0", "2.0.0"}
    
    def test_find_matches_with_specifier(self, provider, mock_registry):
        dep = Dependency(name="pkg-a", specifier=">=2.0.0")
        requirements = {"pkg-a": [dep]}
        matches = provider.find_matches("pkg-a", requirements, {})
        
        # should only return versions >= 2.0.0
        assert len(matches) == 1
        assert matches[0].version == "2.0.0"
    
    def test_get_dependencies(self, provider, mock_registry):
        pkg = Package(name="pkg-b", version="1.0.0", dependencies=["pkg-a>=1.0.0"])
        deps = provider.get_dependencies(pkg)
        
        assert len(deps) == 1
        assert deps[0].name == "pkg-a"
        assert deps[0].specifier == ">=1.0.0"
    
    def test_is_satisfied_by(self, provider):
        dep = Dependency(name="pkg-a", specifier=">=1.0.0")
        pkg = Package(name="pkg-a", version="2.0.0")
        
        assert provider.is_satisfied_by(dep, pkg)
    
    def test_is_satisfied_by_false(self, provider):
        dep = Dependency(name="pkg-a", specifier=">=2.0.0")
        pkg = Package(name="pkg-a", version="1.0.0")
        
        assert not provider.is_satisfied_by(dep, pkg)


class TestResolver:
    @pytest.fixture
    def mock_registry(self):
        return MockRegistryClient()
    
    @pytest.fixture
    def resolver(self, mock_registry):
        return Resolver(mock_registry)
    
    def test_resolve_simple(self, resolver):
        requirements = [Dependency(name="pkg-a", specifier=">=1.0.0")]
        result = resolver.resolve(requirements)
        
        assert len(result) == 1
        assert result[0].name == "pkg-a"
        # Should resolve to latest version
        assert result[0].version == "2.0.0"
    
    def test_resolve_with_dependencies(self, resolver):
        requirements = [Dependency(name="pkg-b", specifier=">=1.0.0")]
        result = resolver.resolve(requirements)
        
        # should resolve pkg-b and its dependency pkg-a
        assert len(result) == 2
        names = {pkg.name for pkg in result}
        assert names == {"pkg-a", "pkg-b"}
    
    def test_resolve_conflict(self, resolver):
        # pkg-b 2.0.0 requires pkg-a >= 2.0.0
        # pkg-b 1.0.0 requires pkg-a >= 1.0.0
        requirements = [Dependency(name="pkg-b", specifier=">=2.0.0")]
        result = resolver.resolve(requirements)
        
        pkg_b = next(p for p in result if p.name == "pkg-b")
        pkg_a = next(p for p in result if p.name == "pkg-a")
        
        assert pkg_b.version == "2.0.0"
        assert pkg_a.version == "2.0.0"
    
    def test_resolve_nonexistent_package(self, resolver):
        requirements = [Dependency(name="nonexistent-pkg")]
        
        with pytest.raises(ValueError) as exc_info:
            resolver.resolve(requirements)
        
        assert "Could not find a version" in str(exc_info.value)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
