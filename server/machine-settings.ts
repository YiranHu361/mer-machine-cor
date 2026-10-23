import { hash, type Machine } from "./model.ts";

/** Configuration edited by the owner form; operational/job state is excluded. */
export function machineSettingsFingerprint(machine: Machine) {
  return hash({
    listed: machine.listed,
    mediaRemaining: machine.mediaRemaining,
    material: machine.material,
    priceCard: machine.priceCard,
    hours: machine.hours,
    maxJobSeconds: machine.maxJobSeconds,
    collectionPoint: machine.collectionPoint,
    policy: {
      authorizedArtwork: machine.policy?.authorizedArtwork ?? true,
      maxQuantity: machine.policy?.maxQuantity ?? 10,
    },
    ownerAddress: machine.ownerAddress ?? null,
  });
}

/** The configured device to which a policy request was addressed. */
export function machineDeviceFingerprint(machine: Machine) {
  return hash({
    id: machine.id,
    adapterVersion: machine.adapterVersion,
    mode: machine.mode,
    outputType: machine.outputType,
    nodeUrl: machine.nodeUrl,
    paired: machine.paired,
    configured: machine.configured,
  });
}

/** The physical and execution facts to which an owner's clearance applies. */
export function machineInspectionFingerprint(machine: Machine) {
  return hash({
    device: machineDeviceFingerprint(machine),
    material: machine.material,
    calibrated: machine.calibrated,
    calibrationAt: machine.calibrationAt,
    activeJobId: machine.activeJobId,
    reservation: machine.reservation,
    ready: machine.ready,
    paused: machine.paused,
    policyReconciliationRequired: machine.policyReconciliationRequired,
  });
}

export function ownerMachineView(machine: Machine) {
  const { nodeUrl, ...visible } = machine;
  return {
    ...visible,
    settingsFingerprint: machineSettingsFingerprint(machine),
  };
}

/** Order policy requests inside this backend; other workflows still need CAS guards. */
export function machinePatchQueue() {
  const tails = new Map<string, Promise<void>>();
  return async <T>(machineId: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(machineId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((done) => {
      release = done;
    });
    tails.set(machineId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (tails.get(machineId) === tail) tails.delete(machineId);
    }
  };
}
