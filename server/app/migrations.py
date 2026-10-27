"""The registry of start-up migrations, in run order (NFR-112): later passes may rely on earlier ones, so add a new pass at the end."""

from __future__ import annotations

from collections.abc import Callable
from types import ModuleType

from . import (
    migrate_genre_eras_seed,
    migrate_model2,
    migrate_model3,
    migrate_reference_tags,
    migrate_removals,
    migrate_renames,
    migrate_retired,
    migrate_sources,
    migrate_tags,
    migrate_version_norm,
)

REGISTRY: tuple[tuple[str, ModuleType], ...] = (
    ("migrate model 2", migrate_model2),
    ("migrate model 3", migrate_model3),
    ("migrate tags", migrate_tags),
    ("migrate removals", migrate_removals),
    ("migrate renames", migrate_renames),
    ("migrate retired", migrate_retired),
    ("migrate version norm", migrate_version_norm),
    ("migrate sources", migrate_sources),
    ("migrate reference tags", migrate_reference_tags),
    ("migrate genre eras seed", migrate_genre_eras_seed),
)


def startup_steps() -> list[tuple[str, Callable[[], object]]]:
    """The `run` of every registered pass, looked up at call time."""
    return [(label, module.run) for label, module in REGISTRY]
