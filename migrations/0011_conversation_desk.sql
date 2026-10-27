-- Ticket 12: the staff conversation desk and one-day inactivity.
-- last_activity_at is the inactivity clock: it moves only when a visitor or
-- staff message lands (polling, presence, and page views never touch it), and
-- a conversation leaves the active lists exactly 24 hours after it. It is
-- backfilled from the latest meaningful message so existing conversations do
-- not instantly look stale. attention_at is the in-dashboard alert: set when
-- a visitor message arrives (never duplicated while standing), cleared when
-- staff view, reply, or claim the conversation.

ALTER TABLE conversations ADD COLUMN last_activity_at TEXT;
ALTER TABLE conversations ADD COLUMN attention_at TEXT;

UPDATE conversations
   SET last_activity_at = COALESCE(
     (SELECT MAX(messages.created_at)
        FROM messages
       WHERE messages.conversation_id = conversations.id
         AND messages.role IN ('visitor', 'staff')),
     created_at
   );
