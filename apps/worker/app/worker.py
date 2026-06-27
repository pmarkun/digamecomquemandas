import os
import time
from typing import Iterable

from .jobs import process_job


def _iter_jobs(lines: Iterable[str]) -> Iterable[dict]:
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        try:
            url, width, height = line.split("|")
            yield {"url": url, "width": int(width), "height": int(height)}
        except ValueError:
            yield {"url": line, "width": 0, "height": 0}


def run_once() -> None:
    # MVP de referência: sem broker real, mas com formato de consumidor de jobs por arquivo.
    queue_file = os.getenv("WORKER_QUEUE_FILE", "").strip()
    if queue_file:
        try:
            with open(queue_file, "r", encoding="utf-8") as fp:
                for payload in _iter_jobs(fp):
                    print(process_job(payload["url"], payload["width"], payload["height"]))
            return
        except FileNotFoundError:
            pass

    result = process_job("https://example.com/example.jpg", 0, 0)
    print(result)


def run_loop() -> None:
    queue_file = os.getenv("WORKER_QUEUE_FILE", "/tmp/diga-me-jobs.txt")
    poll_seconds = float(os.getenv("WORKER_POLL_SECONDS", "5"))
    while True:
        try:
            with open(queue_file, "r+", encoding="utf-8") as fp:
                lines = fp.readlines()
                fp.truncate(0)
                fp.seek(0)
            processed = 0
            for payload in _iter_jobs(lines):
                print(process_job(payload["url"], payload["width"], payload["height"]))
                processed += 1
            if processed == 0:
                time.sleep(poll_seconds)
        except FileNotFoundError:
            time.sleep(poll_seconds)


if __name__ == "__main__":
    if os.getenv("WORKER_LOOP") == "1":
        run_loop()
    else:
        run_once()
