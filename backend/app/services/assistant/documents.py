"""Document Q&A retrieval over `document_chunks`.

Authorisation is decided here, in the query, never by the model:
  * placement documents (circulars, brochures, eligibility documents) are readable when the caller's ROLE is in the document's `access_roles`
  * personal documents (resume, certificate: anything with an owner) are readable only by that student; staff never get them through the assistant
  * only fully indexed documents are searched; drafts' job documents are hidden from students

Everything returned is UNTRUSTED text written by third parties. The orchestrator labels it as such for the model and
blocks action-preparing tools in any turn that read it (see orchestrator.py).

Dependency: text extraction/indexing. The Flask backend has no upload/extraction pipeline yet (the documents API answers 501), so
`document_chunks` is empty until that exists. Until then this returns an empty list: nothing is fabricated.
"""
import re

import sqlalchemy as sa

from ..student_service import student_of
from ...extensions import db
from ...models import Document, DocumentChunk, DocumentType, Job, JobStatus, ProcessingStatus, User

PLACEMENT_TYPES = (DocumentType.CIRCULAR, DocumentType.BROCHURE, DocumentType.ELIGIBILITY)
EXCERPT_CHARS = 600
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _terms(query: str) -> list[str]:
    words = re.findall(r"[a-z0-9+#&.]{3,}", query.lower())
    return list(dict.fromkeys(words))[:8]


def _excerpt(text: str, terms: list[str]) -> str:
    text = _CTRL.sub(" ", text)
    low = text.lower()
    hits = [i for i in (low.find(t) for t in terms) if i >= 0]
    start = max(min(hits) - 120, 0) if hits else 0
    return re.sub(r"\s+", " ", text[start:start + EXCERPT_CHARS]).strip()


def _readable_documents(user: User) -> dict[int, Document]:
    docs = db.session.query(Document).filter(Document.processing == ProcessingStatus.INDEXED).all()
    own_student_id = user.student.id if user.role_name == "student" and user.student else None
    draft_jobs = {j.id for j in db.session.query(Job.id).filter(Job.status == JobStatus.DRAFT)} if user.role_name == "student" else set()
    out: dict[int, Document] = {}
    for d in docs:
        if d.owner_student_id is not None:
            if own_student_id is not None and d.owner_student_id == own_student_id:
                out[d.id] = d
            continue
        if d.doc_type in PLACEMENT_TYPES and user.role_name in (d.access_roles or []) and d.job_id not in draft_jobs:
            out[d.id] = d
    return out


def search(user: User, query: str, limit: int = 5) -> list[dict]:
    if user.role_name == "student":
        student_of(user)  # students need a student record; same guard as every other student-only service
    terms = _terms(query)
    if not terms:
        return []
    readable = _readable_documents(user)
    if not readable:
        return []
    match = sa.or_(*[sa.func.lower(DocumentChunk.text).contains(t, autoescape=True) for t in terms])
    rows = db.session.query(DocumentChunk).filter(DocumentChunk.document_id.in_(list(readable)), match).limit(300).all()
    scored = sorted(rows, key=lambda c: (-sum(c.text.lower().count(t) for t in terms), c.document_id, c.page))
    return [{"documentId": str(c.document_id), "title": readable[c.document_id].title, "type": readable[c.document_id].doc_type.value, "page": c.page, "excerpt": _excerpt(c.text, terms)}
            for c in scored[:limit]]
