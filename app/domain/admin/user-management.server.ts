export const adminUserListSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  banReason: true
} as const;

export const viewerLockListSelect = {
  clientKey: true,
  ipHint: true,
  requiresAdminReset: true,
  lockedUntil: true
} as const;

type OrgPasswordResetSetting =
  | {
      passwordResetEnabled?: boolean | null;
    }
  | null
  | undefined;

type OrgPasswordResetDelegate = {
  update(args: {
    where: { id: string };
    data: { passwordResetEnabled: boolean };
  }): Promise<unknown>;
};

export function isPasswordResetEnabledForOrg(
  org: OrgPasswordResetSetting
): boolean {
  return org?.passwordResetEnabled !== false;
}

export async function setOrgPasswordResetEnabled(
  prisma: { org: unknown },
  orgId: string,
  enabled: boolean
): Promise<void> {
  // The generated Org delegate can lag behind the deployed schema until
  // `prisma generate` runs, so narrow the cast to the one field we need.
  const orgDelegate = prisma.org as unknown as OrgPasswordResetDelegate;
  await orgDelegate.update({
    where: { id: orgId },
    data: { passwordResetEnabled: enabled }
  });
}
