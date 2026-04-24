# Development & Contribution Guidelines

To ensure the long-term maintainability of **Learnstation**, please adhere to the following guidelines.

## 1. Version Control (Git) Hygiene

Since the project started with a compressed history, it is crucial to maintain a clean history moving forward.

### Commit Messages
Use the [Conventional Commits](https://www.conventionalcommits.org/) specification:
- `feat: add lecture upload progress bar`
- `fix: resolve CORS issue on localhost`
- `docs: update architecture overview`
- `style: format code with prettier`
- `refactor: simplify analytics service logic`

### Commit Granularity
- **One logical change per commit.** Do not bundle a bug fix, a new feature, and a formatting change into one commit.
- **Frequency:** Commit often. Ideally, every time you complete a sub-task or get a piece of code working.

## 2. Documentation

- **Keep `project_docs/` updated.** If you add a major feature, update `architecture_overview.md`.
- **Self-Documenting Code:** Use clear variable names and type hints (Python) / interfaces (TypeScript).
- **Docstrings:**
  - Python: Add docstrings to every module, class, and function.
  - TypeScript: Use TSDoc `/** ... */` for exported components and functions.

## 3. Code Standards

### Frontend (React/TS)
- **Components:** Keep components small. If a component exceeds 200 lines, consider extracting sub-components.
- **Hooks:** Encapsulate logic in custom hooks (e.g., `useLectureData`).
- **Styling:** Use Tailwind utility classes. Avoid inline `style={{ ... }}` unless dynamic.

### Backend (Python/FastAPI)
- **Type Safety:** Use Pydantic models for all Request/Response schemas.
- **Service Layer:** Keep business logic in `services/`. API routes should only handle request parsing and response formatting.
- **Error Handling:** Use `HTTPException` with clear detail messages.

## 4. Testing
- **Frontend:** run `npm test` (Vitest).
- **Backend:** Create tests in `backend/tests/` and run using `pytest`.

## 5. Directory Structure
Do not create files in the root unless absolutely necessary.
- React code goes in `src/`.
- Python code goes in `backend/`.
- Documentation goes in `project_docs/`.
