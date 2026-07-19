import logging
import sys
from contextvars import ContextVar
from pythonjsonlogger import jsonlogger

def setup_logging():
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)

    # Remove existing handlers
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # Console JSON handler
    logHandler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        '%(timestamp)s %(levelname)s %(name)s %(message)s %(correlation_id)s',
        timestamp=True
    )
    logHandler.setFormatter(formatter)
    logger.addHandler(logHandler)

# Roadmap P1-2: this used to be a plain attribute on a module-global
# CorrelationIdFilter instance, mutated by set_correlation_id() on every
# request. Under concurrent requests on the same worker's event loop, request
# B's call to set_correlation_id() overwrote request A's id before all of A's
# log lines had been emitted — logs from concurrent requests could carry the
# WRONG correlation id. A ContextVar is per-asyncio-Task, and FastAPI/Starlette
# runs each request in its own Task, so each request's value is isolated even
# though they share one thread/event loop.
_correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="N/A")

class CorrelationIdFilter(logging.Filter):
    def filter(self, record):
        record.correlation_id = getattr(record, 'correlation_id', _correlation_id_var.get())
        return True

correlation_id_filter = CorrelationIdFilter()
logging.getLogger().addFilter(correlation_id_filter)

def set_correlation_id(correlation_id: str):
    _correlation_id_var.set(correlation_id)
