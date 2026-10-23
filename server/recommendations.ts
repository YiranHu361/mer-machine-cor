import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  createClaudeProvider,
  type IntakeDraft,
} from "../integrations/src/claude.ts";
import {
  hash,
  ownValue,
  Problem,
  requireThat,
  specSchema,
  type Asset,
  type Machine,
  type Spec,
  type State,
} from "./model.ts";
import type { Service } from "./service.ts";

const exec = promisify(execFile);
export const recommendationInput = z
  .object({
    assetIds: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
      .min(1)
      .max(4),
    intent: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) => new Set(value.assetIds).size === value.assetIds.length,
    "Upload each picture only once.",
  );

export interface ImageAnalysis {
  kind: "graphic" | "photo" | "ambiguous";
  colorful: boolean;
  images: Array<{ width: number; height: number }>;
}
type VisionInput = Parameters<
  ReturnType<typeof createClaudeProvider>["recommendIntake"]
>[0];
export interface RecommendationDependencies {
  analyze?: (assets: Asset[]) => Promise<ImageAnalysis>;
  vision?: (input: VisionInput) => Promise<IntakeDraft>;
  visionConfigured?: boolean;
}
export interface Recommendation {
  status: "recommended" | "unavailable" | "needs_clarification";
  provider: "claude" | "local_analysis";
  reason: string;
  questions: string[];
  spec: Spec | null;
  machine: ReturnType<typeof publicRecommendationMachine> | null;
  notice?: string;
}

/** The same current saved constraints apply to recommendations and quoting. */
export function machineSupportsSpec(
  machine: Machine,
  spec: Spec,
  mode: Machine["mode"],
  at = Date.now(),
  reservationJobId?: string,
) {
  const hour = new Date(at).getUTCHours();
  return (
    machine.outputType === spec.outputType &&
    machine.mode === mode &&
    machine.paired &&
    machine.configured &&
    machine.calibrated &&
    machine.listed &&
    machine.ready &&
    !machine.paused &&
    !machine.activeJobId &&
    !machine.policyReconciliationRequired &&
    (!machine.reservation ||
      machine.reservation.jobId === reservationJobId ||
      Date.parse(machine.reservation.expiresAt) <= at) &&
    machine.material === spec.material &&
    machine.mediaRemaining >= spec.quantity &&
    (spec.outputType !== "3d" ||
      (spec.estimatedSeconds ?? Infinity) <= machine.maxJobSeconds) &&
    machine.policy.maxQuantity >= spec.quantity &&
    machine.policy.authorizedArtwork &&
    machine.hours.start <= hour &&
    hour < machine.hours.end
  );
}

export function publicRecommendationMachine(
  machine: Machine,
  available: boolean,
) {
  return {
    id: machine.id,
    name: machine.name,
    model: machine.model,
    outputType: machine.outputType,
    mode: machine.mode,
    material: machine.material,
    paired: machine.paired,
    configured: machine.configured,
    calibrated: machine.calibrated,
    listed: machine.listed,
    ready: machine.ready,
    paused: machine.paused,
    mediaRemaining: machine.mediaRemaining,
    hours: machine.hours,
    maxJobSeconds: machine.maxJobSeconds,
    collectionPoint: machine.collectionPoint,
    available,
  };
}

async function localAnalysis(assets: Asset[]): Promise<ImageAnalysis> {
  const { stdout } = await exec(
    "uv",
    [
      "run",
      "--project",
      resolve("node"),
      "python",
      "-m",
      "fabrary_node.image_analysis",
      "--",
      ...assets.map((asset) => asset.path),
    ],
    { timeout: 15000, maxBuffer: 50000 },
  );
  const parsed = z
    .object({
      kind: z.enum(["graphic", "photo", "ambiguous"]),
      colorful: z.boolean(),
      images: z
        .array(
          z
            .object({
              width: z.number().int().positive(),
              height: z.number().int().positive(),
            })
            .passthrough(),
        )
        .min(1)
        .max(4),
    })
    .passthrough()
    .parse(JSON.parse(stdout));
  requireThat(
    parsed.images.length === assets.length,
    "IMAGE_ANALYSIS_UNAVAILABLE",
    "These pictures could not be checked. Upload them again before choosing a machine.",
    503,
  );
  return parsed;
}

