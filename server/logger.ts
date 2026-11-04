import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : process.env.LOG_LEVEL || "info",
  base: { service: "tapcart" },
  redact: ["password", "token", "authorization", "cookie", "secret", "body"],
});
