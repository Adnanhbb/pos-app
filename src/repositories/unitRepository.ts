// src/repositories/unitRepository.ts
import {
  getUnits,
  addUnit,
  updateUnit,
  deleteUnit,
} from "../db";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  normalizeRemoteRecord,
  prepareRemoteRecordForLocalInsert,
  queueEntityCreate,
  queueEntityDelete,
  queueEntityUpdate,
} from "./helpers/syncRepositoryHelpers";
import type { Unit } from "../types/entities";
import type { SyncMetadata } from "../types/sync";

export type { Unit };

type SyncableUnit = Unit & SyncMetadata & { shortName?: string | null };

function normalizeRemoteUnit(remote: unknown, fallback: Partial<SyncableUnit>): SyncableUnit | null {
  return normalizeRemoteRecord<Unit>(remote, {
    itemCount: fallback.itemCount ?? 0,
    ...fallback,
  });
}
function getRemoteData(remoteRecord: unknown): Partial<SyncableUnit> | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableUnit>;
  }

  return remoteRecord as Partial<SyncableUnit>;
}
async function queueUnitCreate(unit: SyncableUnit) {
  await queueEntityCreate("units", unit);
}

async function queueUnitUpdate(unit: SyncableUnit) {
  await queueEntityUpdate("units", unit);
}

async function queueUnitDelete(unit: Partial<SyncableUnit>) {
  await queueEntityDelete("units", unit);
}

export const unitRepository = {
  getAll: async (): Promise<Unit[]> => {
    return await getUnits();
  },

  getById: async (id: number): Promise<Unit | undefined> => {
    const all = await getUnits();
    return all.find(u => u.id === id);
  },

  create: async (unit: Omit<Unit, "id">): Promise<number> => {
    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableUnit>("units", unit);
        const remoteUnit = normalizeRemoteUnit(remote, unit);

        if (remoteUnit) {
          return await addUnit(prepareRemoteRecordForLocalInsert(remoteUnit) as Omit<Unit, "id">);
        }

        return await addUnit(unit);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addUnit(unit);
    const localRecord: SyncableUnit = {
      ...unit,
      id: localId,
    };

    await queueUnitCreate(localRecord);
    return localId;
  },

  update: async (unit: Unit): Promise<void> => {
    const syncableUnit = unit as SyncableUnit;
    const serverId = getServerId(syncableUnit);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableUnit>("units", serverId, syncableUnit);
        await updateUnit(unit);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateUnit(unit);
    await queueUnitUpdate(syncableUnit);
  },

  remove: async (id: number): Promise<void> => {
    const unit = await unitRepository.getById(id) as SyncableUnit | undefined;
    const serverId = unit ? getServerId(unit) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("units", serverId);
        await deleteUnit(id);
        return;
      } catch {
        // Fall through to local delete + queue when the API write fails.
      }
    }

    await deleteUnit(id);
    await queueUnitDelete(unit ?? { id });
  },

  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteUnit = getRemoteData(remoteRecord);
    const serverId = remoteUnit
      ? remoteUnit.serverId ?? remoteUnit.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Units sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const units = await getUnits();
    const localUnit = units.find((unit) => String(unit.id) === String(localId));

    if (!localUnit) {
      console.warn("Units sync mirror skipped: local unit not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredUnit: SyncableUnit = {
      ...(localUnit as SyncableUnit),
      serverId,
    };

    if (typeof remoteUnit?.name === "string") {
      mirroredUnit.name = remoteUnit.name;
    }

    if ("shortName" in (remoteUnit ?? {})) {
      mirroredUnit.shortName = remoteUnit?.shortName;
    }

    if (typeof remoteUnit?.itemCount === "number") {
      mirroredUnit.itemCount = remoteUnit.itemCount;
    }

    await updateUnit(mirroredUnit);
    console.info("Units sync mirror applied.", {
      localId,
      serverId,
    });
  },
  /* ---------- USAGE HELPERS ---------- */

  incrementItemCount: async (id: number): Promise<void> => {
    const unit = await unitRepository.getById(id);
    if (!unit) return;

    await updateUnit({
      ...unit,
      itemCount: (unit.itemCount ?? 0) + 1,
    });
  },

  decrementItemCount: async (id: number): Promise<void> => {
    const unit = await unitRepository.getById(id);
    if (!unit) return;

    await updateUnit({
      ...unit,
      itemCount: Math.max(0, (unit.itemCount ?? 0) - 1),
    });
  },
};
