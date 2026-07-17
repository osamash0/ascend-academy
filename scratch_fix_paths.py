import os
from pathlib import Path

def replace_in_dir(dir_path: str):
    for root, _, files in os.walk(dir_path):
        for file in files:
            if not file.endswith((".ts", ".tsx")):
                continue
            
            file_path = Path(root) / file
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
                
            if "/api/upload" in content:
                new_content = content.replace("/api/upload", "/api/v1/upload")
                # But wait, what if it was already /api/v1/upload?
                # replace('/api/v1/v1/upload', '/api/v1/upload') to be safe
                new_content = new_content.replace("/api/v1/v1/upload", "/api/v1/upload")
                
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                print(f"Updated {file_path}")

replace_in_dir("c:/Users/Osama/ascend-academy/src")
