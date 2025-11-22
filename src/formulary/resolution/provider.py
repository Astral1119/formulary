from resolvelib import AbstractProvider, BaseReporter
from typing import List, Any
from ..domain.models import Dependency, Package
from ..registry.client import RegistryClient
from packaging.version import Version

class FormularyProvider(AbstractProvider, BaseReporter):
    def __init__(self, registry: RegistryClient):
        self.registry = registry

    def identify(self, requirement_or_candidate: Any) -> str:
        if isinstance(requirement_or_candidate, Dependency):
            return requirement_or_candidate.name
        if isinstance(requirement_or_candidate, Package):
            return requirement_or_candidate.name
        raise ValueError(f"Unknown type: {type(requirement_or_candidate)}")

    def get_preference(self, identifier: str, resolutions: dict, candidates: dict, information: dict, backtrack_causes: list) -> Any:
        return sum(1 for _ in candidates[identifier])

    def find_matches(self, identifier: str, requirements: dict, incompatibilities: dict) -> List[Package]:
        versions = self.registry.get_versions(identifier)
        candidates = []
        for v in versions:
            candidates.append(Package(name=identifier, version=v))
        
        # filter candidates based on requirements
        valid_candidates = []
        for candidate in candidates:
            is_valid = True
            for requirement in requirements.get(identifier, []):
                if not self.is_satisfied_by(requirement, candidate):
                    is_valid = False
                    break
            if is_valid:
                valid_candidates.append(candidate)
        
        # sort by version descending
        return sorted(valid_candidates, key=lambda c: c.parsed_version, reverse=True)

    def is_satisfied_by(self, requirement: Dependency, candidate: Package) -> bool:
        if requirement.name != candidate.name:
            return False
        return candidate.parsed_version in requirement.specifier_set

    def get_dependencies(self, candidate: Package) -> List[Dependency]:
        # always fetch full metadata to get dependencies
        metadata = self.registry.get_package_metadata(candidate.name, candidate.version)
        # update candidate with real dependencies
        candidate.dependencies = metadata.get("dependencies", [])
        candidate.description = metadata.get("description")
        
        return candidate.parsed_dependencies
