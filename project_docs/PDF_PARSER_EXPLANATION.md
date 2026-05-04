# PDF Parsing Architecture - Ascend Academy

This document provides a comprehensive technical overview of the PDF parsing pipeline used in the Ascend Academy platform. The system transforms raw university lecture PDFs into structured, interactive educational content.

---

## 🚀 High-Level Architecture

The parsing process is a multi-stage pipeline that bridges the frontend React application and the FastAPI backend services.

- **Frontend**: `src/components/PDFUploadOverlay.tsx` manages the file upload and displays real-time progress using a **Streaming API**.
- **Backend Entry Point**: `backend/api/upload.py` exposes the `/api/upload/parse-pdf-stream` endpoint.
- **Core Logic**: `backend/services/file_parse_service.py` handles orchestration, while `backend/services/ai_service.py` manages LLM interactions.

---

## 🛠️ Phase 1: Technical Extraction

When a PDF is uploaded, the system performs two parallel extraction tracks:

### 1. Traditional Text Extraction
- **Tools**: `PyMuPDF (fitz)` or `pypdf`.
- **Purpose**: Extracts selectable text directly from the PDF layers. 
- **Pros**: Extremely fast, low compute cost.
- **Cons**: Misses text inside images, diagrams, or scanned pages.

### 2. Vision Conversion
- **Tools**: `pdf2image` (requires the `Poppler` system dependency).
- **Purpose**: Converts every PDF page into a high-resolution JPEG (1280px width).
- **Rationale**: This allows **Multimodal AI** models to "see" the visual layout, charts, and mathematical formulas as a human would.

---

## 🧠 Phase 2: AI Analysis

The system intelligently chooses an analysis path based on the user's selected AI model.

### Track A: Multimodal Vision (Groq / Gemini)
*Primary path for high-quality results.*
1. The backend sends both the **JPEG image** and the **raw text** to the AI model.
2. The AI uses the `_SLIDE_VISION_PROMPT` to:
   - **Categorize**: Identify the slide type (Title, Content, Diagram, Example, or Meta).
   - **Extract**: Identify main topics and bullet points.
   - **Format**: Convert technical content into clean, student-friendly **Markdown**.
   - **Quiz**: Generate a relevant multiple-choice question based *only* on that slide's content.

### Track B: Text-Only Fallback (Ollama / Llama3)
*Used when vision is disabled or using local models.*
1. The backend sends only the raw extracted text.
2. The AI uses `process_slide_batch` to perform "clean-up" and summarization.
3. **Limitation**: If a slide is 100% image-based, this track will return a placeholder indicating no text was found.

---

## 🔍 Phase 3: Metadata Filtering

To ensure a premium user experience, the system filters out non-educational "noise" using `is_metadata_slide`:

- **Detected Types**: Title slides, university logos, "Any Questions?" slides, and bibliography pages.
- **Handling**: These slides are marked as `is_metadata: true`.
- **Behavior**: They are displayed in the viewer but the system **suppresses quiz generation** for them, ensuring students aren't quizzed on a "Thank You" slide.

---

## 📦 Phase 4: Structured Output

The final result is a JSON array of slide objects:

| Field | Description |
| :--- | :--- |
| `title` | A concise, AI-generated title for the slide. |
| `content` | The educational content formatted in GitHub-flavored Markdown. |
| `summary` | A 2-3 sentence overview for quick review. |
| `questions` | An array containing a multiple-choice question object. |
| `slide_type` | Categorization (e.g., `content_slide`, `diagram_slide`). |
| `is_metadata` | Boolean flag for non-educational slides. |

---

## ⚙️ Technology Stack Summary

- **PDF Processing**: `PyMuPDF`, `pypdf`, `pdf2image`.
- **AI Backend**: `FastAPI` + `uvicorn`.
- **AI Models**: `Gemini 1.5/2.5 Flash`, `Llama 3.2 Vision (via Groq)`, `Llama 3 (via Ollama)`.
- **Communication**: Server-Sent Events (SSE) for real-time streaming updates.
