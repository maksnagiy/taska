from fastapi import FastAPI

try:
    from routes import router as llm_router
except ImportError:  # pragma: no cover
    from src.routes import router as llm_router


app = FastAPI(title="Agile Board LLM API")
app.include_router(llm_router)