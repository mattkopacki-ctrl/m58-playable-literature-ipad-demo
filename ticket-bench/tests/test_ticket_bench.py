import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from ticket_bench.average import average
from ticket_bench.server import make_server


class AverageTest(unittest.TestCase):
    def test_average_of_two_numbers(self):
        self.assertEqual(average(2, 4), 3)

    def test_average_with_negatives_and_decimals(self):
        self.assertAlmostEqual(average(-1.5, 3.5), 1.0)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server(0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_index_page(self):
        html = urlopen(self.base + "/").read().decode()
        self.assertIn("<h1>Ticket Bench</h1>", html)

    def test_api_average(self):
        data = json.load(urlopen(self.base + "/api/average?a=10&b=20"))
        self.assertEqual(data, {"result": 15.0})

    def test_api_rejects_non_numbers(self):
        with self.assertRaises(HTTPError) as ctx:
            urlopen(self.base + "/api/average?a=x&b=2")
        self.assertEqual(ctx.exception.code, 400)

    def test_unknown_path_404(self):
        with self.assertRaises(HTTPError) as ctx:
            urlopen(self.base + "/nope")
        self.assertEqual(ctx.exception.code, 404)
