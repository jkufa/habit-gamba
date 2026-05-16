export const REP_CURRENCY = "REP";
export const REP_SCALE = 1_000_000n;

export function repToMicro(rep: bigint): bigint {
  return rep * REP_SCALE;
}
