import multer from "multer";
import type { Express, NextFunction, Request, Response } from "express";
import {
  createClaudeProvider,
  type ClaudeImage,
  type MachineReading,
  type MachineReadingInput,
} from "../integrations/src/claude.ts";
import { Problem, requireThat } from "./model.ts";

export interface IdentificationDependencies {
  read?: (input: MachineReadingInput) => Promise<MachineReading>;
  configured?: boolean;
}
export interface MachineIdentification {
  status: "supported" | "unsupported" | "unclear";
  /** The supported model's setup value; present only when supported. */
  model?: string;
  modelName?: string;
  seen: string | null;
  source: "description" | "photo";
  provider: "claude" | "local";
  message: string;
}

const PHOTO_LIMIT = 4 * 1024 * 1024;
const SUPPORTED = "Phomemo M02Pro, Instax Mini Link 3 and Bambu Lab A1 mini";
// Claude only reports what is legible; these fixed patterns decide support.
const families = [
  {
    model: "phomemo-m02pro",
    name: "Phomemo M02Pro",
    brand: /\bphomemo\b/,
    exact: /\bm0?2 ?pro\b/,
    close: /\bm0?2\b/,
    closeQuestion:
      "Is it the M02 Pro? Only the Pro is supported, and its label says M02 Pro.",
    brandQuestion: "Which Phomemo model is it? Fabyn supports the M02 Pro.",
  },
  {
    model: "instax-mini-link-3",
    name: "Instax Mini Link 3",
    brand: /\b(instax|fujifilm|fuji)\b/,
    exact: /\bmini ?link ?3\b/,
    brandExact: /\blink ?3\b/,
    close: /\bmini ?link\b(?! ?\d)/,
    closeQuestion:
      "Is it the Instax mini Link 3? Only that Link printer is supported.",
    brandQuestion:
      "Which Instax model is it? Fabyn supports the mini Link 3.",
  },
  {
    model: "bambu-a1-mini",
    name: "Bambu Lab A1 mini",
    brand: /\bbambu ?(lab)?\b/,
    exact: /\ba1 ?mini\b/,
    close: /\ba1\b/,
    closeQuestion:
      "Is it the A1 mini? The full-size A1 and other Bambu printers aren't supported.",
    brandQuestion:
      "Which Bambu Lab printer is it? Fabyn supports the A1 mini.",
  },
];

const normalize = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** Match a typed name or a legible reading against the supported models. */
export function matchMachine(
  text: string,
  source: MachineIdentification["source"],
  provider: MachineIdentification["provider"],
): MachineIdentification {
  const seen = text.trim().replace(/\s+/g, " ").slice(0, 120) || null;
  const words = normalize(text);
  const result = (
    status: MachineIdentification["status"],
    message: string,
    family?: (typeof families)[number],
  ): MachineIdentification => ({
    status,
    ...(family ? { model: family.model, modelName: family.name } : {}),
    seen,
    source,
    provider,
    message,
  });
  const exact = families.filter(
    (f) =>
      f.exact.test(words) || (f.brandExact?.test(words) && f.brand.test(words)),
  );
  if (exact.length > 1)
    return result(
      "unclear",
      "That names more than one machine. Add them one at a time.",
    );
  if (exact.length === 1)
    return result(
      "supported",
      `Identified as ${exact[0].name}${source === "photo" ? " from the photo" : ""}. It's selected below.`,
      exact[0],
    );
  const close = families.find((f) => f.close.test(words));
  if (close) return result("unclear", close.closeQuestion);
  const branded = families.find((f) => f.brand.test(words));
  const modelLike = /\b[a-z]*\d[a-z0-9]*\b/.test(words);
  if (branded)
    return modelLike
      ? result(
          "unsupported",
          `Fabyn supports the ${branded.name}, not “${seen}”.`,
        )
      : result("unclear", branded.brandQuestion);
  return modelLike
    ? result(
        "unsupported",
        `Fabyn doesn't support “${seen}” yet. Supported machines: ${SUPPORTED}.`,
      )
    : result(
        "unclear",
        "Type the make and model from the machine's label, for example Phomemo M02 Pro.",
      );
}

