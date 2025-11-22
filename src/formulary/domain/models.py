from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from packaging.version import Version
from packaging.specifiers import SpecifierSet

class Dependency(BaseModel):
    name: str
    specifier: str = ""

    @property
    def specifier_set(self) -> SpecifierSet:
        return SpecifierSet(self.specifier)

class Package(BaseModel):
    """represents a package manifest (from __gsproject__)."""
    name: str
    version: str
    dependencies: List[str] = Field(default_factory=list)
    description: str = ""
    author: Optional[str] = None
    license: str = "MIT"
    homepage: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)
    
    @property
    def parsed_version(self) -> Version:
        return Version(self.version)

    @property
    def parsed_dependencies(self) -> List[Dependency]:
        deps = []
        for d in self.dependencies:
            # simple parsing logic, can be improved
            import re
            match = re.match(r"^([A-Za-z0-9_\-]+)(.*)$", d)
            if match:
                name, spec = match.groups()
                deps.append(Dependency(name=name, specifier=spec.strip() or ""))
            else:
                deps.append(Dependency(name=d))
        return deps

class ArgumentMetadata(BaseModel):
    """metadata for a function argument."""
    description: str = "No description provided."
    example: str = "No example provided."

class Function(BaseModel):
    name: str
    definition: str
    description: Optional[str] = None
    arguments: List[str] = Field(default_factory=list)  # just argument names
    argument_metadata: Dict[str, ArgumentMetadata] = Field(default_factory=dict)  # name -> metadata
    hash: Optional[str] = None

class PackageLock(BaseModel):
    version: str
    resolved: Optional[str] = None # url or path
    integrity: Optional[str] = None # hash
    dependencies: List[str] = Field(default_factory=list)
    functions: List[str] = Field(default_factory=list) # cache of provided functions

class Lockfile(BaseModel):
    packages: Dict[str, PackageLock] = Field(default_factory=dict)

