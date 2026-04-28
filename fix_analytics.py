import re

with open("backend/services/analytics_service.py", "r") as f:
    content = f.read()

# For each function definition that has `token: str = None`, we'll find `get_auth_client(token)` and replace it.
# Instead of complex regex, we can just find each function, insert `client = get_auth_client(token)` at the top, and replace `get_auth_client(token)` with `client` inside it.

def process_func(match):
    func_header = match.group(1)
    func_body = match.group(2)
    
    # insert client instantiation after docstring or first line
    # Actually, the simplest is to replace `get_auth_client(token)` with `client` globally in the body,
    # and insert `client = get_auth_client(token)` right after the signature.
    
    # if get_auth_client(token) is not in body, don't change
    if "get_auth_client(token)" not in func_body:
        return match.group(0)
        
    new_body = func_body.replace("get_auth_client(token)", "client")
    
    # Insert client = get_auth_client(token) at the beginning of the body
    # Find the first newline and indentation
    first_newline = new_body.find('\n')
    # Find indentation of the first line inside body
    m = re.search(r'\n(\s+)', new_body)
    indent = m.group(1) if m else "    "
    
    # Actually, we can just append it after the def line
    return func_header + f"\n{indent}client = get_auth_client(token)" + new_body

# Find all function definitions
# Pattern: (def \w+\(.*?\):)(.*?(?=\ndef |\Z))
new_content = re.sub(r'(def \w+\([^)]*token: str = None[^)]*\)\s*(?:->.*?)?:)(.*?)(?=\ndef |\Z)', process_func, content, flags=re.DOTALL)

with open("backend/services/analytics_service.py", "w") as f:
    f.write(new_content)

print("Done")
