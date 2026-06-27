from uuid import UUID

from sqlmodel import Session

from ..models import AuditLog


def write_action(
    session: Session,
    *,
    actor_type: str,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None,
    metadata: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_type=actor_type,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata_json=metadata or {},
        )
    )
