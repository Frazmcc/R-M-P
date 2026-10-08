"""Moderated Rate My Poo API and static web server."""
import hashlib
import hmac
import io
import os
import re
import secrets
import time
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

MAX_UPLOAD = 6 * 1024 * 1024
MAX_PIXELS = 20_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
ROOT = os.path.dirname(os.path.abspath(__file__))

class Base(DeclarativeBase):
    pass

class Entry(Base):
    __tablename__ = "entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(90), nullable=False)
    nickname: Mapped[str] = mapped_column(String(35), nullable=False, default="Anonymous")
    created: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending", index=True)
    featured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    image_sha: Mapped[str] = mapped_column(String(64), index=True)
    ip_hash: Mapped[str] = mapped_column(String(64), index=True)

class Vote(Base):
    __tablename__ = "votes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("entries.id"), nullable=False)
    voter_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("entry_id", "voter_hash"),)

class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("entries.id"), nullable=False)
    reporter_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)
    created: Mapped[int] = mapped_column(BigInteger, nullable=False)
    __table_args__ = (UniqueConstraint("entry_id", "reporter_hash"),)

def create_app(database_url=None, admin_token=None, secret_key=None):
    if database_url is None and os.getenv("RENDER") and not os.getenv("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL must be configured for Render; refusing ephemeral storage")
    database_url = database_url or os.getenv("DATABASE_URL", "sqlite:///./rmp-dev.sqlite3")
    if database_url.startswith("postgres://"):
        database_url = "postgresql+psycopg://" + database_url[len("postgres://"):]
    if database_url.startswith("postgresql://"):
        database_url = "postgresql+psycopg://" + database_url[len("postgresql://"):]
    admin_token = admin_token if admin_token is not None else os.getenv("RMP_ADMIN_TOKEN", "")
    secret_key = secret_key or os.getenv("RMP_SECRET_KEY") or secrets.token_hex(32)
    origins = [x.strip() for x in os.getenv("RMP_ALLOWED_ORIGINS", "https://frazmcc.github.io,https://rate-my-poo.com,https://www.rate-my-poo.com,http://localhost:8000,http://127.0.0.1:8000").split(",") if x.strip()]
    engine = create_engine(database_url, connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {}, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    api = FastAPI(title="Rate My Poo", docs_url=None, redoc_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "X-Voter-ID", "X-Admin-Token"])
    api.mount("/static", StaticFiles(directory=os.path.join(ROOT, "static")), name="static")

    def fingerprint(value):
        return hmac.new(secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()

    def ip_of(request):
        # Render terminates HTTPS and sets X-Forwarded-For; use the final proxy-reported address.
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[-1].strip() if forwarded else (request.client.host if request.client else "unknown")

    def auth(token):
        if not admin_token or not token or not hmac.compare_digest(admin_token, token):
            raise HTTPException(403, "Moderator credentials incorrect or not configured")

    def public_row(row):
        return {"id": row.id, "title": row.title, "nickname": row.nickname,
                "created": row.created, "featured": bool(row.featured),
                "votes": int(row.votes), "average": round(float(row.average or 0), 1),
                "image": f"/api/images/{row.id}"}

    def summary_query():
        return (select(Entry.id, Entry.title, Entry.nickname, Entry.created, Entry.featured,
                       func.count(Vote.id).label("votes"), func.avg(Vote.score).label("average"))
                .outerjoin(Vote, Vote.entry_id == Entry.id).where(Entry.status == "approved")
                .group_by(Entry.id))

    def optimize_image(raw, claimed_type):
        if claimed_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(400, "Only JPEG, PNG and WebP images are permitted")
        try:
            with Image.open(io.BytesIO(raw)) as im:
                if im.format not in ("JPEG", "PNG", "WEBP"):
                    raise ValueError("Invalid file format")
                im.verify()
            with Image.open(io.BytesIO(raw)) as im:
                if im.width * im.height > MAX_PIXELS or min(im.size) < 64:
                    raise ValueError("Unsupported image dimensions")
                im = ImageOps.exif_transpose(im)
                im.thumbnail((1400, 1400))
                output = io.BytesIO()
                im.convert("RGB").save(output, "WEBP", quality=78, method=4)
                return output.getvalue()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            raise HTTPException(400, "Image could not be validated") from exc

    def voter(request, voter_id):
        if not voter_id or not re.fullmatch(r"[0-9a-fA-F-]{36}", voter_id):
            raise HTTPException(400, "A valid anonymous visitor identifier is required")
        # A random per-browser ID, hashed before storage. Not strong authentication.
        return fingerprint(voter_id.lower())

    @api.get("/")
    def home():
        return FileResponse(os.path.join(ROOT, "index.html"))

    @api.get("/config.js")
    def config():
        return Response("window.RMP_API_BASE = window.location.origin;", media_type="application/javascript")

    @api.get("/api/health")
    def health():
        with Session() as db:
            db.execute(select(func.count()).select_from(Entry)).scalar_one()
        return {"status": "ok"}

    @api.get("/api/items")
    def items(sort: str = "new", q: str = "", limit: int = 20):
        if sort not in ("new", "top", "bottom", "featured") or not 1 <= limit <= 100:
            raise HTTPException(400, "Invalid gallery options")
        stmt = summary_query()
        if sort == "featured":
            stmt = stmt.where(Entry.featured.is_(True))
        if q:
            safe_q = q.strip()[:80].replace("%", r"\%").replace("_", r"\_")
            stmt = stmt.where(Entry.title.ilike(f"%{safe_q}%", escape="\\"))
        if sort == "top":
            stmt = stmt.order_by(func.avg(Vote.score).desc().nullslast(), func.count(Vote.id).desc(), Entry.created.desc())
        elif sort == "bottom":
            stmt = stmt.order_by(func.avg(Vote.score).asc().nullslast(), Entry.created.desc())
        else:
            stmt = stmt.order_by(Entry.created.desc())
        with Session() as db:
            rows = db.execute(stmt.limit(limit)).all()
            total = db.scalar(select(func.count()).select_from(Entry).where(Entry.status == "approved"))
        return {"items": [public_row(x) for x in rows], "total": total}

    @api.get("/api/images/{entry_id}")
    def image(entry_id: int):
        with Session() as db:
            entry = db.get(Entry, entry_id)
            if not entry or entry.status != "approved" or not entry.image:
                raise HTTPException(404, "Photo not available")
            return Response(entry.image, media_type="image/webp",
                            headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})

    @api.post("/api/upload", status_code=202)
    async def upload(request: Request, title: str = Form(...), nickname: str = Form("Anonymous"),
                     agree: bool = Form(False), website: str = Form(""),
                     photo: UploadFile = File(...)):
        if website:
            raise HTTPException(400, "Invalid submission")
        if not agree:
            raise HTTPException(400, "You must confirm ownership, consent and age")
        title = title.strip()
        nickname = nickname.strip() or "Anonymous"
        if not 3 <= len(title) <= 90 or len(nickname) > 35 or any(ord(c) < 32 for c in title + nickname):
            raise HTTPException(400, "Invalid title or nickname")
        raw = await photo.read(MAX_UPLOAD + 1)
        if not raw or len(raw) > MAX_UPLOAD:
            raise HTTPException(413, "Image must be under 6 MB")
        clean = optimize_image(raw, photo.content_type)
        image_sha = hashlib.sha256(clean).hexdigest()
        ip_hash = fingerprint(ip_of(request))
        now = int(time.time())
        with Session() as db:
            recent = db.scalar(select(func.count()).select_from(Entry).where(
                Entry.ip_hash == ip_hash, Entry.created > now - 86400))
            if recent >= 5:
                raise HTTPException(429, "Daily submission limit reached; try again tomorrow")
            duplicate = db.scalar(select(Entry.id).where(Entry.image_sha == image_sha, Entry.status != "rejected"))
            if duplicate:
                raise HTTPException(409, "This photo has already been submitted")
            entry = Entry(title=title, nickname=nickname, created=now, status="pending",
                          image=clean, image_sha=image_sha, ip_hash=ip_hash)
            db.add(entry)
            db.commit()
            return {"id": entry.id, "message": "Photo received. It will appear after moderator approval."}

    @api.post("/api/vote/{entry_id}")
    def vote(entry_id: int, request: Request, score: int = Form(...),
             x_voter_id: str | None = Header(None)):
        if not 1 <= score <= 10:
            raise HTTPException(400, "Vote must be between 1 and 10")
        hashed = voter(request, x_voter_id)
        with Session() as db:
            entry = db.get(Entry, entry_id)
            if not entry or entry.status != "approved":
                raise HTTPException(404, "Photo not available")
            db.add(Vote(entry_id=entry_id, voter_hash=hashed, score=score))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(409, "You have already rated this photo")
        return {"message": "Vote saved"}

    @api.post("/api/report/{entry_id}", status_code=202)
    def report(entry_id: int, request: Request, reason: str = Form(...),
               x_voter_id: str | None = Header(None)):
        hashed = voter(request, x_voter_id)
        reason = reason.strip()
        if not 5 <= len(reason) <= 200:
            raise HTTPException(400, "Please provide a reason (5–200 characters)")
        with Session() as db:
            entry = db.get(Entry, entry_id)
            if not entry or entry.status != "approved":
                raise HTTPException(404, "Photo not available")
            db.add(Report(entry_id=entry_id, reporter_hash=hashed, reason=reason, created=int(time.time())))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                raise HTTPException(409, "You have already reported this photo")
        return {"message": "Report received for moderator review"}

    @api.get("/api/admin/pending")
    def pending(x_admin_token: str | None = Header(None)):
        auth(x_admin_token)
        with Session() as db:
            rows = db.scalars(select(Entry).where(Entry.status == "pending").order_by(Entry.created.asc()).limit(100)).all()
            return [{"id": x.id, "title": x.title, "nickname": x.nickname, "created": x.created} for x in rows]

    @api.get("/api/admin/approved")
    def approved(x_admin_token: str | None = Header(None)):
        auth(x_admin_token)
        with Session() as db:
            rows = db.execute(summary_query().order_by(Entry.created.desc()).limit(100)).all()
            return [public_row(x) for x in rows]

    @api.get("/api/admin/reports")
    def reports(x_admin_token: str | None = Header(None)):
        auth(x_admin_token)
        with Session() as db:
            rows = db.execute(select(Report.id, Report.entry_id, Report.reason, Report.created).order_by(Report.created.desc()).limit(100)).all()
            return [{"id": x.id, "entry_id": x.entry_id, "reason": x.reason, "created": x.created} for x in rows]

    @api.post("/api/admin/reports/{report_id}/dismiss")
    def dismiss_report(report_id: int, x_admin_token: str | None = Header(None)):
        auth(x_admin_token)
        with Session() as db:
            report = db.get(Report, report_id)
            if not report:
                raise HTTPException(404, "Report not found")
            db.delete(report)
            db.commit()
        return {"message": "Report dismissed"}

    @api.get("/api/admin/image/{entry_id}")
    def admin_image(entry_id: int, x_admin_token: str | None = Header(None)):
        auth(x_admin_token)
        with Session() as db:
            entry = db.get(Entry, entry_id)
            if not entry or not entry.image:
                raise HTTPException(404, "Photo not available")
            return Response(entry.image, media_type="image/webp",
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    @api.post("/api/admin/{entry_id}/{action}")
    def moderate(entry_id: int, action: str, x_admin_token: str | None = Header(None)):
        auth(x_admin_token)
        if action not in ("approve", "reject", "feature", "unfeature", "remove"):
            raise HTTPException(400, "Unknown moderation action")
        with Session() as db:
            entry = db.get(Entry, entry_id)
            if not entry:
                raise HTTPException(404, "Photo not found")
            if action == "approve" and entry.status == "pending":
                entry.status = "approved"
            elif action in ("reject", "remove"):
                entry.status = "rejected"
                entry.image = None
                entry.featured = False
                for record in db.scalars(select(Report).where(Report.entry_id == entry_id)).all():
                    db.delete(record)
            elif action in ("feature", "unfeature") and entry.status == "approved":
                entry.featured = action == "feature"
            else:
                raise HTTPException(409, "Action not valid for this entry")
            db.commit()
        return {"message": action + " complete"}

    return api

app = create_app()
