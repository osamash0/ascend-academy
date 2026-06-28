import logging
import sys
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

class CorrelationIdFilter(logging.Filter):
    def __init__(self, name=''):
        super().__init__(name)
        self.correlation_id = None

    def filter(self, record):
        record.correlation_id = getattr(record, 'correlation_id', self.correlation_id or "N/A")
        return True

correlation_id_filter = CorrelationIdFilter()
logging.getLogger().addFilter(correlation_id_filter)

def set_correlation_id(correlation_id: str):
    correlation_id_filter.correlation_id = correlation_id
