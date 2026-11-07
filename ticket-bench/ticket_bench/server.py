import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from ticket_bench.average import average

INDEX = Path(__file__).with_name("index.html")


def parse_number(query, name):
    return float(query.get(name, [""])[0])


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            self._send(200, "text/html; charset=utf-8", INDEX.read_bytes())
        elif url.path == "/api/average":
            query = parse_qs(url.query)
            try:
                payload = {"result": average(parse_number(query, "a"), parse_number(query, "b"))}
                status = 200
            except ValueError:
                payload, status = {"error": "a and b must be numbers"}, 400
            self._send(status, "application/json", json.dumps(payload).encode())
        else:
            self.send_error(404)

    def log_message(self, *args):
        pass


def make_server(port=8000):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Ticket Bench running at http://127.0.0.1:{port}/")
    make_server(port).serve_forever()
