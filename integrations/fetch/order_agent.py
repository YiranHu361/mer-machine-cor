"""Fabrary on Agentverse: chat in ASI:One to have something made on a real printer.

The agent speaks the Agent Chat Protocol. Each person who chats gets their own
requester session on the Fabrary app, and the conversation drives the same order
flow as /make: describe it -> choose one of three drafts when new art is drawn ->
confirm the exact offer (mock payment) -> printing -> pickup code.

It runs next to the app (it calls FABRARY_API_ORIGIN, http://127.0.0.1:4318 by
default) and reaches Agentverse through its mailbox, so nothing here is public.

    integrations/fetch/.venv/bin/python integrations/fetch/order_agent.py
"""
from __future__ import annotations

import asyncio
import os
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Any, AsyncIterator

import httpx

ROOT = Path(__file__).resolve().parents[2]
README = Path(__file__).with_name("AGENT_README.md")
DESCRIPTION = (
    "Describe something and Fabrary draws it, picks the best free real printer "
    "(a sticker printer or an Instax photo printer) and makes it, then gives you a pickup code."
)
INTRO = (
    "Hi! I'm **Fabrary**. Tell me what you'd like made, for example *a cute cat sticker* "
    "or *a colourful dragon print*. I'll draw a few options, pick the best free real printer "
    "and give you a pickup code. Payment is a mock: nothing is charged."
)
GREETINGS = {"hi", "hello", "hey", "help", "start", "?"}
YES = {"yes", "y", "yep", "confirm", "ok", "okay", "sure", "go", "make it", "pay", "do it"}
NO = {"no", "n", "nope", "not now"}
MORE = {"more", "more like this", "other options", "others", "again"}
ORDINALS = {"first": 1, "second": 2, "third": 3, "one": 1, "two": 2, "three": 3}
# Stages where the order waits for the person, or cannot go on.
SETTLED = {"awaiting_design_choice", "proposed", "unavailable", "failed", "needs_clarification", "superseded"}


class FabraryError(Exception):
    pass


class Fabrary:
    """The app's order API as one requester; every rule is still the backend's."""

    def __init__(self, origin: str, transport: httpx.AsyncBaseTransport | None = None):
        self.origin, self.transport = origin.rstrip("/"), transport

    async def _call(self, method: str, path: str, cookie: str | None = None, body: Any = None,
                    headers: dict[str, str] | None = None) -> httpx.Response:
        async with httpx.AsyncClient(base_url=self.origin, timeout=60, transport=self.transport) as client:
            return await client.request(method, path, json=body,
                                        headers={**({"Cookie": cookie} if cookie else {}), **(headers or {})})

    async def _json(self, method: str, path: str, cookie: str, body: Any = None,
                    headers: dict[str, str] | None = None) -> dict:
        r = await self._call(method, path, cookie, body, headers)
        data = r.json() if r.content else {}
        if r.status_code >= 400:
            raise FabraryError((data.get("error") or {}).get("message") or f"HTTP {r.status_code}")
        return data

    async def new_session(self) -> str:
        r = await self._call("POST", "/api/session", body={"role": "requester"})
        cookie = r.headers.get("set-cookie", "").split(";")[0]
        if r.status_code >= 400 or not cookie:
            raise FabraryError("could not open a session")
        return cookie

    async def order(self, cookie: str, order_id: str) -> dict:
        return (await self._json("GET", f"/api/orders/{order_id}", cookie))["order"]

    async def create(self, cookie: str, text: str) -> dict:
        body = {"requestText": text, "photoAssetIds": [], "experience": "best_single"}
        return (await self._json("POST", "/api/orders", cookie, body, {"Idempotency-Key": uuid.uuid4().hex}))["order"]

    async def choose(self, cookie: str, o: dict, candidate_id: str) -> dict:
        body = {"expectedRevision": o["draft"]["revision"], "candidateSetId": o["candidates"]["id"],
                "candidateId": candidate_id}
        return (await self._json("POST", f"/api/orders/{o['id']}/design-choice", cookie, body))["order"]

    async def more(self, cookie: str, o: dict) -> dict:
        body = {"expectedRevision": o["draft"]["revision"], "candidateSetId": o["candidates"]["id"]}
        return (await self._json("POST", f"/api/orders/{o['id']}/more-like-this", cookie, body))["order"]

    async def confirm(self, cookie: str, o: dict, key: str) -> dict:
        body = {"offerId": o["offer"]["id"], "planVersion": o["plan"]["version"], "planDigest": o["plan"]["digest"],
                "permission": True, "consent": {"payment": True, "production": True}, "idempotencyKey": key}
        return (await self._json("POST", f"/api/orders/{o['id']}/confirm", cookie, body))["order"]

    async def cancel(self, cookie: str, order_id: str) -> dict:
        return (await self._json("POST", f"/api/orders/{order_id}/cancel", cookie, {}))["order"]

    async def share(self, cookie: str, path: str) -> str:
        """/assets/<id> -> a 10-minute signed link that opens without this session."""
        asset_id = path.rstrip("/").split("/")[-1].split("?")[0]
        return (await self._json("POST", f"/api/assets/{asset_id}/link", cookie, {}))["url"]


