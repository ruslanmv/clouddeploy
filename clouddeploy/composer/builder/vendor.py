import os
import subprocess

def vendor(module: str, dest: str):
    if not module or " " in module or ";" in module or ".." in module or "/" in module:
        return
    url = f"https://github.com/terraform-aws-modules/{module}.git"
    path = os.path.join(dest, module)
    if not os.path.exists(path):
        subprocess.check_call(["git", "clone", "--depth", "1", url, path])
