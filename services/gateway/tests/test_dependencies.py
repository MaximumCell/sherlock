"""The gateway plans scans from the module registry, which skips any module whose optional
library is not installed. If the gateway image lacks an extra the workers have, those sources
are silently never scheduled (this happened to image metadata, phone metadata and the email
sweep on the first deploy). Keep the two dependency lists in step."""
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _core_extras(pyproject: Path) -> set[str]:
    deps = tomllib.loads(pyproject.read_text())["project"]["dependencies"]
    for dep in deps:
        m = re.match(r"sherlock-core\[([^\]]*)\]", dep.replace(" ", ""))
        if m:
            return set(m.group(1).split(","))
    return set()


def test_gateway_installs_every_extra_the_workers_use():
    worker = _core_extras(ROOT / "services/worker/pyproject.toml")
    gateway = _core_extras(ROOT / "services/gateway/pyproject.toml")
    assert worker, "worker should depend on sherlock-core extras"
    assert worker <= gateway, f"gateway is missing extras: {sorted(worker - gateway)}"
