"""test suite for packager."""
import pytest
from pathlib import Path
import tempfile
import shutil
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from formulary.bundling.packager import Packager
from formulary.domain.models import Function, Lockfile, PackageLock


class TestPackager:
    @pytest.fixture
    def temp_dir(self):
        """create a temporary directory."""
        temp_dir = Path(tempfile.mkdtemp())
        yield temp_dir
        # cleanup
        if temp_dir.exists():
            shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def packager(self):
        """create a Packager instance."""
        return Packager()
    
    @pytest.fixture
    def sample_metadata(self):
        return {
            "name": "test-package",
            "version": "1.0.0",
            "description": "Test package"
        }
    
    @pytest.fixture
    def sample_lockfile(self):
        lockfile = Lockfile()
        lockfile.packages["test-pkg"] = PackageLock(
            version="1.0.0",
            functions=["func1", "func2"]
        )
        return lockfile
    
    @pytest.fixture
    def sample_functions(self):
        return {
            "func1": Function(
                name="func1",
                definition="=A1+B1",
                description="Add two cells",
                arguments=[]
            ),
            "func2": Function(
                name="func2",
                definition="=arg1*arg2",
                description="Multiply arguments",
                arguments=["arg1", "arg2"]
            )
        }
    
    def test_create_and_extract_package(
        self, packager, temp_dir, sample_metadata, sample_lockfile, sample_functions
    ):
        # create package
        package_path = temp_dir / "test-package.gspkg"
        packager.create_package(package_path, sample_metadata, sample_functions, sample_lockfile)
        
        assert package_path.exists()
        
        # extract package
        metadata, lockfile, functions, integrity = packager.extract_package(package_path)
        
        # verify metadata
        assert metadata["name"] == "test-package"
        assert metadata["version"] == "1.0.0"
        
        # verify lockfile - should have the package
        assert "test-pkg" in lockfile.packages
        assert lockfile.packages["test-pkg"].version == "1.0.0"
        
        # verify functions
        assert len(functions) == 2
        assert "func1" in functions
        assert functions["func1"].definition == "=A1+B1"
        assert functions["func2"].arguments == ["arg1", "arg2"]
    
    def test_extract_package_with_dict_arguments(self, packager, temp_dir):
        """test that dict-style arguments are converted to list."""
        import zipfile
        import json
        
        package_path = temp_dir / "legacy-package.gspkg"
        
        # create a package with dict-style arguments
        with zipfile.ZipFile(package_path, 'w') as zf:
            zf.writestr('__GSPROJECT__.json', json.dumps({"name": "test", "version": "1.0.0"}))
            zf.writestr('__LOCK__.json', json.dumps({"packages": {}}))
            
            # Legacy format with dict arguments
            functions_data = {
                "legacy_func": {
                    "definition": "=arg1+arg2",
                    "description": "Legacy function",
                    "arguments": {
                        "arg1": {"description": "First arg", "example": "1"},
                        "arg2": {"description": "Second arg", "example": "2"}
                    }
                }
            }
            zf.writestr('functions.json', json.dumps(functions_data))
        
        # extract and verify
        metadata, lockfile, functions, integrity = packager.extract_package(package_path)
        
        assert "legacy_func" in functions
        # dict keys should be converted to list
        assert isinstance(functions["legacy_func"].arguments, list)
        assert set(functions["legacy_func"].arguments) == {"arg1", "arg2"}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
