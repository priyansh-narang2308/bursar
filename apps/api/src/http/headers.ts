import { secureHeaders } from 'hono/secure-headers';

/*
 * What a browser may load and do. The web app is one origin and one bundle, so the policy is tight: its own
 * scripts, no eval, no framing, nothing sent anywhere else. Styles allow inline because React sets style
 * attributes and AG Studio and Bryntum write their own. PayPal approval happens on paypal.com after a redirect,
 * so no PayPal origin is allowed in the page; an embedded SDK would be the one thing to add, here, in review.
 */
const NO_CAMERA_OR_LOCATION = { camera: [], microphone: [], geolocation: [], payment: [] };

/** For the built web app: the policy above. */
export const webHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    permissionsPolicy: NO_CAMERA_OR_LOCATION,
  });

/** For the API: it returns data, never a page, so it may load nothing at all. */
export const apiHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    permissionsPolicy: NO_CAMERA_OR_LOCATION,
  });
