import os
import subprocess

with open(".env") as f:
    for line in f:
        if line.startswith("DATABASE_URL="):
            os.environ["DATABASE_URL"] = line.split("=", 1)[1].strip()

subprocess.run(["psql", os.environ["DATABASE_URL"], "-c", "SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'courses'"])
