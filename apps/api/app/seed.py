import json
import os
from pathlib import Path

from sqlmodel import Session, select

from .config import get_settings
from .db import engine, init_db
from .models import AllowedDomain, FaceEmbedding, Person, PersonReferenceImage
from .services.image_fetcher import fetch_image
from .services.match import embedding_from_image


ALLOWED_DOMAINS = [
    "g1.globo.com",
    "oglobo.globo.com",
    "www1.folha.uol.com.br",
    "www.estadao.com.br",
    "noticias.uol.com.br",
    "www.cnnbrasil.com.br",
    "www.metropoles.com",
    "www.poder360.com.br",
    "www.cartacapital.com.br",
    "www.brasildefato.com.br",
]


def seed_initial_people() -> None:
    settings = get_settings()
    seed_path = Path(settings.seed_people_path).expanduser() if settings.seed_people_path else None
    if seed_path is None:
        repo_seed_path = Path(__file__).resolve().parents[3] / "infra" / "seed" / "people.json"
        package_seed_path = Path(__file__).resolve().parents[1] / "seed" / "people.json"
        seed_path = repo_seed_path if repo_seed_path.exists() else package_seed_path
    with open(seed_path, "r", encoding="utf-8") as fp:
        payload = json.load(fp)

    with Session(engine) as session:
        for domain in ALLOWED_DOMAINS:
            existing = session.exec(select(AllowedDomain).where(AllowedDomain.domain == domain)).first()
            if not existing:
                session.add(AllowedDomain(domain=domain))

        for item in payload:
            existing = session.exec(select(Person).where(Person.slug == item["slug"])).first()
            if existing:
                person = existing
            else:
                person = Person(
                    name=item["name"],
                    slug=item["slug"],
                    display_name=item["name"],
                    category=item["category"],
                    description=item.get("description"),
                    public_office=item.get("public_office"),
                    source_urls=item.get("source_urls", []),
                )
                session.add(person)
                session.flush()

            for ref_url in item.get("reference_images", []):
                fetched = fetch_image(ref_url)
                embedding = embedding_from_image(ref_url, fetched.content)
                existing_ref = session.exec(
                    select(PersonReferenceImage).where(
                        PersonReferenceImage.person_id == person.id, PersonReferenceImage.source_url == ref_url
                    )
                ).first()
                if existing_ref:
                    ref = existing_ref
                    ref.sha256 = fetched.sha256
                    ref.phash = fetched.phash
                    session.add(ref)
                else:
                    ref = PersonReferenceImage(
                        person_id=person.id,
                        source_url=ref_url,
                        sha256=fetched.sha256,
                        phash=fetched.phash,
                    )
                    session.add(ref)
                    session.flush()

                existing_embedding = session.exec(
                    select(FaceEmbedding).where(FaceEmbedding.reference_image_id == ref.id)
                ).first()
                if existing_embedding:
                    existing_embedding.embedding = embedding
                    existing_embedding.embedding_vector = embedding
                    existing_embedding.model_name = "buffalo_l"
                    existing_embedding.model_version = "0.1"
                    session.add(existing_embedding)
                else:
                    session.add(
                        FaceEmbedding(
                            person_id=person.id,
                            reference_image_id=ref.id,
                            embedding=embedding,
                            embedding_vector=embedding,
                            model_name="buffalo_l",
                            model_version="0.1",
                        )
                )

        session.commit()


def run_seed() -> None:
    init_db()
    seed_initial_people()


if __name__ == "__main__":
    run_seed()
