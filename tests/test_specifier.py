from packaging.specifiers import SpecifierSet
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent / "src"))
from formulary.domain.models import Dependency

try:
    s = SpecifierSet("")
    print(f"SpecifierSet('') is valid: {s}")
except Exception as e:
    print(f"SpecifierSet('') failed: {e}")

try:
    d = Dependency(name="test")
    print(f"Default Dependency specifier: '{d.specifier}'")
    print(f"Default Dependency specifier_set: {d.specifier_set}")
    
    d2 = Dependency(name="test", specifier="")
    print(f"Explicit empty Dependency specifier_set: {d2.specifier_set}")
    
except Exception as e:
    print(f"Dependency model failed: {e}")

