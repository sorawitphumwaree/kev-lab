"""Local playground mounted on the real Kev API server."""
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from kev.serve import app, main

ROOT = Path(__file__).resolve().parent
MODEL_RUN = "jaredpalmer/kev-0.8b@bf75a6a8848ea6960ff2ed108d9ed44c2941174f"
MAX_EXPORT_BYTES = 16 * 1024 * 1024
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="playground-assets")


@app.middleware("http")
async def local_browser_only(request: Request, call_next):
    """Keep arbitrary websites from calling the unauthenticated local API."""
    origin = request.headers.get("origin")
    expected = f"{request.url.scheme}://{request.url.netloc}"
    site = request.headers.get("sec-fetch-site")
    # Following an external link is navigation, not a cross-origin API call.
    main_navigation = (request.method == "GET" and request.url.path == "/"
                       and request.headers.get("sec-fetch-mode") == "navigate"
                       and request.headers.get("sec-fetch-dest") == "document")
    # Some embedded browsers send Origin: null for native form downloads.
    # Fetch Metadata still identifies a same-origin form; cross-site forms fail.
    local_download = (request.method == "POST" and request.url.path == "/lab/export"
                      and origin == "null" and site == "same-origin")
    if not main_navigation and ((origin and origin != expected and not local_download) or site == "cross-site"):
        return Response("Cross-origin requests are disabled", status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path == "/":
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
        )
    return response


app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])


@app.get("/lab/info")
def lab_info():
    return {"application": "kev-local-lab", "model_run": MODEL_RUN}


@app.get("/", include_in_schema=False)
def playground():
    return FileResponse(ROOT / "playground.html")


@app.get("/lab/cases")
def cases():
    return json.loads((ROOT / "test-cases.json").read_text(encoding="utf-8"))


@app.post("/lab/export", include_in_schema=False)
async def export_session(request: Request):
    """Return a browser download without storing the session on the server."""
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_EXPORT_BYTES:
            raise HTTPException(413, "Session export exceeds 16 MiB")
    try:
        form = parse_qs(body.decode("utf-8"), max_num_fields=1)
        session = json.loads(form["session"][0])
        if not isinstance(session, dict) or not isinstance(session.get("records"), list):
            raise ValueError("session must contain a records list")
        content = json.dumps(session, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
    except (KeyError, ValueError, UnicodeError, RecursionError) as exc:
        raise HTTPException(400, "Invalid session export") from exc
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    return Response(
        content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="kev-session-{timestamp}.json"'},
    )


if __name__ == "__main__":
    main()
