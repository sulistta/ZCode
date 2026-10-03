import {
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  httpActionGeneric,
} from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  MutationBuilder,
  QueryBuilder,
  GenericMutationCtx,
} from "convex/server";
import type schema from "../schema.js";
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type MutationCtx = GenericMutationCtx<DataModel>;
export const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, "internal">;
export const internalQuery = internalQueryGeneric as QueryBuilder<DataModel, "internal">;
export const httpAction = httpActionGeneric;