function ownedImages(state: State, requesterId: string, ids: string[]) {
  return ids.map((assetId) => {
    const asset = ownValue(state.assets, assetId);
    requireThat(
      asset?.ownerId === requesterId,
      "ASSET_ACCESS",
      "Only your uploaded pictures may be recommended.",
      403,
    );
    requireThat(
      ["image/png", "image/jpeg", "image/webp"].includes(asset.mime),
      "IMAGE_REQUIRED",
      "Upload PNG, JPEG or WebP pictures. A photograph cannot authorize 3D production.",
      422,
    );
    return asset;
  });
}

function dimensions(
  outputType: "sticker" | "instax",
  assets: Asset[],
  suggested?: IntakeDraft,
) {
  if (outputType === "instax") return { widthMm: 54, heightMm: 86 };
  const source = assets[0];
  // Multiple pictures use the existing prepared collage; leave room for it.
  const ratio = assets.length > 1 ? 1 : source.height / source.width;
  const widthMm =
    suggested?.widthMm && [15, 25, 53].includes(suggested.widthMm)
      ? suggested.widthMm
      : 53;
  const heightMm =
    suggested?.heightMm &&
    Number.isInteger(suggested.heightMm) &&
    suggested.heightMm >= 5 &&
    suggested.heightMm <= 150
      ? suggested.heightMm
      : Math.min(150, Math.max(5, Math.round(widthMm * ratio)));
  return { widthMm, heightMm };
}

function draftValid(value: unknown): value is IntakeDraft {
  const result = z
    .object({
      outputType: z.enum(["sticker", "instax", "3d"]).nullable(),
      crop: z.enum(["contain", "cover"]),
      questions: z.array(z.string().trim().min(1).max(240)).max(5),
      reason: z.string().trim().min(1).max(600),
      contentReview: z.enum(["clear", "review"]),
      widthMm: z.number().positive().nullable(),
      heightMm: z.number().positive().nullable(),
      quantity: z.number().int().positive().nullable(),
      material: z.string().nullable(),
      provider: z.literal("claude"),
      model: z.string(),
    })
    .safeParse(value);
  return result.success;
}

