"""test suite for domain models."""
import pytest
from packaging.version import Version
from packaging.specifiers import SpecifierSet
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.domain.models import Dependency, Package, Function, PackageLock, Lockfile


class TestDependency:
    def test_dependency_creation(self):
        dep = Dependency(name="test-package")
        assert dep.name == "test-package"
        assert dep.specifier == ""
    
    def test_dependency_with_specifier(self):
        dep = Dependency(name="test-package", specifier=">=1.0.0")
        assert dep.name == "test-package"
        assert dep.specifier == ">=1.0.0"
    
    def test_specifier_set_property(self):
        dep = Dependency(name="test-package", specifier=">=1.0.0,<2.0.0")
        spec_set = dep.specifier_set
        assert isinstance(spec_set, SpecifierSet)
        assert Version("1.5.0") in spec_set
        assert Version("2.5.0") not in spec_set
    
    def test_specifier_set_empty(self):
        dep = Dependency(name="test-package")
        spec_set = dep.specifier_set
        assert Version("0.0.1") in spec_set
        assert Version("999.999.999") in spec_set


class TestPackage:
    def test_package_creation(self):
        pkg = Package(name="test-pkg", version="1.0.0")
        assert pkg.name == "test-pkg"
        assert pkg.version == "1.0.0"
        assert pkg.description == ""  # default is empty string, not None
        assert pkg.dependencies == []
    
    def test_package_with_metadata(self):
        pkg = Package(
            name="test-pkg",
            version="1.0.0",
            description="A test package",
            dependencies=["dep1", "dep2>=1.0.0"]
        )
        assert pkg.description == "A test package"
        assert len(pkg.dependencies) == 2
    
    def test_parsed_version(self):
        pkg = Package(name="test-pkg", version="1.2.3")
        parsed = pkg.parsed_version
        assert isinstance(parsed, Version)
        assert str(parsed) == "1.2.3"
    
    def test_parsed_dependencies(self):
        pkg = Package(
            name="test-pkg",
            version="1.0.0",
            dependencies=["dep1", "dep2>=1.0.0", "dep3<2.0.0"]
        )
        parsed_deps = pkg.parsed_dependencies
        assert len(parsed_deps) == 3
        assert all(isinstance(d, Dependency) for d in parsed_deps)
        assert parsed_deps[0].name == "dep1"
        assert parsed_deps[0].specifier == ""
        assert parsed_deps[1].name == "dep2"
        assert parsed_deps[1].specifier == ">=1.0.0"


class TestFunction:
    def test_function_creation(self):
        func = Function(name="test_func", definition="=A1+B1")
        assert func.name == "test_func"
        assert func.definition == "=A1+B1"
        assert func.description is None
        assert func.arguments == []
        assert func.hash is None
    
    def test_function_with_arguments(self):
        func = Function(
            name="test_func",
            definition="=arg1+arg2",
            description="Test function",
            arguments=["arg1", "arg2"]
        )
        assert len(func.arguments) == 2
        assert func.arguments[0] == "arg1"


class TestLockfile:
    def test_lockfile_creation(self):
        lockfile = Lockfile()
        assert lockfile.packages == {}
    
    def test_add_package(self):
        lockfile = Lockfile()
        lockfile.packages["test-pkg"] = PackageLock(
            version="1.0.0",
            functions=["func1", "func2"]
        )
        assert "test-pkg" in lockfile.packages
        assert lockfile.packages["test-pkg"].version == "1.0.0"
        assert len(lockfile.packages["test-pkg"].functions) == 2
    
    def test_multiple_packages(self):
        lockfile = Lockfile()
        lockfile.packages["pkg1"] = PackageLock(version="1.0.0")
        lockfile.packages["pkg2"] = PackageLock(version="2.0.0")
        assert len(lockfile.packages) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
