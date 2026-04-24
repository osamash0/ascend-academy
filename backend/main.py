from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.core.database import supabase
from backend.api.analytics import router as analytics_router
from backend.api.upload import router as upload_router
from backend.api.ai_content import router as ai_router

app = FastAPI(title="Learnstation API", version="0.1.0")

# Configure CORS to allow requests from the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],  # Default Vite port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(analytics_router)
app.include_router(upload_router)
app.include_router(ai_router)

@app.get("/")
async def read_root():
    return {"message": "Welcome to Learnstation API"}

@app.get("/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/test-db")
def test_db():
    try:
        response = supabase.table("profiles").select("*").limit(1).execute()
        return {"data": response.data, "message": "Connection successful!"}
    except Exception as e:
        return {"error": str(e)}
