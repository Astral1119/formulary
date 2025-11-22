import json
import zipfile
from pathlib import Path
from typing import Dict, Tuple
from ..domain.models import Function

class Packager:
    def create_package(self, output_path: Path, metadata: dict, functions: Dict[str, Function], lockfile=None):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # write metadata
            zf.writestr('__GSPROJECT__.json', json.dumps(metadata, indent=2))
            
            # write lockfile if provided
            if lockfile:
                from ..domain.models import Lockfile
                if isinstance(lockfile, Lockfile):
                    zf.writestr('__LOCK__.json', lockfile.model_dump_json(indent=2))
                else:
                    # assume it's already a dict
                    zf.writestr('__LOCK__.json', json.dumps(lockfile, indent=2))
            
            # write functions with full argument metadata
            funcs_dict = {}
            for name, f in functions.items():
                # build arguments dict with metadata
                args_dict = {}
                for arg_name in f.arguments:
                    if arg_name in f.argument_metadata:
                        meta = f.argument_metadata[arg_name]
                        args_dict[arg_name] = {
                            "description": meta.description,
                            "example": meta.example
                        }
                    else:
                        # fallback for missing metadata
                        args_dict[arg_name] = {
                            "description": "No description provided.",
                            "example": "No example provided."
                        }
                
                funcs_dict[name] = {
                    "definition": f.definition,
                    "description": f.description,
                    "arguments": args_dict  # now a dict, not a list
                }
            
            zf.writestr('functions.json', json.dumps(funcs_dict, indent=2))

    def extract_package(self, package_path: Path) -> Tuple[dict, 'Lockfile', Dict[str, Function], str]:
        # calculate integrity hash of the package file
        import hashlib
        with open(package_path, "rb") as f:
            file_hash = hashlib.sha256(f.read()).hexdigest()
        integrity = f"sha256:{file_hash}"

        with zipfile.ZipFile(package_path, 'r') as zf:
            metadata = json.loads(zf.read('__GSPROJECT__.json'))
            
            funcs_data = json.loads(zf.read('functions.json'))
            functions = {}
            for name, data in funcs_data.items():
                from ..domain.models import ArgumentMetadata
                
                args_data = data.get("arguments", [])
                arg_names = []
                arg_metadata = {}
                
                if isinstance(args_data, dict):
                    # dict format: {arg_name: {description, example}}
                    arg_names = list(args_data.keys())
                    for arg_name, meta in args_data.items():
                        arg_metadata[arg_name] = ArgumentMetadata(
                            description=meta.get("description", "No description provided."),
                            example=meta.get("example", "No example provided.")
                        )
                else:
                    # list format: just argument names
                    arg_names = args_data
                
                functions[name] = Function(
                    name=name,
                    definition=data["definition"],
                    description=data.get("description"),
                    arguments=arg_names,
                    argument_metadata=arg_metadata
                )
            
            # extract lockfile if exists
            from ..domain.models import Lockfile
            lockfile = Lockfile()
            if '__LOCK__.json' in zf.namelist():
                lockfile = Lockfile(**json.loads(zf.read('__LOCK__.json')))
            
            return metadata, lockfile, functions, integrity
