import { connectivityService } from "../../services/connectivityService";
import { syncQueueRepository } from "../syncQueueRepository";
import type { SyncEntityName, SyncMetadata, SyncOperation } from "../../types/sync";

export type SyncableRecord = {
  id?: number | string;
} & SyncMetadata;

export const ACCOUNTING_FIELDS = [
  "invoices",
  "payable",
  "paid",
  "balance",
] as const;

type AccountingField = typeof ACCOUNTING_FIELDS[number];

export const ITEM_STOCK_FIELDS = ["availableStock"] as const;

export const ITEM_CASCADE_FIELDS = [
  "category",
  "brand",
  "minunit",
  "maxunit",
  "ConvQty",
] as const;

export const ITEM_SAFE_PROFILE_FIELDS = [
  "name",
  "barcode",
  "description",
  "purchasePrice",
  "retailPrice",
  "discountPrice",
  "wholesalePrice",
] as const;

type ItemUnsafeField =
  | typeof ITEM_STOCK_FIELDS[number]
  | typeof ITEM_CASCADE_FIELDS[number];

type ItemSafeProfileField = typeof ITEM_SAFE_PROFILE_FIELDS[number];

export async function canUseApi() {
  try {
    return await connectivityService.isFullyOnline();
  } catch {
    return false;
  }
}

export function getServerId(record: Partial<SyncableRecord>) {
  return record.serverId ?? null;
}

export function hasAccountingFieldChange<T extends Partial<Record<AccountingField, unknown>>>(
  before: T | undefined,
  after: T
) {
  if (!before) return false;

  return ACCOUNTING_FIELDS.some((field) => before[field] !== after[field]);
}

export function stripAccountingFields<T extends object>(record: T) {
  const profilePayload = { ...record } as Partial<T> & Record<AccountingField, unknown>;

  for (const field of ACCOUNTING_FIELDS) {
    delete profilePayload[field];
  }

  return profilePayload as Omit<T, AccountingField>;
}

export function hasUnsafeItemFieldChange<
  T extends Partial<Record<ItemUnsafeField, unknown>>
>(
  before: T | undefined,
  after: T
) {
  if (!before) return true;

  return [...ITEM_STOCK_FIELDS, ...ITEM_CASCADE_FIELDS].some(
    (field) => before[field] !== after[field]
  );
}

export function pickSafeItemProfilePayload<
  T extends Partial<Record<ItemSafeProfileField, unknown>> & SyncableRecord
>(record: T) {
  const payload: Partial<Record<ItemSafeProfileField, unknown>> & SyncableRecord = {};

  if (record.id != null) payload.id = record.id;
  if (record.localId != null) payload.localId = record.localId;
  if (record.serverId != null) payload.serverId = record.serverId;

  for (const field of ITEM_SAFE_PROFILE_FIELDS) {
    if (field in record) {
      payload[field] = record[field];
    }
  }

  return payload;
}

export function prepareRemoteRecordForLocalInsert<T extends SyncableRecord>(
  record: T
): Omit<T, "id"> & SyncMetadata {
  const { id, ...localRecord } = record as T & { id?: number | string };

  return {
    ...localRecord,
    serverId: record.serverId ?? id ?? null,
  } as Omit<T, "id"> & SyncMetadata;
}
export function normalizeRemoteRecord<T extends { id?: number | string; name: string }>(
  remote: unknown,
  fallback: Partial<T & SyncMetadata>,
  isUsable: (record: Partial<T & SyncMetadata>) => boolean = (record) => Boolean(record.name)
): (T & SyncMetadata) | null {
  if (!remote || typeof remote !== "object") return null;

  const maybeWrapped = remote as { data?: unknown };
  const remoteData =
    "data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object"
      ? maybeWrapped.data
      : remote;

  const record = remoteData as Partial<T & SyncMetadata>;
  if (!isUsable(record)) return null;

  return {
    ...fallback,
    ...record,
    serverId: record.serverId ?? fallback.serverId ?? record.id ?? null,
  } as T & SyncMetadata;
}

export async function safeQueueAdd(
  item: Parameters<typeof syncQueueRepository.add>[0]
) {
  try {
    await syncQueueRepository.add(item);
  } catch (error) {
    console.warn("Failed to add sync queue item after local write.", error);
  }
}

export async function queueEntityOperation(
  entity: SyncEntityName,
  operation: SyncOperation,
  record: Partial<SyncableRecord>
) {
  const localId = record.id ?? record.localId ?? null;
  const payload = {
    ...record,
    localId: record.localId ?? localId,
  };

  await safeQueueAdd({
    entity,
    operation,
    localId,
    serverId: getServerId(record),
    payload,
  });
}

export async function queueEntityCreate(
  entity: SyncEntityName,
  record: Partial<SyncableRecord>
) {
  await queueEntityOperation(entity, "create", record);
}

export async function queueEntityUpdate(
  entity: SyncEntityName,
  record: Partial<SyncableRecord>
) {
  await queueEntityOperation(entity, "update", record);
}

export async function queueEntityDelete(
  entity: SyncEntityName,
  record: Partial<SyncableRecord>
) {
  await queueEntityOperation(entity, "delete", record);
}