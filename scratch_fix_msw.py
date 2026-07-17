import os

def fix_msw_handlers():
    file_path = "c:/Users/Osama/ascend-academy/src/test/handlers/index.ts"
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    content = content.replace("'/api/", "'/api/v1/")
    content = content.replace('"/api/', '"/api/v1/')
    content = content.replace("`/api/", "`/api/v1/")
    # deduplicate
    content = content.replace("/api/v1/v1/", "/api/v1/")
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content)
        
    print("Fixed MSW handlers")

fix_msw_handlers()
