import subprocess
import json
from typing import Optional, Dict
from pathlib import Path


class GitHubClient:
    """handles GitHub operations for registry publishing."""
    
    def __init__(self, repo_owner: str = "Astral1119", repo_name: str = "formulary-registry"):
        self.repo_owner = repo_owner
        self.repo_name = repo_name
        self.repo_full_name = f"{repo_owner}/{repo_name}"
    
    def check_gh_cli(self) -> bool:
        """check if GitHub CLI is available and authenticated."""
        try:
            result = subprocess.run(
                ["gh", "auth", "status"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False
    
    def get_authenticated_user(self) -> Optional[str]:
        """get the currently authenticated GitHub username."""
        if not self.check_gh_cli():
            return None
        
        try:
            result = subprocess.run(
                ["gh", "api", "user", "-q", ".login"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        return None
    
    def check_fork_exists(self, username: str) -> bool:
        """check if user has a fork of the registry repo."""
        try:
            result = subprocess.run(
                ["gh", "repo", "view", f"{username}/{self.repo_name}"],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False
    
    def create_fork(self) -> str:
        """fork the registry repo."""
        try:
            result = subprocess.run(
                ["gh", "repo", "fork", self.repo_full_name, "--clone=false"],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0:
                raise RuntimeError(f"Failed to create fork: {result.stderr}")
            
            # parse fork URL from output
            username = self.get_authenticated_user()
            return f"https://github.com/{username}/{self.repo_name}"
        except subprocess.TimeoutExpired:
            raise RuntimeError("Fork creation timed out")
    
    def sync_fork(self, username: str):
        """sync fork with upstream main branch."""
        try:
            # use gh api to sync fork
            subprocess.run(
                [
                    "gh", "api",
                    f"/repos/{username}/{self.repo_name}/merge-upstream",
                    "-f", "branch=main"
                ],
                capture_output=True,
                timeout=10,
                check=True
            )
        except subprocess.CalledProcessError:
            # sync might fail if already up to date, that's okay
            pass
    
    def create_branch(self, fork_path: Path, branch_name: str):
        """create a new branch in the fork."""
        subprocess.run(
            ["git", "checkout", "-b", branch_name],
            cwd=fork_path,
            check=True,
            capture_output=True
        )
    
    def commit_and_push(self, fork_path: Path, branch_name: str, message: str, username: str):
        """commit changes and push to fork."""
        # stage all changes
        subprocess.run(
            ["git", "add", "."],
            cwd=fork_path,
            check=True
        )
        
        # commit
        subprocess.run(
            ["git", "commit", "-m", message],
            cwd=fork_path,
            check=True
        )
        
        # push to fork with force-with-lease (safer than force)
        # this will overwrite the branch if it exists but hasn't been modified by others
        subprocess.run(
            ["git", "push", "--force-with-lease", "origin", branch_name],
            cwd=fork_path,
            check=True
        )
    
    def create_pull_request(self, branch_name: str, title: str, body: str, username: str) -> str:
        """create a pull request from fork to upstream."""
        try:
            result = subprocess.run(
                [
                    "gh", "pr", "create",
                    "--repo", self.repo_full_name,
                    "--head", f"{username}:{branch_name}",
                    "--title", title,
                    "--body", body
                ],
                capture_output=True,
                text=True,
                timeout=10,
                check=True
            )
            
            # extract PR URL from output
            pr_url = result.stdout.strip()
            return pr_url
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to create PR: {e.stderr}")
