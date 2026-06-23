import { Request } from "express";

export type AccessiGrant = {
  codiceMenu: string;
  tipoAbilitazione?: number;
};

export type GrantsResult = {
  grants?: AccessiGrant[];
  [key: string]: unknown;
};

export type AccessiPermissionRequirement = {
  type: "permission";
  menuCode: string;
  minPermissionLevel: number;
};

export type AccessiAllRequirement = {
  type: "and";
  requirements: AccessiRequirementNode[];
};

export type AccessiAnyRequirement = {
  type: "or";
  requirements: AccessiRequirementNode[];
};

export type AccessiNotRequirement = {
  type: "not";
  requirement: AccessiRequirementNode;
};

export type AccessiCustomRequirement = {
  type: "custom";
  key: string;
  payload?: unknown;
};

export type AccessiRequirementNode =
  | AccessiPermissionRequirement
  | AccessiAllRequirement
  | AccessiAnyRequirement
  | AccessiNotRequirement
  | AccessiCustomRequirement;

export type AccessiCustomRequirementContext = {
  req: Request;
  decodedToken: any;
  userCode: number;
  getGrantsResult: () => Promise<GrantsResult>;
};

export type AccessiCustomRequirementHandler = (
  context: AccessiCustomRequirementContext,
  payload?: unknown
) => boolean | Promise<boolean>;

export type AccessiAuthorizationOptions = {
  requirements?: { menuCode: string; minPermissionLevel: number }[];
  requirementTree?: AccessiRequirementNode;
  customRequirementHandlers?: Record<string, AccessiCustomRequirementHandler>;
};

export class RequirementEvaluationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RequirementEvaluationError";
  }
}

function requirementError(code: string, message: string): RequirementEvaluationError {
  return new RequirementEvaluationError(code, message);
}

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
