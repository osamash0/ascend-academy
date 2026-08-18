"""Shared constants for the Arq worker's liveness heartbeat (M33/M34).

The Arq worker (backend/workers/arq_worker.py) writes this Redis key on a
short cron interval, independent of whether any parse jobs happen to be
queued right now — a genuine "a worker process is alive and cycling" signal.
The API process's ``/health/ready`` (backend/main.py) and the upload
endpoints' backpressure copy (backend/services/upload_service.py) both read
it to distinguish a momentarily-busy-but-draining queue from one nobody is
draining at all (a dead worker), which a raw queue-depth number can't tell
apart on its own.

Kept in its own tiny module (no heavy imports) so both the worker process
(which pulls in the entire parse pipeline via arq_worker.py) and the API
process (main.py, upload_service.py) can share just the key/TTL without
either side importing the other's dependency tree.
"""

WORKER_HEARTBEAT_KEY = "arq:worker:heartbeat"

# The worker cron re-heartbeats well inside this window (see arq_worker.py's
# WORKER_HEARTBEAT_INTERVAL_SECONDS); a key that's expired (or was never set)
# means no worker has cycled recently enough to trust it's alive.
WORKER_HEARTBEAT_TTL_SECONDS = 90
