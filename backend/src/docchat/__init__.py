"""Siteco Document Chat backend.

Privacy: onnxruntime (used by fastembed for the local embedding model) ships Microsoft
telemetry that records system details in a local store and uploads them. Only this variable,
read by onnxruntime itself when it starts, keeps it off; it is set here because every process
of ours imports this package before anything imports onnxruntime.
"""

import os

os.environ["ORT_DISABLE_TELEMETRY"] = "1"
# Lance warns on every hybrid search that it still projects the score columns we never read
# (a deprecation notice from its Rust logger). Real errors still show; an explicit setting wins.
os.environ.setdefault("LANCEDB_LOG", "error")