def usd(cents: int) -> str:
    return f"${cents / 100:.2f}"


def pick(text: str, count: int) -> int | None:
    """'2', '#3', 'option 1', 'the second one' -> a 1-based choice. Only a message that is
    just the choice counts, so "make 2 dog stickers" stays a new request."""
    if m := re.fullmatch(r"(?:#|no\.?\s*|number\s+|option\s+|draft\s+)?([1-9])", text):
        n = int(m.group(1))
    elif m := re.fullmatch(r"(?:the\s+)?(first|second|third|one|two|three)(?:\s+one)?", text):
        n = ORDINALS[m.group(1)]
    else:
        return None
    return n if 1 <= n <= count else None


class Conversation:
    """One person's chat as an order. `state` is saved per sender between messages."""

    def __init__(self, api: Fabrary, public_origin: str, daily_orders: int = 5, poll_s: float = 2.0,
                 settle_s: float = 150, track_s: float = 300):
        self.api, self.public = api, public_origin.rstrip("/")
        self.daily_orders, self.poll_s, self.settle_s, self.track_s = daily_orders, poll_s, settle_s, track_s

    async def link(self, state: dict, path: str) -> str:
        """Previews are private to this person's session; a signed link opens anywhere for 10 minutes."""
        try:
            path = await self.api.share(await self._cookie(state), path)
        except FabraryError:
            pass
        return f"{self.public}{path}"

    async def _cookie(self, state: dict) -> str:
        if not state.get("cookie"):
            state["cookie"] = await self.api.new_session()
        return state["cookie"]

    async def _current(self, state: dict) -> dict | None:
        if not state.get("order"):
            return None
        try:
            return await self.api.order(await self._cookie(state), state["order"])
        except FabraryError:
            state.pop("order", None)  # an expired session or a deleted order: start fresh
            state.pop("cookie", None)
            return None

    async def _settle(self, state: dict) -> dict:
        cookie, deadline = await self._cookie(state), asyncio.get_running_loop().time() + self.settle_s
        while True:
            o = await self.api.order(cookie, state["order"])
            if o["draft"]["stage"] in SETTLED or o.get("makeIntent"):
                return o
            if asyncio.get_running_loop().time() > deadline:
                return o
            await asyncio.sleep(self.poll_s)

    async def describe(self, state: dict, o: dict) -> str:
        stage, plan = o["draft"]["stage"], o.get("plan")
        if o.get("makeIntent") and plan:
            return self._progress(o) or "Confirmed. It is being made."
        if stage == "awaiting_design_choice":
            c = o["candidates"]
            lines = [f"Here are drafts for your **{c['subject']}**:"]
            lines += [f"{i}. **{d['title']}**: [see it]({await self.link(state, d['previewUrl'])})"
                      for i, d in enumerate(c["candidates"], 1)]
            lines.append(f"Reply **1**–**{len(c['candidates'])}** to choose one, or **more** for other options.")
            return "\n".join(lines)
        if stage == "proposed" and plan:
            item, a = plan["items"][0], plan["assignments"][0]
            real = a["executionMode"] == "hardware"
            price = (f"{usd(plan['payableCents'])} (mock payment, nothing is charged)" if plan["payableCents"]
                     else f"{usd(plan['simulatedEstimateCents'])} (simulated, nothing is charged)")
            return "\n".join([
                f"**{item['name']}**: {item['why']}",
                f"Made on: {a['machineName']} ({'real printer' if real else 'simulated, nothing physical'})",
                f"Price: {price}",
                f"Ready in about {plan['readyEstimateMinutes']} min · pickup at {plan['collectionPoint']}",
                f"Exact preview: [see it]({await self.link(state, a['previewUrl'])})",
                "",
                "Reply **yes** to make it, or tell me what to change.",
            ])
        reason = o["draft"].get("reason") or (o.get("intent") or {}).get("question") or "No machine can make it right now."
        return f"I can't make that right now: {reason}\nTry again in a minute, or describe something else."

    def _progress(self, o: dict) -> str | None:
        plan = o.get("plan") or {}
        for a in plan.get("assignments", []):
            c = a.get("child") or {}
            if c.get("pickupCode") or c.get("fulfillmentState") == "ready_for_pickup":
                code = f" Pickup code: **{c['pickupCode']}**." if c.get("pickupCode") else ""
                return f"Done! It's ready for pickup at {plan.get('collectionPoint', 'the workshop')}.{code}"
            if c.get("fulfillmentState") == "awaiting_owner":
                return "Made! The workshop is getting it ready for pickup."
            if c.get("productionState") == "failed":
                return "It could not be made this time; nothing was charged. Try again in a minute."
            if c.get("productionState") in ("dispatched", "running"):
                return f"Printing now on {a['machineName']}…"
        return None

    async def _track(self, state: dict) -> AsyncIterator[str]:
        """After confirming: say each change until it is ready, failed, or time runs out."""
        cookie, last = await self._cookie(state), None
        deadline = asyncio.get_running_loop().time() + self.track_s
        while asyncio.get_running_loop().time() < deadline:
            line = self._progress(await self.api.order(cookie, state["order"]))
            if line and line != last:
                last = line
                yield line
                if line.startswith(("Done!", "It could not")):
                    return
            await asyncio.sleep(self.poll_s)
        yield "Still working on it. Send **status** any time for an update."

    def _quota_ok(self, state: dict) -> bool:
        today = date.today().isoformat()
        if state.get("day") != today:
            state["day"], state["count"] = today, 0
        return state["count"] < self.daily_orders

    async def handle(self, state: dict, text: str) -> AsyncIterator[str]:
        # ASI:One puts "@<agent address or handle>" in front of each message.
        t = re.sub(r"^\s*(?:@\S+[\s,:]*)+", "", text).strip()
        low = re.sub(r"[.!]+$", "", t.lower())
        if not t or low in GREETINGS:
            yield INTRO
            return
        if low in {"new", "start over", "reset"}:
            state.pop("order", None)
            yield "Okay, what should I make?"
            return
        o = await self._current(state)
        if o and low in {"status", "update", "where is it"}:
            yield await self.describe(state, o)
            return
        if o and low in {"cancel", "stop"} and not o.get("makeIntent"):
            await self.api.cancel(await self._cookie(state), o["id"])
            state.pop("order", None)
            yield "Cancelled. Nothing was made or charged. What else should I make?"
            return
        stage = o["draft"]["stage"] if o else None
        if o and stage == "awaiting_design_choice":
            drafts = o["candidates"]["candidates"]
            choice = pick(low, len(drafts))
            if choice:
                await self.api.choose(await self._cookie(state), o, drafts[choice - 1]["id"])
                yield f"Great choice: **{drafts[choice - 1]['title']}**. Preparing the exact print file…"
                yield await self.describe(state, await self._settle(state))
                return
            if low in MORE:
                await self.api.more(await self._cookie(state), o)
                yield "Drawing other options…"
                yield await self.describe(state, await self._settle(state))
                return
        if o and stage == "proposed" and not o.get("makeIntent"):
            if low in YES:
                state["confirm_key"] = state.get("confirm_key") or uuid.uuid4().hex
                await self.api.confirm(await self._cookie(state), o, state["confirm_key"])
                yield "Confirmed! Sending it to the printer…"
                async for line in self._track(state):
                    yield line
                return
            if low in NO:
                yield "No problem. Tell me what to change, or describe something else."
                return
        # Anything else is a new request.
        if not self._quota_ok(state):
            yield f"You've made {self.daily_orders} requests today, the daily limit. Come back tomorrow!"
            return
        o = await self.api.create(await self._cookie(state), t)
        state.update(order=o["id"], confirm_key=None, count=state["count"] + 1)
        yield f"On it! Working out how to make *{t[:120]}*…"
        yield await self.describe(state, await self._settle(state))


