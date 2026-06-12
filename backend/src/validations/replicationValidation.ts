import { z } from "zod";

export const replicationRequestSchema = z.object({
  sourceConfigId: z.coerce.string().min(1),
  destinationConfigId: z.coerce.string().min(1),
  sourceTable: z.string().min(1).max(255),
  destinationTable: z.string().min(1).max(255),
  createDestination: z.boolean().default(false)
}).superRefine((value, context) => {
  if (
    value.sourceConfigId === value.destinationConfigId &&
    value.sourceTable === value.destinationTable
  ) {
    context.addIssue({
      code: "custom",
      message: "No se puede replicar una tabla sobre sí misma"
    });
  }
});

export function assertSafeIdentifier(identifier: string): void {
  if (!/^[\p{L}\p{N}_$ .-]+$/u.test(identifier) || identifier.includes("\0")) {
    throw new Error("Identificador de tabla no permitido");
  }
}
