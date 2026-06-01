import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Raw JSON body bytes (set for Moyasar payment-callback routes). */
    rawBody?: Buffer;
  }
}
