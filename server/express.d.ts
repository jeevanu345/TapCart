import "express-serve-static-core";
import type { Auth } from "./types.js";
declare module "express-serve-static-core" {
  interface Request {
    auth?: Auth;
    csrfToken?: string;
    requestId?: string;
  }
}
