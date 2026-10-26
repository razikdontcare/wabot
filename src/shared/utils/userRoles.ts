import type { proto } from "baileys";
import {
  getUserRoles,
  type UserRole,
} from "../../infrastructure/config/config.js";

/**
 * Baileys may deliver the sender as a LID while the configured admin list uses
 * the phone-number JID (or the other way around). Check every identity the
 * message carries so role checks keep working in both addressing modes.
 */
export function getEffectiveUserIds(
  user: string,
  msg?: proto.IWebMessageInfo | null,
): string[] {
  const ids = new Set<string>();
  if (user) ids.add(user);

  // Baileys v7 adds participantAlt/remoteJidAlt on the WAMessageKey shape
  // (not in the proto types).
  const keyAny = (
    msg as unknown as {
      key?: { participantAlt?: string; remoteJidAlt?: string };
    } | null | undefined
  )?.key;
  const alt = keyAny?.participantAlt || keyAny?.remoteJidAlt;
  if (alt) ids.add(alt);

  return Array.from(ids);
}

/** Roles for the sender, merged across the JID/LID identities we know about. */
export async function getUserRolesConsideringAlt(
  user: string,
  msg?: proto.IWebMessageInfo | null,
): Promise<UserRole[]> {
  const ids = getEffectiveUserIds(user, msg);
  const roleSets = await Promise.all(ids.map((id) => getUserRoles(id)));

  const merged = new Set<UserRole>();
  for (const roles of roleSets) {
    for (const role of roles) merged.add(role);
  }

  return Array.from(merged);
}

export async function isAdminConsideringAlt(
  user: string,
  msg?: proto.IWebMessageInfo | null,
): Promise<boolean> {
  const roles = await getUserRolesConsideringAlt(user, msg);
  return roles.includes("admin");
}
