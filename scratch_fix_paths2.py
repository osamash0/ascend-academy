import os
import re
from pathlib import Path

def replace_in_dir(dir_path: str):
    for root, _, files in os.walk(dir_path):
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
            
            file_path = Path(root) / file
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
                
            # Replace /api/ with /api/v1/ in fetch calls specifically
            # We look for patterns like: fetch(`.../api/...`) or fetch('.../api/...')
            # But let's just do a simpler targeted replacement for the known endpoints
            
            targets = [
                "/api/lectures/",
                "/api/concepts/",
                "/api/fast-upload/",
                "/api/auth/",
                "/api/ai/",
                "/api/nudges/"
            ]
            
            original_content = content
            for target in targets:
                if target in content:
                    content = content.replace(target, target.replace("/api/", "/api/v1/"))
            
            # Make sure we didn't accidentally do /api/v1/v1/
            content = content.replace("/api/v1/v1/", "/api/v1/")
            
            if content != original_content:
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"Updated {file_path}")

replace_in_dir("c:/Users/Osama/ascend-academy/src")
