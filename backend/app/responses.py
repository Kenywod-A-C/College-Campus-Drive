"""Consistent success envelopes: {"data": ...} and {"data": [...], "meta": {...}}."""
from typing import Any

from flask import jsonify


def ok(data: Any = None, status: int = 200):
    resp = jsonify({"data": data})
    resp.status_code = status
    return resp


def paginated(items: list, *, page: int, page_size: int, total: int, **extra_meta):
    meta = {"page": page, "pageSize": page_size, "total": total, "totalPages": max(1, -(-total // page_size)), **extra_meta}
    return jsonify({"data": items, "meta": meta})
