/* The chat thread of one order: what the person wrote and the agent's cards.

   Kept per order in sessionStorage (fabyn.chat.<orderId>). The cards themselves
   are drawn from the saved order; an entry only remembers which card it was,
   for which revision, and the one-line summary and thumbnails it showed when
   the next card replaced it. Lost storage only means the thread starts again
   from the request. */

import type { OrderView } from "./model";
import { LABEL_OF_PROCESS, MACHINE_NAME, MATCH_OF_PROCESS, PLACE_SHORT } from "./model";
import type { Step } from "./steps";
import type { Phase } from "./phase";
import { matchedMachine, orderTitle, phaseOf, preparedSize, processChange, processesOf, realMachinesFor } from "./phase";
import type { Process } from "./model";
import { STATUS_TEXT, type LiveMachine } from "./machines";
import { courierProgress, clockTime } from "./estimate";
import { assetUrl, plainReason } from "./orders";
import { formatKm, distanceKm, type LatLng } from "../shared/map";
import { placeText } from "./location";

export type Card = Step | "notice";

export type ChatEntry =
  | { id: string; who: "you"; at: number; text: string; photos?: string[] }
  | {
      id: string;
      who: "fabyn";
      at: number;
      card: Card;
      /** the notice phase, for a notice card */
      phase?: Phase;
      rev: number;
      /** the agent's line, the summary and the thumbnails as last shown */
      line: string;
      summary: string;
      thumbs: string[];
    };

const key = (orderId: string) => `fabyn.chat.${orderId}`;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function readThread(orderId: string): ChatEntry[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(key(orderId)) ?? "[]");
    return Array.isArray(v) ? v.filter((e) => e && (e.who === "you" || e.who === "fabyn") && typeof e.id === "string").slice(-80) : [];
  } catch {
    return [];
  }
}

export function saveThread(orderId: string, entries: ChatEntry[]) {
  try {
    sessionStorage.setItem(key(orderId), JSON.stringify(entries.slice(-80)));
  } catch {
    /* the thread lives in memory for this visit */
  }
}

export const youEntry = (text: string, photos: string[] = []): ChatEntry => ({
  id: newId(),
  who: "you",
  at: Date.now(),
  text,
  ...(photos.length ? { photos } : {}),
});

/** A card's identity: the same card for the same revision is the same entry. */
export const cardKey = (card: Card, phase: Phase | undefined) => (card === "notice" ? `notice:${phase}` : card);

export interface LineContext {
  machines: LiveMachine[] | null;
  spot: LatLng | null;
  name: string;
  now: number;
  /** the request was changed in the chat at least once */
  revised: boolean;
}

/** The machine a process needs, in a word or two. */
const MACHINE_WORD: Record<Process, string> = { fdm_print: "3D printer", sticker_print: "sticker printer", photo_print: "instax" };

