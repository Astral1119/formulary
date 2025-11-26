import json
import csv
import io
import sys
from typing import Optional, List, Dict, Any
from .client import SheetClient
from ..domain.models import Function, Lockfile, PackageLock

class MetadataManager:
    def __init__(self, client: SheetClient):
        self.client = client

    def _parse_array_literal(self, definition: str) -> List[List[str]]:
        """Parse a Google Sheets array literal string into a list of rows."""
        # strip whitespace (Google Sheets may add newlines)
        definition = definition.strip()
        
        # strip the wrapper: ={...} or ="..." (legacy)
        if not definition.startswith("={") or not definition.endswith("}"):
            return []
        
        content = definition[2:-1]  # remove ={ and }
        
        rows = []
        current_row = []
        current_token = []
        in_quote = False
        i = 0
        
        while i < len(content):
            char = content[i]
            
            if char == '"' and not in_quote:
                # starting a quoted string
                in_quote = True
            elif char == '"' and in_quote:
                # could be: end of quote, or escaped quote ""
                if i + 1 < len(content) and content[i+1] == '"':
                    # escaped quote: "" inside a quoted string
                    current_token.append('"')
                    i += 1  # skip the next quote
                else:
                    # end of quoted string
                    in_quote = False
            elif char == ',' and not in_quote:
                # column separator (only outside quotes)
                current_row.append("".join(current_token))
                current_token = []
            elif char == ';' and not in_quote:
                # row separator (only outside quotes)
                current_row.append("".join(current_token))
                rows.append(current_row)
                current_row = []
                current_token = []
            elif in_quote:
                # regular character inside quotes
                current_token.append(char)
            # ignore characters outside quotes (spaces between fields)
            
            i += 1
            
        # append last token/row
        if current_token or current_row:
            current_row.append("".join(current_token))
            rows.append(current_row)
            
        return rows

    def _format_array_literal(self, rows: List[List[str]]) -> str:
        """Format a list of rows into a Google Sheets array literal string."""
        formatted_rows = []
        for row in rows:
            formatted_cols = []
            for col in row:
                # escape quotes: " -> ""
                escaped = col.replace('"', '""')
                formatted_cols.append(f'"{escaped}"')
            formatted_rows.append(",".join(formatted_cols))
        
        return "={" + ";".join(formatted_rows) + "}"

    def _parse_project_metadata(self, funcs: Dict[str, Function]) -> dict:
        """parse project metadata from named functions dict."""
        if "__GSPROJECT__" not in funcs:
            return {}
        
        definition = funcs["__GSPROJECT__"].definition
        
        # handle legacy JSON format
        if definition.startswith('="') or definition.startswith('{'):
            try:
                if definition.startswith('="'):
                    json_str = definition[2:-1].replace('""""', '"')
                    return json.loads(json_str)
                return json.loads(definition)
            except json.JSONDecodeError as e:
                pass

        # parse array literal
        rows = self._parse_array_literal(definition)

        if not rows or len(rows) < 2:  # need at least header and one row
            return {}
            
        # skip header row
        data = {}
        for i, row in enumerate(rows[1:]):
            if len(row) >= 2:
                key = row[0]
                val = row[1]
                if key == "dependencies":
                    # parse comma-separated dependencies
                    if val:
                        data["dependencies"] = [d.strip() for d in val.split(",") if d.strip()]
                    else:
                        data["dependencies"] = []
                else:
                    data[key] = val

        return data

    async def get_project_metadata(self) -> dict:
        """Get project metadata from sheet."""
        funcs = await self.client.get_named_functions()
        return self._parse_project_metadata(funcs)

    async def set_project_metadata(self, metadata: dict):
        # convert to array literal format
        # header
        rows = [["Key", "Value"]]
        
        # standard fields - always include them
        for key in ["name", "version", "description"]:
            val = metadata.get(key, "")
            # don't escape empty strings - just use them as-is
            rows.append([key, val])
                
        # dependencies
        if "dependencies" in metadata and metadata["dependencies"]:
            deps_str = ",".join(metadata["dependencies"])
            rows.append(["dependencies", deps_str])
        else:
            # include empty dependencies field
            rows.append(["dependencies", ""])
            
        # other fields
        for key, val in metadata.items():
            if key not in ["name", "version", "description", "dependencies"]:
                rows.append([key, str(val)])
                
        definition = self._format_array_literal(rows)
        
        func = Function(
            name="__GSPROJECT__",
            definition=definition,
            description="Project Metadata"
        )
        # use update to avoid breaking references
        await self.client.update_function(func)

    def _parse_lockfile(self, funcs: Dict[str, Function]) -> Optional[Lockfile]:
        """Parse lockfile from named functions dict."""
        if "__LOCK__" not in funcs:
            return None
        
        definition = funcs["__LOCK__"].definition
        
        # parse array literal
        rows = self._parse_array_literal(definition)
        if not rows:
            return None
            
        lockfile = Lockfile()
        # skip header row
        # expected columns: Package, Version, Resolved, Integrity, Dependencies, Functions
        for row in rows[1:]:
            if len(row) >= 2:
                pkg_name = row[0]
                version = row[1]
                
                # optional fields with defaults
                resolved = row[2] if len(row) > 2 else None
                integrity = row[3] if len(row) > 3 else None
                deps_str = row[4] if len(row) > 4 else ""
                funcs_str = row[5] if len(row) > 5 else ""
                
                dependencies = [d.strip() for d in deps_str.split(",") if d.strip()]
                functions = [f.strip() for f in funcs_str.split(",") if f.strip()]
                
                lockfile.packages[pkg_name] = PackageLock(
                    version=version,
                    resolved=resolved,
                    integrity=integrity,
                    dependencies=dependencies,
                    functions=functions
                )
                
        return lockfile

    async def get_lockfile(self) -> Optional[Lockfile]:
        """Get lockfile from sheet."""
        funcs = await self.client.get_named_functions()
        return self._parse_lockfile(funcs)

    async def get_all_metadata(self) -> tuple[dict, Optional[Lockfile]]:
        """Get both project metadata and lockfile in a single call.
        
        Returns:
            Tuple of (project_metadata, lockfile)
        """
        funcs = await self.client.get_named_functions()
        return (self._parse_project_metadata(funcs), self._parse_lockfile(funcs))

    async def set_lockfile(self, lockfile: Lockfile):
        # convert to array literal format
        # header
        rows = [["Package", "Version", "Resolved", "Integrity", "Dependencies", "Functions"]]
        
        for pkg_name, entry in lockfile.packages.items():
            deps_str = ",".join(entry.dependencies)
            funcs_str = ",".join(entry.functions)
            
            rows.append([
                pkg_name,
                entry.version,
                entry.resolved or "",
                entry.integrity or "",
                deps_str,
                funcs_str
            ])
            
        definition = self._format_array_literal(rows)
        
        func = Function(
            name="__LOCK__",
            definition=definition,
            description="Project Lockfile"
        )
        # use update to avoid breaking references
        await self.client.update_function(func)
