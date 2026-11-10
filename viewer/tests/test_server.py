"""Verify actual HTTP seeking, not just the range parser."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ThreadingHTTPServer, byte_range


class RangeTests(unittest.TestCase):
    def test_range_forms(self):
        for header, expected in [("bytes=0-9", (0, 9)), ("bytes=90-", (90, 99)),
                                 ("bytes=-10", (90, 99)), ("bytes=90-999", (90, 99))]:
            self.assertEqual(byte_range(header, 100), expected)
        for header in ["bytes=100-", "bytes=9-2", "bytes=-0", "bytes=-", "bytes=0-1,4-5"]:
            with self.assertRaises(ValueError):
                byte_range(header, 100)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.video = Path(cls.temp.name) / "test.mp4"
        cls.payload = bytes(range(256)) * 20
        cls.video.write_bytes(cls.payload)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.server.video = cls.video
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:{}".format(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def test_forward_backward_and_suffix_seeks(self):
        for value, start, end in [("bytes=4000-4095", 4000, 4095), ("bytes=10-29", 10, 29),
                                  ("bytes=-20", 5100, 5119), ("bytes=5100-", 5100, 5119)]:
            with urlopen(Request(self.url + "/video", headers={"Range": value})) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.headers["Content-Range"], "bytes {}-{}/5120".format(start, end))
                self.assertEqual(response.read(), self.payload[start:end + 1])

    def test_head_and_invalid_range(self):
        with urlopen(Request(self.url + "/video", method="HEAD")) as response:
            self.assertEqual(response.headers["Content-Length"], "5120")
            self.assertEqual(response.read(), b"")
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.url + "/video", headers={"Range": "bytes=9999-"}))
        self.assertEqual(caught.exception.code, 416)

    def test_config_static_and_private_file_isolation(self):
        with urlopen(self.url + "/api/config") as response:
            data = json.load(response)
            self.assertEqual(data["fps"], 25)
            self.assertEqual(data["frames"], 199319)
            self.assertTrue(data["videoAvailable"])
        with urlopen(self.url + "/") as response:
            self.assertIn(b"FRAME INSPECTOR", response.read())
        with urlopen(self.url + "/app.mjs") as response:
            self.assertEqual(response.headers["Content-Type"], "text/javascript")
        for path in ["/.git/config", "/games.py", "/api/models/../../games.py", "/data/tactical/BAR-ATH_tactical_atd.txt"]:
            with self.assertRaises(HTTPError) as caught:
                urlopen(self.url + path)
            self.assertEqual(caught.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