export async function recommendImages(
  service: Service,
  requesterId: string,
  body: unknown,
  dependencies: RecommendationDependencies = {},
): Promise<Recommendation> {
  const parsed = recommendationInput.safeParse(body);
  if (!parsed.success)
    throw new Problem(
      "INVALID_RECOMMENDATION",
      parsed.error.issues.map((issue) => issue.message).join(" "),
      422,
    );
  const input = parsed.data;
  const initial = await service.read();
  const assets = ownedImages(initial, requesterId, input.assetIds);
  if (/\b(?:3d|three[- ]dimensional)\b/i.test(input.intent ?? ""))
    return {
      status: "needs_clarification",
      provider: "local_analysis",
      reason:
        "A picture is not a reviewed, prepared 3D production file. This image-first flow supports flat prints.",
      questions: ["Would you like a flat print of these pictures instead?"],
      spec: null,
      machine: null,
      notice: "No image-to-3D conversion or physical job was requested.",
    };
  let images: VisionInput["images"];
  try {
    images = await Promise.all(
      assets.map(async (asset) => {
        const bytes = await readFile(asset.path);
        requireThat(
          createHash("sha256").update(bytes).digest("hex") === asset.sha256,
          "IMAGE_UNAVAILABLE",
          "The uploaded picture could not be confirmed.",
          503,
        );
        return {
          bytes,
          mediaType: asset.mime as "image/png" | "image/jpeg" | "image/webp",
        };
      }),
    );
  } catch {
    throw new Problem(
      "IMAGE_UNAVAILABLE",
      "An uploaded picture is unavailable. Upload it again before choosing a machine.",
      503,
    );
  }
  const template = (type: "sticker" | "instax"): Spec => ({
    assetIds: input.assetIds,
    intent: input.intent
      ? input.intent.length >= 3
        ? input.intent
        : `Print: ${input.intent}`
      : "A print of my uploaded artwork",
    outputType: type,
    ...dimensions(type, assets),
    quantity: 1,
    material: type === "sticker" ? "thermal-paper" : "photo-film",
    crop: "contain",
    permission: "unclear",
  });
  const capabilities: VisionInput["capabilities"] = Object.values(
    initial.machines,
  ).map((machine) => ({
    id: machine.id,
    name: machine.name,
    model: machine.model,
    outputType: machine.outputType,
    mode: machine.mode,
    material: machine.material,
    available:
      machine.outputType !== "3d" &&
      machineSupportsSpec(
        machine,
        template(machine.outputType),
        service.config.mode,
      ),
    constraints: {
      ...(machine.outputType === "sticker"
        ? { widthsMm: [15, 25, 53] }
        : machine.outputType === "instax"
          ? { widthMm: 54, heightMm: 86 }
          : {}),
      maxQuantity: machine.policy.maxQuantity,
      maxJobSeconds: machine.maxJobSeconds,
    },
  }));
  let provider: Recommendation["provider"] = "local_analysis";
  let suggested: IntakeDraft | undefined;
  let outputType: "sticker" | "instax" | undefined;
  let explicitLocalChoice = false;
  let notice =
    "Local image analysis uses color and tonal detail, not semantic understanding. Inspect the prepared preview; it cannot guarantee print quality.";
  if (dependencies.visionConfigured ?? Boolean(process.env.ANTHROPIC_API_KEY)) {
    try {
      const draft = await (
        dependencies.vision ??
        ((value) => createClaudeProvider().recommendIntake(value))
      )({ intent: input.intent, images, capabilities });
      if (!draftValid(draft)) throw Error("Malformed image recommendation");
      provider = "claude";
      suggested = draft;
      notice =
        "Image analysis proposes a format; current saved device facts determine availability. Inspect the prepared preview and confirm artwork permission before ordering.";
      if (draft.outputType === "3d")
        return {
          status: "needs_clarification",
          provider,
          reason:
            "Uploaded pictures cannot be converted into a supported, reviewed 3D production file.",
          questions: ["Would you like a flat print of these pictures instead?"],
          spec: null,
          machine: null,
          notice,
        };
      if (
        draft.outputType === null ||
        draft.questions.length ||
        draft.contentReview === "review"
      )
        return {
          status: "needs_clarification",
          provider,
          reason:
            "The pictures need a little more context before choosing a suitable output.",
          questions: draft.questions.length
            ? draft.questions
            : [
                draft.contentReview === "review"
                  ? "Can you clarify the pictured content or intended use for owner review?"
                  : "What would you like to use the finished picture for?",
              ],
          spec: null,
          machine: null,
          notice,
        };
      outputType = draft.outputType;
    } catch (error) {
      if ((error as Error).message === "CLAUDE_UNSUPPORTED_RECOMMENDATION")
        return {
          status: "needs_clarification",
          provider: "claude",
          reason:
            "Image analysis did not identify a supported flat-print format. A picture cannot authorize 3D production.",
          questions: [
            "Would you like a supported flat print of these pictures?",
          ],
          spec: null,
          machine: null,
          notice: "No unsupported conversion or production job was requested.",
        };
      notice =
        "Vision analysis was unavailable. Limited local color and tonal analysis was used instead; inspect the preview because print quality is not guaranteed.";
    }
  }
  if (!outputType) {
    let analysis: ImageAnalysis;
    try {
      analysis = await (dependencies.analyze ?? localAnalysis)(assets);
    } catch {
      throw new Problem(
        "IMAGE_ANALYSIS_UNAVAILABLE",
        "The pictures could not be analyzed safely. Try again or upload different pictures.",
        503,
      );
    }
    const intent = input.intent ?? "";
    // Literal clarification is an explicit user format choice, never a claim
    // that pixel statistics have understood the depicted subject or its rights.
    const monoChoice =
      /\b(?:black[- ]and[- ]white|monochrome|gr[ae]yscale)\s+(?:sticker|label|print)\b/i.test(
        intent,
      );
    const photoChoice =
      /\b(?:colou?r\s+photo(?:graph)?(?:\s+print)?|photo(?:graph)?\s+print)\b/i.test(
        intent,
      );
    const stickerRequested = /\b(?:sticker|label|thermal)\b/i.test(intent);
    const conflict =
      (monoChoice && photoChoice) ||
      (stickerRequested && /\bcolou?r\b/i.test(intent) && !monoChoice);
    if (
      conflict ||
      (!monoChoice &&
        !photoChoice &&
        (analysis.kind === "ambiguous" ||
          (stickerRequested &&
            (analysis.colorful || analysis.kind === "photo"))))
    )
      return {
        status: "needs_clarification",
        provider,
        reason: conflict
          ? "The note asks for conflicting formats. Thermal stickers cannot preserve color."
          : "Local analysis cannot choose this format confidently. A thermal sticker converts color and photo tones to black and white.",
        questions: [
          "Choose one in your note: “black-and-white sticker” or “color photo”.",
        ],
        spec: null,
        machine: null,
        notice,
      };
    if (monoChoice || photoChoice) {
      outputType = monoChoice ? "sticker" : "instax";
      explicitLocalChoice = true;
      notice += monoChoice
        ? " You explicitly chose a black-and-white sticker; color and continuous tones will be converted. Check the exact preview before approving."
        : " You explicitly chose a color photo format; this choice was read from your note, not inferred semantically.";
    } else
      outputType =
        analysis.kind === "graphic" && !analysis.colorful
          ? "sticker"
          : "instax";
  }
  const { data: current } = await service.store.read();
  const currentAssets = ownedImages(current, requesterId, input.assetIds);
  requireThat(
    currentAssets.every((asset, index) => hash(asset) === hash(assets[index])),
    "ARTWORK_CHANGED",
    "The uploaded pictures changed during analysis. Ask for a fresh recommendation.",
    409,
  );
  const spec = specSchema.parse({
    ...template(outputType),
    ...dimensions(
      outputType,
      currentAssets,
      suggested?.outputType === outputType ? suggested : undefined,
    ),
  });
  const candidates = Object.values(current.machines)
    .filter((machine) =>
      machineSupportsSpec(machine, spec, service.config.mode),
    )
    .sort((a, b) => {
      const price = (m: Machine) =>
        m.priceCard.consumables +
        m.priceCard.machine +
        m.priceCard.handling +
        m.priceCard.platform;
      return price(a) - price(b) || a.id.localeCompare(b.id);
    });
  const machine = candidates[0];
  if (!machine)
    return {
      status: "unavailable",
      provider,
      reason:
        outputType === "instax"
          ? "These pictures need a color photo format, but no matching saved photo machine is available now. A monochrome print was not substituted."
          : "These graphics suit monochrome thermal output, but no matching saved sticker machine is available now.",
      questions: [],
      spec,
      machine: null,
      notice,
    };
  return {
    status: "recommended",
    provider,
    reason: explicitLocalChoice
      ? `You chose ${outputType === "sticker" ? "a black-and-white sticker" : "a color photo"}. The selected saved machine supports that format and is available now.`
      : outputType === "sticker"
        ? "The pictures suit a black-and-white graphic print. The selected thermal machine supports this format and is available in the saved workshop state."
        : "A color photo print preserves the pictures' color or tonal detail. The selected photo machine supports this format and is available in the saved workshop state.",
    questions: [],
    spec: { ...spec, recommendedMachineId: machine.id },
    machine: publicRecommendationMachine(machine, true),
    notice: `${notice}${machine.mode === "simulation" ? " This workshop is in simulation; no physical item will be produced." : ""}`,
  };
}
