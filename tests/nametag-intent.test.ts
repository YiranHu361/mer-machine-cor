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

test("a request written over several chat messages follows the newest line that says it", () => {
  const renamed = localIntent("best_single", 'A keychain that says "Henry"\nmake it say Lucas', []);
  assert.deepEqual([renamed.items[0].process, renamed.items[0].text], ["fdm_print", "Lucas"]);
  const named = localIntent("best_single", "a keychain\nchange the name to Zoë", []);
  assert.equal(named.items[0].text, "Zoë");
  // a refinement that names nothing new keeps the item and the subject
  const hat = localIntent("best_single", "a cat sticker\nmake it wear a hat", []);
  assert.deepEqual([hat.items[0].process, hat.items[0].subject, hat.items[0].name], ["sticker_print", "cat", "A cat sticker"]);
  // a later item replaces an earlier one, whatever order the rules check them in
  const swapped = localIntent("best_single", "a keychain\nactually, a dog sticker", []);
  assert.deepEqual([swapped.items[0].process, swapped.items[0].subject], ["sticker_print", "dog"]);
  assert.equal(localIntent("best_single", "a dog sticker\nno, a keychain", []).items[0].process, "fdm_print");
  // one line reads as before
  assert.equal(nameFromRequest("a keychain where it says Maya"), "Maya");
  assert.equal(localIntent("best_single", 'A name tag that says "Maya"', []).items[0].text, "Maya");
});

test("colour asked in words is a colour print, even of a named sticker; a keychain and black and white stay as they are", () => {
  const one = (text: string) => localIntent("best_single", text, []).items;
  for (const text of ["colorful chicken nuggets", "colourful chicken nuggets print", "a colorful chicken nugget sticker"]) {
    const [item] = one(text);
    assert.deepEqual([item.process, item.colorImportant, item.creation], ["photo_print", true, "generate"], text);
    assert.match(item.name, /print$/, text);
  }
  assert.equal(one("a colorful chicken nugget sticker")[0].name, "A colorful chicken nugget print");
  // several things: only the part the colour words belong to
  const mixed = one('a colorful cat sticker and a keychain that says "Henry"');
  assert.deepEqual(
    mixed.map((i) => [i.process, i.colorImportant]),
    [["photo_print", true], ["fdm_print", false]],
  );
  assert.deepEqual(one("a colorful keychain").map((i) => i.process), ["fdm_print"]);
  assert.deepEqual(one("a cat sticker, black and white, no colour").map((i) => [i.process, i.colorImportant]), [["sticker_print", false]]);
  assert.deepEqual(one("a cat sticker").map((i) => [i.process, i.colorImportant]), [["sticker_print", false]]);
});

test("several things in one request: one item per thing, at most three, one drawing; one thing stays one item", () => {
  const photo = [{ assetId: "asset_1", colorful: true, kind: "photo" as const }];
  const three = localIntent("best_single", "a keychain that says Henry, a cat sticker and a print of this photo", photo);
  assert.deepEqual(
    three.items.map((i) => [i.process, i.creation, i.text ?? i.subject ?? i.photoAssetIds.join()]),
    [
      ["fdm_print", "generate", "Henry"],
      ["sticker_print", "generate", "cat"],
      ["photo_print", "preserve", "asset_1"],
    ],
  );
  assert.equal(three.requested, 3);
  // a quoted name is never cut at "and"
  assert.equal(localIntent("best_single", 'a keychain that says "Tom and Jerry" and a dog sticker', []).items[0].text, "Tom and Jerry");
  // no photo for the photo print: the rest goes ahead and the photo is asked for
  const noPhoto = localIntent("best_single", "a keychain that says Henry and a print of this photo", []);
  assert.deepEqual(noPhoto.items.map((i) => i.process), ["fdm_print"]);
  assert.equal(noPhoto.question, "Add the photo for the photo print.");
  assert.equal(noPhoto.requested, undefined);
  // one set of drafts per order: a second drawing of something else is left out and named
  const two = localIntent("best_single", "a cat sticker and a dog instax", []);
  assert.deepEqual(two.items.map((i) => i.process), ["sticker_print"]);
  assert.match(two.question!, /left out a dog print/);
  // the same subject shares the drafts
  assert.deepEqual(localIntent("best_single", "a cat sticker and a cat instax", []).items.map((i) => i.process), ["sticker_print", "photo_print"]);
  // a later line refines the thing it names, or all of them
  const later = localIntent("best_single", "a keychain that says Henry and a cat sticker\nchange the name to Lucas", []);
  assert.deepEqual(later.items.map((i) => i.text ?? i.subject), ["Lucas", "cat"]);
  // one thing is the one-item rules, unchanged
  for (const text of ["a sticker of a cat and a dog", "black and white sticker of a cat", "I want a cat sticker"])
    assert.equal(localIntent("best_single", text, []).items.length, 1, text);
  // ASI:One orders stay single
  assert.equal(localIntent("best_single", "a keychain that says Henry and a cat sticker", [], { single: true }).items.length, 1);
  // a gift is unchanged
  assert.equal(localIntent("gift", "a keychain and a sticker", photo).items.length, 3);
});
