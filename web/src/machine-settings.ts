type SettingsMachine = {
  settingsFingerprint?: string;
  policyReconciliationRequired?: boolean;
  mediaRemaining: number;
  material: string;
  collectionPoint: string;
  listed: boolean;
  priceCard: {
    consumables: number;
    machine: number;
    handling: number;
    platform: number;
  };
  hours: { start: number; end: number };
  maxJobSeconds: number;
  policy?: { authorizedArtwork: boolean; maxQuantity: number };
  ownerAddress?: string;
};
export const settingsFromMachine = (machine: SettingsMachine) => ({
  mediaRemaining: String(machine.mediaRemaining),
  material: machine.material,
  collectionPoint: machine.collectionPoint,
  listed: machine.listed,
  priceCard: {
    consumables: String(machine.priceCard.consumables),
    machine: String(machine.priceCard.machine),
    handling: String(machine.priceCard.handling),
    platform: String(machine.priceCard.platform),
  },
  hours: { start: machine.hours.start, end: machine.hours.end },
  maxJobSeconds: String(machine.maxJobSeconds),
  policy: {
    authorizedArtwork: machine.policy?.authorizedArtwork ?? true,
    maxQuantity: String(machine.policy?.maxQuantity ?? 10),
  },
  ownerAddress: machine.ownerAddress || "",
});
export function settingsSnapshot(machine: SettingsMachine) {
  const settings = settingsFromMachine(machine);
  return {
    settings,
    fingerprint: machine.settingsFingerprint,
    reconciliationRequired: machine.policyReconciliationRequired === true,
    identity: JSON.stringify([machine.settingsFingerprint ?? null, settings]),
  };
}
