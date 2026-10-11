"""HTTP regression checks against a running lab; no GPU inference required."""
import json
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("KEV_LAB_URL", "http://127.0.0.1:8018").rstrip("/")
NAVIGATION = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate",
              "Sec-Fetch-Dest": "document"}


def request(path="/", *, headers=None, data=None):
    req = urllib.request.Request(BASE + path, headers=headers or {}, data=data)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read(), response.headers


class BrowserAccessTests(unittest.TestCase):
    def test_external_link_opens_main_document(self):
        for origin in (None, "https://example.org", "null"):
            with self.subTest(origin=origin):
                headers = dict(NAVIGATION)
                if origin is not None:
                    headers["Origin"] = origin
                status, body, response_headers = request(headers=headers)
                self.assertEqual(status, 200)
                self.assertIn(b"Kev Local Lab", body)
                self.assertIn("frame-ancestors 'none'", response_headers["Content-Security-Policy"])

    def test_cross_site_fetch_and_iframe_are_blocked(self):
        for overrides in ({"Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty"},
                          {"Sec-Fetch-Dest": "iframe"},
                          {"Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image"}):
            with self.subTest(overrides=overrides):
                status, _, _ = request(headers={**NAVIGATION, **overrides})
                self.assertEqual(status, 403)
        status, _, _ = request(headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(status, 403)

    def test_navigation_exception_does_not_open_api(self):
        for path in ("/lab/info", "/lab/cases", "/v1/models", "/docs"):
            with self.subTest(path=path):
                status, _, _ = request(path, headers=NAVIGATION)
                self.assertEqual(status, 403)
        status, _, _ = request("/v1/systemone", headers=NAVIGATION, data=b"{}")
        self.assertEqual(status, 403)
        status, _, _ = request(headers=NAVIGATION, data=b"{}")
        self.assertEqual(status, 403)

    def test_host_validation_still_applies_to_navigation(self):
        status, _, _ = request(headers={**NAVIGATION, "Host": "example.org"})
        self.assertEqual(status, 400)

    def test_same_origin_bootstrap_and_direct_navigation(self):
        status, _, _ = request(headers={**NAVIGATION, "Sec-Fetch-Site": "none"})
        self.assertEqual(status, 200)
        for path in ("/lab/info", "/lab/cases", "/assets/playground.js", "/assets/playground.css"):
            with self.subTest(path=path):
                status, body, _ = request(path, headers={"Origin": BASE, "Sec-Fetch-Site": "same-origin"})
                self.assertEqual(status, 200)
                self.assertTrue(body)

    def test_embedded_browser_export_and_cross_site_post(self):
        session = {"records": []}
        data = urllib.parse.urlencode({"session": json.dumps(session)}).encode()
        headers = {"Origin": "null", "Sec-Fetch-Site": "same-origin"}
        status, body, response_headers = request("/lab/export", headers=headers, data=data)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), session)
        self.assertTrue(response_headers["Content-Disposition"].startswith("attachment;"))
        status, _, _ = request("/lab/export", headers={**headers, **NAVIGATION}, data=data)
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
