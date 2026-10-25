import asyncio

from order_agent import Conversation, FabraryError, pick


class FakeFabrary:
    """The app's order API with canned stages: drafts, then an offer, then printing."""

    def __init__(self):
        self.calls: list[str] = []
        self.o: dict = {}
        self.polls = 0

    async def new_session(self):
        self.calls.append("session")
        return "fabrary_session=s1"

    async def create(self, cookie, text):
        self.calls.append(f"create:{text}")
        self.o = {"id": "ord_1", "draft": {"stage": "generating_candidates", "revision": 1}}
        self.polls = 0
        return self.o

    async def order(self, cookie, order_id):
        self.polls += 1
        if self.o["draft"]["stage"] == "generating_candidates" and self.polls > 1:
            self.o["draft"]["stage"] = "awaiting_design_choice"
            self.o["candidates"] = {"id": "cset_1", "subject": "cat", "candidates": [
                {"id": f"cand_{i}", "title": f"cat · look {i}", "previewUrl": f"/assets/p{i}"} for i in (1, 2, 3)]}
        if self.o["draft"]["stage"] == "designing":
            self.o["draft"]["stage"] = "proposed"
            self.o["offer"] = {"id": "offer_1"}
            self.o["plan"] = {"version": 1, "digest": "d1", "payableCents": 325, "simulatedEstimateCents": 0,
                              "readyEstimateMinutes": 4, "collectionPoint": "our table",
                              "items": [{"name": "Cat sticker", "why": "You asked for a cat."}],
                              "assignments": [{"machineName": "Sticker counter", "executionMode": "hardware",
                                               "previewUrl": "/assets/print", "child": None}]}
        if self.o.get("makeIntent"):
            a = self.o["plan"]["assignments"][0]
            a["child"] = ({"productionState": "running"} if self.polls < 4
                          else {"productionState": "produced", "fulfillmentState": "ready_for_pickup",
                                "pickupCode": "4821"})
        return self.o

    async def choose(self, cookie, o, candidate_id):
        self.calls.append(f"choose:{candidate_id}")
        self.o["draft"]["stage"] = "designing"
        return self.o

    async def more(self, cookie, o):
        self.calls.append("more")
        return self.o

    async def confirm(self, cookie, o, key):
        self.calls.append(f"confirm:{o['offer']['id']}")
        self.o["makeIntent"] = {"status": "submitted"}
        self.polls = 0
        return self.o

    async def cancel(self, cookie, order_id):
        self.calls.append("cancel")
        return self.o

    async def share(self, cookie, path):
        return f"{path}?expires=1&sig=abc"


def run(convo, state, text):
    async def go():
        return [m async for m in convo.handle(state, text)]
    return asyncio.run(go())


def convo(api):
    return Conversation(api, "http://127.0.0.1:4318", daily_orders=2, poll_s=0, settle_s=5, track_s=5)


def test_a_chat_goes_from_request_to_drafts_to_offer_to_pickup_code():
    api, state = FakeFabrary(), {}
    c = convo(api)
    assert "Fabrary" in run(c, state, "hi")[0]

    drafts = run(c, state, "a cute cat sticker")
    assert api.calls[:2] == ["session", "create:a cute cat sticker"]
    # Previews go out as signed links: they open without this person's session.
    assert "[see it](http://127.0.0.1:4318/assets/p2?expires=1&sig=abc)" in drafts[-1] and "Reply **1**" in drafts[-1]

    offer = run(c, state, "2")
    assert "choose:cand_2" in api.calls
    assert "Sticker counter (real printer)" in offer[-1] and "$3.25" in offer[-1] and "Reply **yes**" in offer[-1]

    made = run(c, state, "yes")
    assert "confirm:offer_1" in api.calls
    assert made[0].startswith("Confirmed")
    assert any("Printing now on Sticker counter" in m for m in made)
    assert "Pickup code: **4821**" in made[-1]


def test_a_number_inside_a_new_request_is_not_a_draft_choice():
    assert pick("2", 3) == 2 and pick("#3", 3) == 3 and pick("the second one", 3) == 2
    assert pick("make 2 dog stickers", 3) is None and pick("4", 3) is None


def test_requests_are_capped_per_person_per_day():
    api, state = FakeFabrary(), {}
    c = convo(api)
    run(c, state, "a cat")
    run(c, state, "a dog")
    assert "daily limit" in run(c, state, "a fish")[0]
    assert sum(call.startswith("create:") for call in api.calls) == 2


def test_an_expired_session_starts_fresh_instead_of_failing():
    api, state = FakeFabrary(), {"cookie": "old", "order": "ord_gone"}
    known = api.order

    async def gone(cookie, order_id):
        if order_id == "ord_gone":
            raise FabraryError("Order not found")
        return await known(cookie, order_id)
    api.order = gone
    c = convo(api)
    assert "Fabrary" in run(c, state, "hello")[0]
    run(c, state, "status")  # no order any more: treated as a new request, with a new session
    assert "session" in api.calls


def test_the_asi_one_mention_in_front_of_each_message_is_ignored():
    api, state = FakeFabrary(), {}
    c = convo(api)
    at = "@agent1qtntl30zudzgdsjgke4jyjdknkrerr92n4ncl9askhn6mu788exhswdc4vy"
    assert "Fabrary" in run(c, state, f"{at} hi")[0]
    assert not any(call.startswith("create:") for call in api.calls), "a greeting makes no order"
    run(c, state, f"{at} a cute cat sticker")
    assert "create:a cute cat sticker" in api.calls
    run(c, state, f"{at} 2")
    assert "choose:cand_2" in api.calls
