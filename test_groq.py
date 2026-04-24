import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv(".env")
client = Groq()

models_to_test = ["llama3-70b-8192", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]

for model in models_to_test:
    try:
        print(f"Testing {model}...")
        res = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Return ONLY valid JSON: {\"success\": true}"}],
            response_format={"type": "json_object"}
        )
        print(f"✅ {model} works! Response:", res.choices[0].message.content)
    except Exception as e:
        print(f"❌ {model} failed: {e}")
