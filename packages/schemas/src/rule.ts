/** Cross-field rules run only when every field already parsed cleanly, so one mistake is reported once. */
function clean(payload: { readonly issues: readonly unknown[] }): boolean {
  return payload.issues.length === 0;
}

/**
 * The parameters for a `.refine` that spans several fields (or checks a whole value after its
 * parts): its message, the field it is reported on, and the condition that it only runs once
 * everything it looks at is valid on its own.
 */
export function rule(message: string, ...path: (string | number)[]) {
  return { message, path, when: clean };
}
