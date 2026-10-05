/**
 * Every purpose a hash, MAC or encryption serves in Bursar, with the label that binds it. A value
 * made for one purpose can never be passed off as another, because each purpose has its own label,
 * and they are all written here so that none can collide. Labels end in a version so that the
 * scheme can change without old and new values being confused.
 */
export const DOMAINS = {
  cart: 'bursar.cart.v1',
  policy: 'bursar.policy.v1',
  inputs: 'bursar.inputs.v1',
  idempotency: 'bursar.idempotency.v1',
  auditGenesis: 'bursar.audit.genesis.v1',
  auditEntry: 'bursar.audit.entry.v1',
  provenance: 'bursar.provenance.v1',
  approval: 'bursar.approval.v1',
  secret: 'bursar.secret.v1',
} as const;

export type Domain = keyof typeof DOMAINS;

/** The purposes of a plain hash. */
export type HashDomain = Extract<
  Domain,
  'cart' | 'policy' | 'inputs' | 'idempotency' | 'auditGenesis' | 'auditEntry'
>;

/** The purposes of a keyed MAC. */
export type MacDomain = Extract<Domain, 'provenance' | 'approval'>;
