import hashlib
import json

def hash_function_object(func: dict) -> str:
    """
    returns a short sha256 hash of the function object.
    """
    if not isinstance(func, dict):
        raise TypeError(f"expected dict, got {type(func).__name__}")
    
    data = {
        "description": func.get("description", ""),
        "definition": func.get("definition", ""),
        "arguments": func.get("arguments", []),
    }
    digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    return digest[:12]  # truncate for readability
