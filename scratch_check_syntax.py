import os
import py_compile

def check_syntax(directory):
    errors = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith(".py"):
                path = os.path.join(root, file)
                try:
                    py_compile.compile(path, doraise=True)
                except py_compile.PyCompileError as e:
                    errors.append(str(e))
    return errors

if __name__ == "__main__":
    errs = check_syntax("c:/Users/Osama/ascend-academy/backend")
    if errs:
        print("Syntax errors found:")
        for err in errs:
            print(err)
    else:
        print("No syntax errors found.")
