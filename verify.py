"""Exercise the actual local API and preserve observations, not accuracy claims."""
import copy
import argparse
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = "http://127.0.0.1:8018"


def call(path, payload=None):
    raw = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=raw, headers={"content-type": "application/json"})
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=180) as response:
        data = json.load(response)
    return data, round((time.perf_counter() - started) * 1000, 1)


def validate(data):
    assert data["answers"], "No model answers returned"
    assert math.isfinite(data["latency_ms"]) and data["latency_ms"] >= 0
    for a in data["answers"].values():
        if a["type"] == "noul":
            assert 0 <= a["noul"] <= 1
        else:
            ps = a["probabilities"]
            assert all(math.isfinite(p) and 0 <= p <= 1 for p in ps.values())
            assert abs(sum(ps.values()) - 1) < 1e-4
            if a["type"] == "choice":
                assert a["choice"] in ps


def observe(case):
    data, wall = call("/v1/systemone", case["request"])
    validate(data)
    comparisons = {}
    for q, expected in case["expected"].items():
        answer = data["answers"][q]
        actual = answer["choice"] if answer["type"] == "choice" else answer["noul"] >= 0.5
        comparisons[q] = {"expected": expected, "actual": actual, "match": actual == expected}
    print(case["id"], f"{wall} ms", comparisons, flush=True)
    return {"id": case["id"], "request": case["request"], "response": data, "wall_ms": wall, "comparisons": comparisons}


def main():
    global BASE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8018)
    args = parser.parse_args()
    BASE = f"http://127.0.0.1:{args.port}"
    cases = json.loads((ROOT / "test-cases.json").read_text(encoding="utf-8"))
    metadata, _ = call("/v1/models")
    assert metadata["models"][0]["device"] == "cuda", "GPU serving was not verified"
    for path in ("/", "/lab/cases", "/docs", "/assets/playground.js", "/assets/playground.css"):
        with urllib.request.urlopen(BASE + path, timeout=10) as response:
            assert response.status == 200 and response.read()
    results = [observe(case) for case in cases]
    changed = copy.deepcopy(cases[3])
    changed["id"] = "09-policy-opened"
    changed["request"]["state"] = changed["request"]["state"].replace("Case: the item is unopened", "Case: the item is opened")
    changed["expected"] = {"decision": "reject"}
    results.append(observe(changed))
    repeat = observe(cases[0])
    permutation, wall = call("/v1/systemone/permute", {"request": cases[0]["request"], "question": "team", "n_perm": 6, "seed": 42})
    assert len(permutation["runs"]) == 6
    try:
        call("/v1/systemone", {"model": "kev-latest", "state": "test", "questions": {"broken": {"type": "invalid"}}})
        raise AssertionError("Malformed request was accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 422
    session = {"model": metadata["models"][0]["run"], "records": [results[0]]}
    export_request = urllib.request.Request(
        BASE + "/lab/export",
        data=urllib.parse.urlencode({"session": json.dumps(session)}).encode(),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(export_request, timeout=10) as response:
        assert response.headers["Content-Disposition"].startswith("attachment;")
        assert json.load(response) == session
    export_request.add_header("Origin", "null")
    export_request.add_header("Sec-Fetch-Site", "same-origin")
    with urllib.request.urlopen(export_request, timeout=10) as response:
        assert json.load(response) == session
    export_request.add_header("Sec-Fetch-Site", "cross-site")
    try:
        urllib.request.urlopen(export_request, timeout=10)
        raise AssertionError("Cross-site form export was accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 403
    try:
        call("/lab/export", {"invalid": True})
        raise AssertionError("Malformed export was accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 400
    for headers, status in (
        ({"Origin": "https://example.org"}, 403),
        ({"Origin": "null"}, 403),
        ({"Sec-Fetch-Site": "cross-site"}, 403),
        ({"Host": "example.org"}, 400),
    ):
        req = urllib.request.Request(BASE + "/lab/info", headers=headers)
        try:
            urllib.request.urlopen(req, timeout=10)
            raise AssertionError("Non-local browser request was accepted")
        except urllib.error.HTTPError as exc:
            assert exc.code == status
    req = urllib.request.Request(BASE + "/lab/info", headers={"Origin": BASE})
    with urllib.request.urlopen(req, timeout=10) as response:
        assert json.load(response)["model_run"] == session["model"]
    for raw, status in ((b"session=" + b"x" * (16 * 1024 * 1024), 413),
                        (urllib.parse.urlencode({"session": '{"records":[],"bad":NaN}'}).encode(), 400),
                        (urllib.parse.urlencode({"session": '{"records":[],"bad":"\\ud800"}'}).encode(), 400)):
        req = urllib.request.Request(BASE + "/lab/export", data=raw)
        try:
            urllib.request.urlopen(req, timeout=10)
            raise AssertionError("Invalid export was accepted")
        except urllib.error.HTTPError as exc:
            assert exc.code == status
    report = {"model_metadata": metadata, "cases": results, "repeat": repeat,
              "option_order": permutation, "option_order_wall_ms": wall,
              "checks": {"gpu": True, "ui_routes": True, "probability_contract": True, "invalid_request_422": True,
                         "session_export_attachment": True, "invalid_export_400": True,
                         "local_browser_origin": True, "export_limits": True},
              "note": "Small authored examples; not a representative accuracy benchmark."}
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "results" / "verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("API verification passed. Option-order stable:", permutation["argmax_stable"], flush=True)


if __name__ == "__main__":
    main()
