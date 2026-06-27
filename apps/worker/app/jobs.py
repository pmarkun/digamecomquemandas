from .face_pipeline import run_face_pipeline


def process_job(url: str, width: int = 0, height: int = 0):
    return run_face_pipeline(url, width=width, height=height)