/** Identify by the photo's bytes, never by the browser's stated type. */
function photoType(bytes: Buffer): ClaudeImage["mediaType"] | null {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}

const parsePhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_LIMIT, files: 1, fields: 2, fieldSize: 1000 },
}).single("photo");
const acceptPhoto = (req: Request, res: Response, next: NextFunction) =>
  parsePhoto(req, res, (error) =>
    next(
      !error
        ? undefined
        : error instanceof multer.MulterError &&
            error.code === "LIMIT_FILE_SIZE"
          ? new Problem(
              "PHOTO_TOO_LARGE",
              "The photo must be 4 MiB or smaller. Choose a smaller photo of the label.",
              413,
            )
          : new Problem(
              "INVALID_PHOTO_UPLOAD",
              "The photo could not be read. Add one PNG, JPEG or WebP photo and try again.",
              400,
            ),
    ),
  );

export function registerIdentificationRoutes(
  app: Express,
  {
    owner,
    dependencies = {},
  }: {
    owner: (req: Request) => Promise<unknown>;
    dependencies?: IdentificationDependencies;
  },
) {
  app.post(
    "/api/owner/machine-identification",
    async (req, _res, next) => {
      // Check access before reading an uploaded photo.
      await owner(req);
      next();
    },
    acceptPhoto,
    async (req, res) => {
      const description =
        typeof req.body?.description === "string"
          ? req.body.description.trim()
          : "";
      requireThat(
        description.length <= 200,
        "DESCRIPTION_TOO_LONG",
        "Keep the machine description to 200 characters.",
        422,
      );
      const file = req.file;
      requireThat(
        description || file,
        "IDENTIFICATION_EMPTY",
        "Type the machine's make and model, or add a photo of its label.",
        422,
      );
      const typed = description
        ? matchMachine(description, "description", "local")
        : null;
      if (!file) return res.json({ identification: typed });
      const mediaType = photoType(file.buffer);
      requireThat(
        mediaType,
        "PHOTO_TYPE",
        "Use a PNG, JPEG or WebP photo.",
        422,
      );
      requireThat(
        dependencies.configured ?? Boolean(process.env.ANTHROPIC_API_KEY),
        "VISION_NOT_CONFIGURED",
        "Reading a photo needs a Claude API key on this workshop. Type the model name instead.",
        409,
      );
      const definite = typed && typed.status !== "unclear" ? typed : null;
      let reading: MachineReading;
      try {
        reading = await (
          dependencies.read ??
          ((input) => createClaudeProvider().readMachine(input))
        )({
          description,
          photo: { bytes: file.buffer, mediaType },
        });
      } catch {
        return res.json({
          identification: definite ?? {
            status: "unclear",
            seen: null,
            source: "photo",
            provider: "claude",
            message:
              "The photo couldn't be read right now. Type the model name or choose it below.",
          },
        });
      }
      if (!reading.readable)
        return res.json({
          identification: definite ?? {
            status: "unclear",
            seen: null,
            source: "photo",
            provider: "claude",
            message: `No make and model could be read in the photo. ${reading.reason} Try a closer, sharper photo of the label, or type the model.`,
          },
        });
      const read = matchMachine(
        [reading.brand, reading.machineModel].filter(Boolean).join(" "),
        "photo",
        "claude",
      );
      // A photo that contradicts what the owner typed changes nothing.
      if (
        definite &&
        read.status !== "unclear" &&
        (read.status !== definite.status || read.model !== definite.model)
      )
        return res.json({
          identification: {
            status: "unclear",
            seen: read.seen,
            source: "photo",
            provider: "claude",
            message: `The photo shows ${read.seen}, but you typed “${definite.seen}”. Check the label, then try again.`,
          },
        });
      res.json({ identification: read });
    },
  );
}
