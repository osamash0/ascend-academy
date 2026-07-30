.PHONY: eval eval-fake

# Roadmap Foundation 10x P1-3: nightly AI-quality regression gate.
# Needs real provider API keys + DATABASE_URL for a real run against
# LivePipeline; see backend/eval/pipeline.py.
eval:
	python -m backend.eval.run_eval

# Smoke-tests the harness itself (scoring/persistence/CLI wiring) against
# FakePipeline — no live API calls, no real DB content required.
eval-fake:
	python -m backend.eval.run_eval --fake
