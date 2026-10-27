from ..extensions import db
from ..models import Notification, NotificationKind


def notify(user_id: int, title: str, body: str = "", kind: NotificationKind = NotificationKind.SYSTEM, link: str | None = None) -> None:
    db.session.add(Notification(user_id=user_id, title=title[:200], body=body[:500], kind=kind, link=link))
