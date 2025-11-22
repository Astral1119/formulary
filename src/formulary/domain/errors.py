from typing import List, Dict

class FormularyError(Exception):
    """base class for exceptions in Formulary."""
    pass

class CollisionError(FormularyError):
    """raised when function names collide during installation."""
    def __init__(self, package_name: str, conflicts: List[str]):
        self.package_name = package_name
        self.conflicts = conflicts
        super().__init__(f"Package '{package_name}' has conflicting functions: {', '.join(conflicts)}")
