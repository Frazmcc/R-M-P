"""End-to-end behaviour tests for the moderation and voting API."""
from io import BytesIO
from PIL import Image
from fastapi.testclient import TestClient
from app import create_app

ADMIN = {"X-Admin-Token": "secure-moderator-test-key"}
VISITOR = {"X-Voter-ID": "11111111-1111-4111-8111-111111111111"}

def make_image(color=(110, 61, 40)):
    image = Image.new("RGB", (160, 120), color)
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()

def client(tmp_path):
    application = create_app(
        database_url="sqlite:///" + str(tmp_path / "test.db"),
        admin_token="secure-moderator-test-key",
        secret_key="a-test-hmac-secret",
    )
    return TestClient(application)

def post_photo(c, data=None, photo=None):
    fields={"title":"The Great Escape","nickname":"Sample","agree":"true"}
    if data:fields.update(data)
    return c.post("/api/upload", data=fields, files={
        "photo":("submission.png", photo or make_image(), "image/png")})

def test_full_submission_moderation_voting_and_reporting(tmp_path):
    c=client(tmp_path)
    assert c.get("/api/health").json()["status"]=="ok"
    assert c.get("/api/items").json()["total"]==0
    response=post_photo(c)
    assert response.status_code==202, response.text
    entry=response.json()["id"]
    assert c.get(f"/api/images/{entry}").status_code==404
    assert c.get("/api/admin/pending").status_code==403
    assert len(c.get("/api/admin/pending",headers=ADMIN).json())==1
    assert c.get(f"/api/admin/image/{entry}",headers=ADMIN).headers["content-type"]=="image/webp"
    assert c.post(f"/api/admin/{entry}/approve",headers=ADMIN).status_code==200
    listed=c.get("/api/items?sort=top").json()
    assert listed["total"]==1
    assert listed["items"][0]["title"]=="The Great Escape"
    assert c.get(f"/api/images/{entry}").content[:4]==b"RIFF"
    assert c.post(f"/api/vote/{entry}",data={"score":"9"},headers=VISITOR).status_code==200
    assert c.post(f"/api/vote/{entry}",data={"score":"3"},headers=VISITOR).status_code==409
    listed=c.get("/api/items?sort=bottom").json()
    assert listed["items"][0]["average"]==9.0
    assert listed["items"][0]["votes"]==1
    assert c.post(f"/api/report/{entry}",data={"reason":"Please review this image"},headers=VISITOR).status_code==202
    assert len(c.get("/api/admin/reports",headers=ADMIN).json())==1
    assert c.post(f"/api/admin/{entry}/feature",headers=ADMIN).status_code==200
    assert len(c.get("/api/items?sort=featured").json()["items"])==1
    assert c.post(f"/api/admin/{entry}/remove",headers=ADMIN).status_code==200
    assert c.get(f"/api/images/{entry}").status_code==404
    assert c.get("/api/items").json()["total"]==0

def test_invalid_uploads_and_preapproval_voting_are_blocked(tmp_path):
    c=client(tmp_path)
    assert post_photo(c,{"agree":"false"}).status_code==400
    assert post_photo(c,{"title":"x"}).status_code==400
    assert post_photo(c,{"website":"hidden-spam"}).status_code==400
    bad=c.post("/api/upload",data={"title":"Bad photo","agree":"true"},files={
        "photo":("not-image.png",b"not an image","image/png")})
    assert bad.status_code==400
    entry=post_photo(c).json()["id"]
    assert c.post(f"/api/vote/{entry}",data={"score":"8"},headers=VISITOR).status_code==404
    assert c.post(f"/api/admin/{entry}/reject",headers=ADMIN).status_code==200
    assert c.get(f"/api/admin/image/{entry}",headers=ADMIN).status_code==404

def test_duplicate_and_daily_submission_limits(tmp_path):
    c=client(tmp_path)
    assert post_photo(c).status_code==202
    assert post_photo(c).status_code==409
    for n in range(1,5):
        assert post_photo(c,photo=make_image((110+n*25,61,40))).status_code==202
    assert post_photo(c,photo=make_image((240,61,40))).status_code==429

def test_cors_and_vote_validation(tmp_path):
    c=client(tmp_path)
    preflight=c.options("/api/upload",headers={
        "Origin":"https://frazmcc.github.io",
        "Access-Control-Request-Method":"POST",
        "Access-Control-Request-Headers":"content-type"})
    assert preflight.headers.get("access-control-allow-origin")=="https://frazmcc.github.io"
    eid=post_photo(c).json()["id"]
    c.post(f"/api/admin/{eid}/approve",headers=ADMIN)
    assert c.post(f"/api/vote/{eid}",data={"score":"11"},headers=VISITOR).status_code==400
    assert c.post(f"/api/vote/{eid}",data={"score":"7"},headers={"X-Voter-ID":"not-a-uuid"}).status_code==400
    assert c.get("/api/items?sort=bogus").status_code==400