/** Planning made something other than what was understood: say so in the same turn, never silently. */
function changeLine(o: OrderView): string {
  const c = processChange(o);
  if (!c) return "";
  const what = c.to === "sticker_print" ? "a black-and-white sticker" : c.to === "photo_print" ? "a colour print on photo film" : `a ${LABEL_OF_PROCESS[c.to]}`;
  return `The ${MACHINE_WORD[c.from]} is busy, so this became ${what}. `;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const NOTICE_LINE: Partial<Record<Phase, string>> = {
  payment: "Checking your payment. Nothing has been made yet.",
  payment_failed: "The payment failed, so nothing was made.",
  unavailable: "No machine can take this right now.",
  failed: "Something stopped the plan.",
  cancelled: "This order was stopped. Nothing else will be made for it.",
  superseded: "A newer version of this request is in progress.",
  partial: "Some of it is finished; the rest needs attention.",
  needs_review: "Lucas is checking this order before anything else happens.",
};

/** What the agent says above a card, from the saved order only. */
export function agentLine(card: Card, o: OrderView, c: LineContext, phase = phaseOf(o)): string {
  const processes = processesOf(o);
  const what = processes.map((p) => LABEL_OF_PROCESS[p]);
  const multi = processes.length > 1;
  const understood = !!o.intent || !!o.plan || o.events.some((e) => e.type === "draft.understood");
  switch (card) {
    case "understand":
      if (!understood)
        return c.revised ? "Got it. Reading that with the rest of your request…" : "Let me read that and find machines that can make it.";
      return (
        (multi
          ? `That's ${processes.length} things: ${list(what.map((w) => `a ${w}`))}. I'll pair each with a machine that can make it.`
          : `${cap(o.intent?.outcome?.replace(/\.$/, "") || `a ${what[0] ?? "print"}`)}. It needs a ${what[0] ? MATCH_OF_PROCESS[processes[0]] : "machine"}.`) +
        // something the agent left out or needs, said in the same turn
        (o.intent?.question && phase !== "question" ? ` ${o.intent.question}` : "")
      );
    case "map": {
      const m = matchedMachine(o, c.machines);
      return m
        ? `Here are the makers near ${c.spot ? "you" : `the ${PLACE_SHORT}`}. ${m.owner}'s ${MACHINE_NAME[m.id] ?? m.model} at the ${PLACE_SHORT} can take it${multi ? ", with the others beside it" : ""}.`
        : "Looking for machines that are on right now…";
    }
    case "machine":
      return multi
        ? `I paired each thing with a machine that can make it. They print side by side, all in one order for ${c.name}.`
        : "This is the machine that would make it.";
    case "preview":
      if (phase === "drafts") {
        const n = o.candidates?.candidates.length ?? 3;
        return `Here are ${n} drafts${o.candidates?.subject ? ` for “${o.candidates.subject}”` : ""}.${multi ? " The other things keep their own designs." : ""} Pick one, or tell me what to change.`;
      }
      if (phase === "proposal")
        return `${changeLine(o)}This is exactly what ${multi ? "the machines" : "the machine"} will print. Add it to the queue, or tell me what to change.`;
      return o.candidates?.selectedId ? "Preparing the design you picked…" : "Preparing the print file…";
    case "queue":
      return "Your spot in the queue is held while you check out.";
    case "checkout":
      return "Choose how you get it, then pay. Nothing prints before the payment settles.";
    case "printing":
      return multi ? `Paid. ${o.plan?.assignments.length ?? processes.length} machines are making it now.` : "Paid. It's printing now.";
    case "handoff": {
      const d = o.delivery;
      if (d?.mode === "delivery") {
        if (!d.courier) return phase === "ready" ? "It's made. Lucas is calling a courier." : "Lucas calls a courier as soon as it's made.";
        const r = courierProgress(d.courier, c.now);
        const first = d.courier.name.split(" ")[0];
        if (r.phase === "to_workshop") return `${d.courier.name} took the job and is riding to the workshop.`;
        if (r.phase === "on_the_way") return `${first} picked up your order at ${clockTime(d.courier.pickupAt)}. Arrives about ${clockTime(d.courier.arriveAt)}.`;
        return `${first} is at your door.`;
      }
      return phase === "ready" ? `It's ready. Collect it from Lucas at the ${PLACE_SHORT}.` : "Almost ready to collect.";
    }
    case "notice":
      if (phase === "question") return o.intent?.question || "One question first: add a little detail to the request.";
      if (phase === "unavailable") return plainReason(o.draft.reason, NOTICE_LINE.unavailable!);
      return NOTICE_LINE[phase] ?? "";
  }
}

/** The one line and thumbnails a card leaves behind once the next one replaces it. */
export function summaryOf(card: Card, o: OrderView, c: LineContext, phase = phaseOf(o)): { summary: string; thumbs: string[] } {
  const processes = processesOf(o);
  const plan = o.plan;
  switch (card) {
    case "understand":
      return {
        summary: processes.length
          ? `understood · ${processes.map((p) => `${LABEL_OF_PROCESS[p]} → ${MATCH_OF_PROCESS[p]}`).join(" · ")}`
          : "reading the request",
        thumbs: o.draft.photoAssetIds.slice(0, 4).map(assetUrl),
      };
    case "map": {
      const m = matchedMachine(o, c.machines);
      return {
        summary: [
          "nearby",
          c.spot ? placeText(c.spot).text : "no spot set",
          m ? `${m.owner}'s ${MACHINE_NAME[m.id] ?? m.model} fits${c.spot ? ` · ${formatKm(distanceKm(c.spot, m.at))}` : ""}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        thumbs: [],
      };
    }
    case "machine": {
      if (processes.length > 1)
        return {
          summary: `paired · ${processes
            .map((p) => {
              const a = plan?.assignments.find((x) => plan.items.find((i) => i.id === x.itemId)?.process === p);
              const id = a?.machineId ?? realMachinesFor(c.machines, p)[0]?.id;
              return `${LABEL_OF_PROCESS[p]} → ${(id && MACHINE_NAME[id]) || MATCH_OF_PROCESS[p]}`;
            })
            .join(" · ")}`,
          thumbs: [],
        };
      const m = matchedMachine(o, c.machines);
      return { summary: m ? `machine · ${MACHINE_NAME[m.id] ?? m.model} · ${STATUS_TEXT[m.status]}` : "machine", thumbs: [] };
    }
    case "preview":
      if (phase === "drafts" && o.candidates)
        return {
          summary: `drafts · round ${o.candidates.rounds} of ${o.candidates.maxRounds} · ${o.candidates.candidates.length} drafts`,
          thumbs: o.candidates.candidates.map((x) => x.previewUrl).slice(0, 6),
        };
      if (plan && phase === "proposal")
        return {
          summary: `preview · ${orderTitle(o)}${preparedSize(plan.assignments[0]) ? ` · ${preparedSize(plan.assignments[0])}` : ""}`,
          thumbs: plan.assignments.map((a) => a.previewUrl).filter(Boolean).slice(0, 4) as string[],
        };
      return {
        summary: o.candidates?.selectedId ? "preparing the picked design" : "preparing the print file",
        thumbs: o.candidates?.candidates.filter((x) => x.id === o.candidates?.selectedId).map((x) => x.previewUrl) ?? [],
      };
    case "queue":
      return { summary: `queue · ${orderTitle(o)} · spot held`, thumbs: [] };
    case "checkout":
      return { summary: `checkout · ${orderTitle(o)}`, thumbs: [] };
    case "printing":
      return { summary: `printing · ${orderTitle(o)}`, thumbs: [] };
    case "handoff":
      return { summary: `get it · ${o.delivery?.mode === "delivery" ? `delivery to ${o.delivery.to?.label ?? "you"}` : "pickup"}`, thumbs: [] };
    case "notice":
      return { summary: agentLine(card, o, c, phase), thumbs: [] };
  }
}

/** The entry for a card, as it shows now. */
export function fabynEntry(card: Card, o: OrderView, c: LineContext, phase: Phase): ChatEntry {
  return {
    id: newId(),
    who: "fabyn",
    at: Date.now(),
    card,
    ...(card === "notice" ? { phase } : {}),
    rev: o.draft.revision,
    line: agentLine(card, o, c, phase),
    ...summaryOf(card, o, c, phase),
  };
}
