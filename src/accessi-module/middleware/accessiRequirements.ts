import { Request } from "express";

/** Grant effettivo letto da Accessi. Il confronto usa `tipoAbilitazione >= minPermissionLevel`. */
export type AccessiGrant = {
  codiceMenu: string;
  tipoAbilitazione?: number;
};

/** Risultato memoizzato durante una singola autorizzazione. Non modificarlo nel custom handler. */
export type GrantsResult = {
  grants?: AccessiGrant[];
  [key: string]: unknown;
};

/** Richiede l'accesso a un menu con almeno il livello indicato. Valori convenzionali: 10 lettura, 20 scrittura. */
export type AccessiPermissionRequirement = {
  type: "permission";
  menuCode: string;
  minPermissionLevel: number;
};

/** Tutti i requisiti figli devono essere soddisfatti. Una lista vuota e una configurazione non valida. */
export type AccessiAllRequirement = {
  type: "and";
  requirements: AccessiRequirementNode[];
};

/** Almeno un requisito figlio deve essere soddisfatto. Una lista vuota e una configurazione non valida. */
export type AccessiAnyRequirement = {
  type: "or";
  requirements: AccessiRequirementNode[];
};

/** Nega il risultato del requisito figlio. Usarlo con cautela per non creare policy difficili da verificare. */
export type AccessiNotRequirement = {
  type: "not";
  requirement: AccessiRequirementNode;
};

/** Delega una condizione applicativa a un handler registrato dal backend. */
export type AccessiCustomRequirement = {
  type: "custom";
  key: string;
  payload?: unknown;
};

/** Nodo composabile dell'albero di autorizzazione valutato da `authorizeAccessi`. */
export type AccessiRequirementNode =
  | AccessiPermissionRequirement
  | AccessiAllRequirement
  | AccessiAnyRequirement
  | AccessiNotRequirement
  | AccessiCustomRequirement;

/** Contesto in sola lettura consegnato a un requisito personalizzato. */
export type AccessiCustomRequirementContext = {
  req: Request;
  decodedToken: Record<string, unknown>;
  userCode: number;
  getGrantsResult: () => Promise<GrantsResult>;
};

/** Handler applicativo per `accessiRequirement.custom`; `false` nega la richiesta, un errore produce 500. */
export type AccessiCustomRequirementHandler = (
  context: AccessiCustomRequirementContext,
  payload?: unknown
) => boolean | Promise<boolean>;

/**
 * Policy passata a `authorizeAccessi`.
 * `requirements` e la forma compatibile storica ed equivale a un AND; `requirementTree`
 * permette policy annidate e ha precedenza quando entrambi sono presenti.
 */
export type AccessiAuthorizationOptions = {
  requirements?: { menuCode: string; minPermissionLevel: number }[];
  requirementTree?: AccessiRequirementNode;
  customRequirementHandlers?: Record<string, AccessiCustomRequirementHandler>;
};

/** Errore di configurazione di una policy, distinto dal normale diniego 403. */
export class RequirementEvaluationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RequirementEvaluationError";
  }
}

function requirementError(code: string, message: string): RequirementEvaluationError {
  return new RequirementEvaluationError(code, message);
}

/** Factory tipizzata per costruire policy leggibili senza dipendere dalla struttura interna dei nodi. */
export const accessiRequirement = {
  permission: (
    menuCode: string,
    minPermissionLevel: number
  ): AccessiPermissionRequirement => ({
    type: "permission",
    menuCode,
    minPermissionLevel,
  }),
  and: (...requirements: AccessiRequirementNode[]): AccessiAllRequirement => ({
    type: "and",
    requirements,
  }),
  or: (...requirements: AccessiRequirementNode[]): AccessiAnyRequirement => ({
    type: "or",
    requirements,
  }),
  not: (requirement: AccessiRequirementNode): AccessiNotRequirement => ({
    type: "not",
    requirement,
  }),
  custom: (key: string, payload?: unknown): AccessiCustomRequirement => ({
    type: "custom",
    key,
    payload,
  }),
};

/** Normalizza la forma compatibile `requirements` nell'albero interno. */
export function buildRequirementTree(
  options?: AccessiAuthorizationOptions
): AccessiRequirementNode | undefined {
  if (options?.requirementTree) return options.requirementTree;

  const requirements = options?.requirements ?? [];
  if (requirements.length === 0) return undefined;

  const nodes: AccessiRequirementNode[] = requirements.map((requirement) =>
    accessiRequirement.permission(
      requirement.menuCode,
      requirement.minPermissionLevel
    )
  );

  return accessiRequirement.and(...nodes);
}

/**
 * Valuta ricorsivamente una policy. I grant sono caricati solo se necessari tramite `getGrantsResult`.
 * Questa funzione e pubblica per test e integrazioni avanzate; normalmente usare `authorizeAccessi`.
 */
export async function evaluateRequirement(
  requirement: AccessiRequirementNode,
  context: AccessiCustomRequirementContext,
  options?: AccessiAuthorizationOptions
): Promise<boolean> {
  switch (requirement.type) {
    case "permission": {
      const grantsResult = await context.getGrantsResult();
      const grants = grantsResult.grants ?? [];
      return grants.some(
        (grant) =>
          grant.codiceMenu == requirement.menuCode &&
          Number(grant.tipoAbilitazione ?? 0) >= requirement.minPermissionLevel
      );
    }
    case "and":
      if (!requirement.requirements || requirement.requirements.length === 0) {
        throw requirementError(
          "AUTH_REQUIREMENTS_MISCONFIGURED",
          "AND requirement must contain at least one child requirement"
        );
      }
      for (const child of requirement.requirements) {
        if (!(await evaluateRequirement(child, context, options))) return false;
      }
      return true;
    case "or":
      if (!requirement.requirements || requirement.requirements.length === 0) {
        throw requirementError(
          "AUTH_REQUIREMENTS_MISCONFIGURED",
          "OR requirement must contain at least one child requirement"
        );
      }
      for (const child of requirement.requirements) {
        if (await evaluateRequirement(child, context, options)) return true;
      }
      return false;
    case "not":
      return !(await evaluateRequirement(requirement.requirement, context, options));
    case "custom": {
      const handlers = options?.customRequirementHandlers ?? {};
      const handler = handlers[requirement.key];
      if (!handler) {
        throw requirementError(
          "AUTH_REQUIREMENTS_MISCONFIGURED",
          `Custom requirement handler "${requirement.key}" not found`
        );
      }
      return Boolean(await handler(context, requirement.payload));
    }
    default:
      throw requirementError(
        "AUTH_REQUIREMENTS_MISCONFIGURED",
        "Unknown requirement node type"
      );
  }
}
