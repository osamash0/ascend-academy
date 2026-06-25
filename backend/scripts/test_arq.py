import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv()

from backend.core.redis import init_redis, enqueue_job, close_redis

async def main():
    try:
        await init_redis()
        print("Enqueuing test_task...")
        await enqueue_job("test_task", "Hello from Arq test script!")
        print("Job enqueued successfully.")
    except Exception as e:
        print(f"Error during enqueue: {e}")
        sys.exit(1)
    finally:
        await close_redis()

if __name__ == "__main__":
    asyncio.run(main())
