import { Prisma } from "~/db";

/** Models that store per-school data; every query must be scoped by org. */
const TENANT_MODELS = new Set<string>([
  "Teacher",
  "Student",
  "Space",
  "CallEvent",
  "AppSettings",
  "ViewerAccessAttempt",
  "ViewerAccessSession",
  "ViewerMagicLink",
  "DrillTemplate",
  "DrillRun",
  "Household",
  "DismissalException",
  "AfterSchoolProgram",
  "ProgramCancellation",
]);

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

const CREATE_OPS = new Set(["create", "createMany", "upsert"]);
const UPDATE_OPS = new Set(["update", "delete", "upsert"]);

/**
 * Prisma client extension: injects `orgId` into reads/writes on tenant models.
 * Excludes auth tables (`User`, `Session`, …) and global rows (`Org`, `StripeWebhookEvent`).
 */
export function tenantExtension(orgId: string) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: "tenant-scope",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TENANT_MODELS.has(model)) {
              return query(args);
            }

            const a = args as Record<string, unknown>;

            if (READ_OPS.has(operation)) {
              a.where = { AND: [a.where ?? {}, { orgId }] };

              // findUnique / findUniqueOrThrow require `where` to use only unique fields.
              // Adding orgId breaks that contract; use findFirst with the same scoped where.
              if (operation === "findUnique" || operation === "findUniqueOrThrow") {
                const delegateKey = model.charAt(0).toLowerCase() + model.slice(1);
                const delegate = (client as unknown as Record<string, { findFirst: (arg: unknown) => Promise<unknown> }>)[delegateKey];
                if (delegate?.findFirst) {
                  const row = await delegate.findFirst(a);
                  if (operation === "findUniqueOrThrow" && row == null) {
                    throw new Error(`No ${model} found`);
                  }
                  return row;
                }
              }
            }

            if (UPDATE_OPS.has(operation) && a.where) {
              // update/delete/upsert require a WhereUniqueInput, which must
              // expose the unique field (id) at the top level — Prisma rejects
              // it if wrapped in AND. Merge orgId as an extra filter instead.
              a.where = { ...(a.where as object), orgId };
            }

            if (CREATE_OPS.has(operation)) {
              if (operation === "createMany") {
                const rows = a.data as unknown[];
                a.data = rows.map((row) => ({
                  ...(row as object),
                  orgId,
                }));
              } else if (operation === "upsert") {
                a.create = { ...(a.create as object), orgId };
              } else {
                a.data = { ...(a.data as object), orgId };
              }
            }

            return query(a);
          },
        },
      },
    }),
  );
}
