import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv()

from backend.services.ai.retrieval import retrieve_relevant_slides

async def test():
    # Example query that is highly specific
    query = "specific ID or acronym that only exists in text"
    
    # We will test without scoping first to see what it does
    try:
        results = await retrieve_relevant_slides(query, lecture_id="00000000-0000-0000-0000-000000000000")
        print("Results:")
        for r in results:
            print(f"- Slide {r.get('slide_index')}: similarity={r.get('similarity')} | {r.get('title')}")
        print("Test finished successfully!")
    except Exception as e:
        print(f"Error during retrieval: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(test())
