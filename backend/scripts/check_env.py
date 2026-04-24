import sys
import importlib.util
import os
from pathlib import Path

def check_package(package_name):
    spec = importlib.util.find_spec(package_name)
    if spec is None:
        print(f"❌ {package_name} is NOT installed.")
        return False
    print(f"✅ {package_name} is installed.")
    return True

def check_env_file():
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        print(f"✅ .env file found at {env_path}")
        return True
    else:
        print(f"❌ .env file NOT found at {env_path}")
        return False

def main():
    print(f"🔍 Checking Backend Environment...\n")
    
    # Check Python Version
    print(f"Python Version: {sys.version}")
    if sys.version_info < (3, 8):
        print("❌ Python 3.8+ is required.")
        sys.exit(1)
    
    # Check Packages
    required_packages = ["fastapi", "uvicorn", "supabase", "dotenv"]
    all_packages_ok = all(check_package(pkg) for pkg in required_packages)
    
    # Check .env
    env_ok = check_env_file()
    
    if all_packages_ok and env_ok:
        print("\n🚀 Backend Environment looks GOOD!")
        sys.exit(0)
    else:
        print("\n⚠️  Some checks failed. Please install requirements and create .env.")
        sys.exit(1)

if __name__ == "__main__":
    main()
