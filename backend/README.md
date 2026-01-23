# Learnstation Backend

This is the Python/FastAPI backend for Learnstation.

## Setup

This project uses a shared virtual environment located at `C:\Users\Osama\learning-platform\venv`.

### Running the Server

1.  **Activate the Virtual Environment**:
    ```powershell
    C:\Users\Osama\learning-platform\venv\Scripts\activate
    ```

2.  **Install Dependencies** (if needed):
    ```powershell
    pip install -r backend/requirements.txt
    ```

3.  **Run the Server**:
    Run this command from the root of the repo (`ascend-academy`):
    ```powershell
    uvicorn backend.main:app --reload
    ```

    The API will be available at `http://localhost:8000`.
    Interactive docs: `http://localhost:8000/docs`.