def build_agent():
    from dotenv import load_dotenv
    from uagents import Agent, Context, Protocol
    from uagents_core.contrib.protocols.chat import (
        ChatAcknowledgement,
        ChatMessage,
        StartSessionContent,
        TextContent,
        chat_protocol_spec,
    )

    load_dotenv(ROOT / ".env")  # fills only what the shell has not set
    seed = os.environ.get("FABRARY_AGENT_SEED")
    if not seed:
        raise SystemExit("FABRARY_AGENT_SEED is missing in .env: it keeps the agent's address the same.")
    origin = os.environ.get("FABRARY_API_ORIGIN", "http://127.0.0.1:4318")
    convo = Conversation(Fabrary(origin), os.environ.get("FABRARY_PUBLIC_ORIGIN", origin),
                         daily_orders=int(os.environ.get("FABRARY_AGENT_DAILY_ORDERS", "5")))
    agent = Agent(name="Fabrary", seed=seed, port=int(os.environ.get("FABRARY_AGENT_PORT", "8011")),
                  mailbox=True, description=DESCRIPTION, readme_path=str(README),
                  publish_agent_details=True, handle_messages_concurrently=True)
    chat = Protocol(spec=chat_protocol_spec)

    async def say(ctx: Context, to: str, text: str) -> None:
        await ctx.send(to, ChatMessage(content=[TextContent(text=text)]))

    @chat.on_message(ChatMessage)
    async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
        await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
        state = ctx.storage.get(sender) or {}
        text = msg.text()
        ctx.logger.info(f"chat from {sender[:16]}…: {text[:80]!r}")
        if not text and any(isinstance(c, StartSessionContent) for c in msg.content):
            text = "hi"
        try:
            async for reply in convo.handle(state, text):
                await say(ctx, sender, reply)
                ctx.storage.set(sender, state)
        except (FabraryError, httpx.HTTPError) as e:
            ctx.logger.warning(f"order flow failed for {sender[:16]}…: {e}")
            await say(ctx, sender, f"Sorry, the workshop didn't answer ({e}). Try again in a minute.")
        finally:
            ctx.storage.set(sender, state)

    @chat.on_message(ChatAcknowledgement)
    async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
        pass

    agent.include(chat, publish_manifest=True)
    return agent


if __name__ == "__main__":
    build_agent().run()
