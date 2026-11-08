// Shared test values. The shipped protocol defaults, as the back end sends them.
import type { ProtocolSettings } from "../src/shared/api";

export const PROTOCOL_DEFAULTS: ProtocolSettings = {
  trimStartS: 60,
  trimEndS: 60,
  maxExtraSettleS: 240,
  lengthS: 900,
  intervalS: 60,
  firstPointOffsetS: 0,
  contextS: 5,
  toleranceS: 0.5,
  maxToleranceS: 1,
  qcSamplePct: 10,
  qcMaxDiffPct: 6,
  qcAgreementPct: 95,
  pointsPerWindow: 15,
};
