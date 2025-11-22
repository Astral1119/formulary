from resolvelib import Resolver as RLibResolver
from typing import List
from ..domain.models import Dependency, Package
from .provider import FormularyProvider
from ..registry.client import RegistryClient

class Resolver:
    def __init__(self, registry: RegistryClient):
        self.provider = FormularyProvider(registry)
        self.resolver = RLibResolver(self.provider, self.provider)

    def resolve(self, requirements: List[Dependency]) -> List[Package]:
        from resolvelib.resolvers import ResolutionImpossible
        try:
            result = self.resolver.resolve(requirements)
        except ResolutionImpossible as e:
            failed_reqs = []
            for cause in e.causes:
                failed_reqs.append(f"{cause.requirement.name} ({cause.requirement.specifier})")
            
            raise ValueError(f"Could not find a version that satisfies the requirements: {', '.join(failed_reqs)}")

        return list(result.mapping.values())
