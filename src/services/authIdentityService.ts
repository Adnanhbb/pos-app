import type { AuthActor } from "../api/authSession";
import type { User } from "../types/entities";

export type BackendAuthenticatedUser = User & {
  serverId?: number | string | null;
  identitySource: "backend";
};

type CachedUser = User & {
  serverId?: number | string | null;
};

function normalizedUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveBackendActorIdentity(
  actor: AuthActor,
  cachedUsers: CachedUser[]
): BackendAuthenticatedUser | null {
  const username = actor.Username ?? actor.username;
  const name = actor.Name ?? actor.name;
  const role = actor.Role ?? actor.role;
  const serverId = actor.serverId ?? actor.id ?? null;

  if (!username || !name || !role) return null;

  const cachedMatch = cachedUsers.find((user) => {
    if (
      serverId != null &&
      user.serverId != null &&
      String(user.serverId) === String(serverId)
    ) {
      return true;
    }

    return normalizedUsername(user.Username) === normalizedUsername(username);
  });

  return {
    ...cachedMatch,
    id: cachedMatch?.id,
    serverId,
    Username: username,
    Name: name,
    Mobile: actor.Mobile ?? actor.mobile ?? "",
    Role: role,
    Password: cachedMatch?.Password ?? "",
    isDeleted: false,
    deletedAt: null,
    identitySource: "backend",
  };
}
