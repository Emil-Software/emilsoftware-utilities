import { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { AccessiOptions } from "../AccessiModule";
import { PermissionService } from "../Services/PermissionService/PermissionService";

export type AccessiAuthorizationOptions = {
  requisiti: { codiceMenu: string; tipoAbilitazione: number }[];
  tipoControllo?: "AND" | "OR";
};

let accessiOptionsRef: AccessiOptions | null = null;

export function setAccessiAuthOptions(options: AccessiOptions) {
  accessiOptionsRef = options;
}

function resolveCodiceUtente(decoded: any): number | undefined {
  return (
    decoded?.userData?.utente?.codiceUtente ??
    decoded?.utente?.codiceUtente ??
    decoded?.codiceUtente
  );
}

export async function authorizeAccessi(
  req: Request,
  res: Response,
  next: NextFunction,
  options?: AccessiAuthorizationOptions
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) throw new Error("Authorization header not found");

    const token = authHeader.split(" ")[1];
    if (!token) throw new Error("Token not found in Authorization header");

    const secret =
      accessiOptionsRef?.jwtOptions?.secret ?? process.env.ACC_JWT_SECRET;
    if (!secret) throw new Error("JWT secret not configured");

    let decoded: any;
    try {
      decoded = jwt.verify(token, secret);
    } catch (error) {
      throw new Error("Invalid JWT token");
    }

    const codiceUtente = resolveCodiceUtente(decoded);
    if (!codiceUtente) throw new Error("codiceUtente not found in token payload");

    const requisiti = options?.requisiti ?? [];
    if (requisiti.length > 0) {
      if (!accessiOptionsRef?.databaseOptions) throw new Error("Database options not configured");
      const permissionService = new PermissionService(accessiOptionsRef);
      const grantsResult = await permissionService.getUserRolesAndGrants(
        codiceUtente
      );

      const grants = grantsResult.grants ?? [];
      const hasMenu = (codiceMenu: string, tipoAbilitazione: number) =>
        grants.some(
          (g) =>
            g.codiceMenu == codiceMenu &&
            Number(g.tipoAbilitazione ?? 0) >= tipoAbilitazione
        );
      const requireAll = (options?.tipoControllo ?? "AND") === "AND";
      const hasAbil = requireAll
        ? requisiti.every((r) => hasMenu(r.codiceMenu, r.tipoAbilitazione))
        : requisiti.some((r) => hasMenu(r.codiceMenu, r.tipoAbilitazione));

      if (!hasAbil) throw new Error("User does not have required permissions");
      (req as any).userGrants = grantsResult;
    }

    (req as any).data = decoded;
    return next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({ message: "Unauthorized", error: error.message });
  }
}

export const authenticateGen = authorizeAccessi;
