import asyncio
import httpx

async def main():
    async with httpx.AsyncClient() as client:
        # Get session from bridging endpoint if we had the cookie
        # But we can't easily get the Better Auth cookie here.
        pass

asyncio.run(main())
