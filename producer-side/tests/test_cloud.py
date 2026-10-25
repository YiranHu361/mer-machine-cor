import json
from hub.cloud import Journal, substitute


def test_journal_survives_restart_and_does_not_redeliver_a_physical_task(tmp_path):
    path = tmp_path / "producer.sqlite"
    first = Journal(path)
    assert first.begin("attempt1")
    first.event("job.accept", {"job_id": "attempt1"})
    first.db.close()
    recovered = Journal(path)
    recovered.recover()
    assert not recovered.begin("attempt1")
    events = [json.loads(row[0]) for row in recovered.db.execute("SELECT body FROM events")]
    assert events[-1]["data"]["state"] == "needs_review"
    assert json.loads(recovered.db.execute("SELECT result FROM tasks").fetchone()[0])["error"]
    recovered.db.close()


def test_paths_are_replaced_without_interpreting_other_strings():
    assert substitute({"photos": [{"path": "/cloud/a"}], "text": "hello"}, {"/cloud/a": "/local/input"}) == {
        "photos": [{"path": "/local/input"}], "text": "hello"}
