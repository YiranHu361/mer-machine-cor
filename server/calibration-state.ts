import { ownValue, type State } from "./model.ts";

/** Prefer the active attempt, then insertion order when creation times tie. */
export function latestCalibration(state: State, machineId: string) {
  const active = ownValue(
    state.calibrations ?? {},
    state.machines[machineId]?.activeJobId ?? "",
  );
  return active?.machineId === machineId
    ? active
    : Object.values(state.calibrations ?? {})
        .filter((item) => item.machineId === machineId)
        .reverse()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
