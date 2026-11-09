/** Names for networks that answer with their number only. Swiss networks for now. */
const OPERATOR_NAMES = new Map<string, string>([
  ['22801', 'Swisscom'],
  ['22802', 'Sunrise'],
  ['22803', 'Salt'],
]);

/** The name of a network code, or the code itself when it is not known. */
export function operatorName(code: string): string {
  return OPERATOR_NAMES.get(code) ?? code;
}
