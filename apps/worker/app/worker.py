import os
import time
from urllib.parse import urlencode

import httpx
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def api_base_url() -> str:
    return os.getenv("API_BASE_URL", "http://localhost:8000/api/v1").rstrip("/")


def web_base_url() -> str:
    return os.getenv("WEB_BASE_URL", "http://localhost:3000").rstrip("/")


def login(client: httpx.Client) -> str:
    response = client.post(
        f"{api_base_url()}/admin/login",
        json={
            "email": os.getenv("ADMIN_EMAIL", "admin@example.com"),
            "password": os.getenv("ADMIN_PASSWORD", "admin"),
        },
    )
    response.raise_for_status()
    return response.json()["token"]


def create_run(client: httpx.Client, token: str) -> dict:
    response = client.post(
        f"{api_base_url()}/admin/bootstrap-runs",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "limit_per_source": env_int("NEWS_CRON_LIMIT_PER_SOURCE", 5),
            "render_browser": env_bool("NEWS_CRON_RENDER_BROWSER", True),
            "skip_existing": True,
        },
    )
    response.raise_for_status()
    return response.json()


def process_run_in_browser(run_id: str, token: str) -> dict:
    query = urlencode(
        {
            "run_id": run_id,
            "token": token,
            "max_images": str(env_int("NEWS_CRON_MAX_IMAGES_PER_ARTICLE", 4)),
        }
    )
    processor_url = f"{web_base_url()}/admin/processor?{query}"
    timeout_ms = env_int("NEWS_CRON_PROCESS_TIMEOUT_SECONDS", 900) * 1000
    executable = os.getenv("ARTICLE_DISCOVERY_BROWSER_EXECUTABLE")
    launch_args: dict[str, object] = {"headless": True}
    if executable:
        launch_args["executable_path"] = executable

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_args)
        page = browser.new_page(locale="pt-BR", viewport={"width": 1366, "height": 900})
        page.goto(processor_url, wait_until="domcontentloaded", timeout=60_000)
        try:
            page.wait_for_function(
                "() => window.__DIGA_PROCESSOR__ && ['done', 'error'].includes(window.__DIGA_PROCESSOR__.status)",
                timeout=timeout_ms,
            )
        except PlaywrightTimeoutError:
            status = page.evaluate("window.__DIGA_PROCESSOR__ || null")
            browser.close()
            return {"status": "timeout", "processor": status}
        status = page.evaluate("window.__DIGA_PROCESSOR__")
        browser.close()
        return status


def run_once() -> dict:
    with httpx.Client(timeout=60.0) as client:
        token = login(client)
        run = create_run(client, token)
    if run["counts"]["articles"] == 0:
        return {"status": "done", "run_id": run["id"], "processed": 0, "total": 0}
    processor = process_run_in_browser(run["id"], token)
    return {"status": processor.get("status"), "run_id": run["id"], "processor": processor}


def run_loop() -> None:
    interval = env_int("NEWS_CRON_INTERVAL_SECONDS", 3600)
    while True:
        started = time.monotonic()
        try:
            print(run_once(), flush=True)
        except Exception as exc:
            print({"status": "error", "error": str(exc)}, flush=True)
        elapsed = time.monotonic() - started
        time.sleep(max(5, interval - elapsed))


if __name__ == "__main__":
    if env_bool("NEWS_CRON_RUN_ONCE", False):
        print(run_once(), flush=True)
    else:
        run_loop()
