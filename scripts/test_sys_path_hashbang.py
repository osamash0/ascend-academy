#!/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python
import sys
try:
    import ollama
    print("OLLAMA OK")
except Exception as e:
    print("OLLAMA FAIL:", e)
