/**
 * Reference values for the formats, computed independently from how the README writes them down,
 * with Python's hashlib, hmac, json, uuid and `cryptography`, never from the code under test. The
 * README quotes them, and a test checks that it still does.
 */
export const VECTORS = {
  cartHash: '3001994879c426dd478b10b43aac598817821609da4153e296ce9f3eefbe72a8',
  policyHash: '6d61a34788017934a1804dc22191e12089d60c530788e7ee52a6725e471a0bf7',
  inputsHash: 'a36bfc8ce14588d6f24026a1556a613d75f8fdb9e3c87568b776d0998be9fbea',
  idempotency: '5ce7e5c9ebc15104e7420732dcf926ef500399bda299e7deaad74a0b128754a2',
  requestId: 'b307d7c2-c22d-5324-952a-0f3b070bebd3',
  provenanceTag: 'bursar:v1:act_01ARZ3NDEKTSV4RRFFQ69G5FAV:e30f3d22458a6c8a1bf10809916bd961',
  approvalSignature: 'AxS-83xuFjbWNrtJ_LSuWfaqcbh0ALt_kNAKLq0HmA0',
  sealed: 'bursar:secret:v1:1:oKGio6Slpqeoqaqr:gHZALcd-RSmcA95ZhHp2KA:TgFZd89-ZIJdEptPcBZ5zQ',
};
