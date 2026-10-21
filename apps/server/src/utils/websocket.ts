/**
 * uWebSockets.js `maxBackpressure` default (Bun's `backpressureLimit` default is 16MB).
 * Bun's other defaults already match uWS: sendPings true, perMessageDeflate false,
 * closeOnBackpressureLimit false.
 */
export const UWS_BACKPRESSURE_LIMIT = 64 * 1024;
