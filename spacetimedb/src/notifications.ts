export type NotificationKindTag =
  | 'groupInvite'
  | 'guildInvite'
  | 'minigameInvite'
  | 'defensiveBattleVote'
  | 'system';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function insertNotification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  recipient: string,
  kindTag: NotificationKindTag,
  summary: string,
  actionableRefId: bigint | undefined,
  dedupeKey?: string
): void {
  const key = dedupeKey ?? '';
  if (key !== '') {
    for (const existing of ctx.db.notification.notification_recipient.filter(recipient)) {
      if (existing.dedupeKey === key) {
        ctx.db.notification.notificationId.delete(existing.notificationId);
      }
    }
  }
  ctx.db.notification.insert({
    notificationId: 0n,
    recipient,
    kind: { tag: kindTag },
    summary,
    createdAt: ctx.timestamp,
    readAt: undefined,
    actionableRefId,
    dedupeKey: key,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deleteNotificationByRef(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  recipient: string,
  kindTag: NotificationKindTag,
  refId: bigint
): void {
  for (const n of ctx.db.notification.notification_recipient.filter(recipient)) {
    if (n.kind.tag === kindTag && n.actionableRefId === refId) {
      ctx.db.notification.notificationId.delete(n.notificationId);
    }
  }
}
