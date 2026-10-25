import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localIntent,
  nameFromRequest,
  NEUTRAL_TAG_TEXT,
  requestedProcess,
  tagText,
} from "../server/orchestration/intent.ts";

test("name tag text keeps what was written when the template can engrave it", () => {
  assert.equal(tagText("Maya"), "Maya");
  assert.equal(tagText("  Zoë   & Ana! "), "Zoë & Ana!");
  assert.equal(tagText("O'Brien-Smith 2"), "O'Brien-Smith 2");
  for (const bad of ["", "   ", "x".repeat(17), "日本", "a#b", "...", null, undefined])
    assert.equal(tagText(bad), NEUTRAL_TAG_TEXT, String(bad));
});

test("the name comes from quotes or from what the tag should say", () => {
  assert.equal(nameFromRequest('A name tag that says "Lucas Jiang"'), "Lucas Jiang");
  assert.equal(nameFromRequest("a keychain that says Maya."), "Maya");
  assert.equal(nameFromRequest("nametag with my name Priya"), "Priya");
  assert.equal(nameFromRequest("make a name tag, my name is Sam"), "Sam");
  assert.equal(nameFromRequest("i want a sticker"), null);
  assert.equal(nameFromRequest("a name tag that says this is far too long a name"), null);
});

test("a name tag request is a 3D print with the name engraved", () => {
  for (const text of ["a nametag", "a name tag", "name-tag please", "a keychain"])
    assert.equal(requestedProcess(text), "fdm_print", text);
  const brief = localIntent("best_single", 'A name tag that says "Maya"', []);
  assert.equal(brief.items.length, 1);
  const [item] = brief.items;
  assert.deepEqual(
    [item.process, item.name, item.text, item.creation],
    ["fdm_print", "A name tag", "Maya", "generate"],
  );
  assert.equal(localIntent("best_single", "a keychain", []).items[0].text, NEUTRAL_TAG_TEXT);
});
