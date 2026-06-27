import json
import os
from pathlib import Path

from sqlmodel import Session, select

from .config import get_settings
from .db import engine, init_db
from .models import AllowedDomain, FaceEmbedding, Person, PersonReferenceImage
from .services.match import embedding_from_seed
from .services.privacy import hash_sha256


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
    seed_path = Path(__file__).resolve().parents[3] / "infra" / "seed" / "people.json"
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
                existing_ref = session.exec(
                    select(PersonReferenceImage).where(
                        PersonReferenceImage.person_id == person.id, PersonReferenceImage.source_url == ref_url
                    )
                ).first()
                if existing_ref:
                    continue

                ref = PersonReferenceImage(person_id=person.id, source_url=ref_url, sha256=hash_sha256(ref_url))
                session.add(ref)
                session.flush()

                session.add(
                    FaceEmbedding(
                        person_id=person.id,
                        reference_image_id=ref.id,
                        embedding=embedding_from_seed(ref_url),
                        embedding_vector=embedding_from_seed(ref_url),
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
