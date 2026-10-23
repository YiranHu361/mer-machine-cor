import { hash, Problem, requireThat, specSchema, type State } from "./model.ts";

export function parseJobCreation(input: unknown, key?: unknown) {
  requireThat(
    key === undefined ||
      (typeof key === "string" && /^[A-Za-z0-9._:-]{8,200}$/.test(key)),
    "INVALID_CREATION_REQUEST_ID",
    "Idempotency-Key must be one request identifier of 8 to 200 ASCII letters, numbers, periods, underscores, colons or hyphens.",
    400,
  );
  const parsed = specSchema.safeParse(input);
  if (!parsed.success)
    throw new Problem(
      "INVALID_SPEC",
      parsed.error.issues.map((issue) => issue.message).join(" "),
      422,
    );
  const spec = parsed.data;
  return {
    spec,
    request:
      key === undefined
        ? undefined
        : {
            id: key as string,
            // Normalize optional undefined values to their JSON representation
            // so direct callers and HTTP callers bind the same original spec.
            specHash: hash(JSON.parse(JSON.stringify(spec))),
          },
  };
}

export function findCreatedJob(
  state: State,
  requesterId: string,
  request: { id: string; specHash: string },
) {
  const existing = Object.values(state.jobs).find(
    (job) =>
      job.requesterId === requesterId && job.creationRequestId === request.id,
  );
  if (existing)
    requireThat(
      existing.creationSpecHash === request.specHash,
      "CREATION_REQUEST_CONFLICT",
      "This order request identifier already belongs to a different original specification. Open the saved order, or explicitly start a new order.",
      409,
    );
  return existing;
}

/** Avoid duplicate preparation within this backend; CAS binds identity across backends. */
export function jobCreationQueue() {
  const tails = new Map<string, Promise<void>>();
  return async <T>(
    requesterId: string,
    key: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> => {
    if (key === undefined) return work();
    const scope = JSON.stringify([requesterId, key]);
    const previous = tails.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((done) => {
      release = done;
    });
    tails.set(scope, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(scope) === tail) tails.delete(scope);
    }
  };
}
