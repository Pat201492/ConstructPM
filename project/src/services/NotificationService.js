const db = require('../config/database');

// Normalize email address inputs: accept string, array, comma-separated
// string, or null; return a trimmed deduplicated array of strings.
function normalizeAddresses(v) {
  if (!v) return [];
  const raw = Array.isArray(v) ? v : String(v).split(',');
  const cleaned = raw.map(s => String(s).trim()).filter(Boolean);
  return [...new Set(cleaned)];
}

// Escape HTML-significant chars for safe inclusion in element text or
// attribute values. Used when wrapping notification fields (title/body/url)
// into the boilerplate HTML body that all three providers send.
function escapeHtml(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cached nodemailer Gmail transport. Built once on first send; reused
// for subsequent sends so we're not re-establishing SMTP auth per call.
let _gmailTransport = null;

/**
 * Notification Service
 * 
 * Handles creation and delivery of notifications across three channels:
 * - In-app (stored in DB, delivered via WebSocket)
 * - Email (via SES or SendGrid)
 * - Push (via Firebase Cloud Messaging)
 */
const NotificationService = {
  // Reference to Socket.io instance (set during server init)
  _io: null,

  /**
   * Initialize with Socket.io instance for real-time in-app delivery
   */
  init(io) {
    this._io = io;
    console.log('[NotificationService] Initialized with WebSocket support');
  },

  // ─── REUSABLE LOOKUP HELPERS ──────────────────────────────

  /** Get all active admin user IDs */
  async getAdminIds() {
    return db('users').where({ role: 'admin', active: true }).pluck('id');
  },

  /** Get PM's delegate user ID (or null if no delegate configured) */
  async getDelegateId(pmUserId) {
    const row = await db('pm_notification_delegates').where({ pm_user_id: pmUserId }).first();
    return row ? row.delegate_user_id : null;
  },

  /** Get deduplicated recipient list: PM + their delegate */
  async getPmAndDelegate(pmUserId) {
    const delegate = await this.getDelegateId(pmUserId);
    return [...new Set([pmUserId, delegate].filter(Boolean))];
  },

  // Build the standard notification HTML body shared by all providers.
  // All interpolated fields are HTML-escaped so titles/bodies containing
  // `<`, `>`, `"`, or `'` cannot break out of the surrounding markup.
  _buildNotificationHtml(notification) {
    const title = escapeHtml(notification.title);
    const body = escapeHtml(notification.body);
    const actionLink = notification.action_url
      ? `<p><a href="${escapeHtml(notification.action_url)}" style="color: #2E75B6;">View Details &rarr;</a></p>`
      : '';
    return `
              <div style="font-family: Arial, sans-serif; max-width: 600px;">
                <h2 style="color: #1F4E79;">${title}</h2>
                <p>${body}</p>
                ${actionLink}
                <hr style="border: 1px solid #eee;">
                <p style="color: #999; font-size: 12px;">Construction PM Platform</p>
              </div>
            `;
  },

  /**
   * Send a notification to one or more users.
   * Respects each user's notification preferences.
   * 
   * @param {Object} opts
   * @param {string[]} opts.userIds - Target user IDs
   * @param {string} opts.type - Notification type (e.g. 'bid_won', 'extraction_ready')
   * @param {string} opts.title - Short title
   * @param {string} opts.body - Notification body text
   * @param {string} opts.priority - 'low', 'normal', 'high', 'urgent'
   * @param {string} opts.actionUrl - Deep link URL
   * @param {string} opts.referenceType - 'bid', 'project', 'invoice', etc.
   * @param {string} opts.referenceId - ID of related entity
   * @param {string[]} opts.channels - Override channels ['in_app', 'email', 'push']
   */
  async send({
    userId,      // Single user ID (new, preferred)
    userIds,     // Array of user IDs (legacy, still supported)
    type,
    title,
    body,
    category = 'informational', // 'actionable' or 'informational'
    priority = 'normal',
    actionUrl = null,
    actionType = null, // UI hint: 'verify_extraction', 'confirm_payment', 'bid_archive', etc.
    referenceType = null,
    referenceId = null,
    channels = null,
  }) {
    // Support both single userId and array userIds
    const ids = userIds || (userId ? [userId] : []);
    if (ids.length === 0) return [];

    // Get user preferences
    const users = await db('users')
      .whereIn('id', ids)
      .where('active', true)
      .select('id', 'email', 'notification_preferences');

    const results = [];

    for (const user of users) {
      const prefs = typeof user.notification_preferences === 'string'
        ? JSON.parse(user.notification_preferences)
        : user.notification_preferences || { in_app: true, email: true, push: true };

      // Determine which channels to use
      const activeChannels = channels || ['in_app', 'email', 'push'];

      for (const channel of activeChannels) {
        // Skip if user has disabled this channel
        if (!prefs[channel]) continue;

        try {
          // 1. Store in database (all channels get a DB record)
          const [notification] = await db('notifications').insert({
            user_id: user.id,
            type,
            category,
            title,
            body,
            channel,
            priority,
            action_url: actionUrl,
            action_type: actionType,
            reference_type: referenceType,
            reference_id: referenceId,
          }).returning('*');

          // 2. Deliver via the appropriate channel
          switch (channel) {
            case 'in_app':
              this._deliverInApp(user.id, notification);
              break;
            case 'email':
              this._deliverEmail(user.email, notification).catch(err => {
                console.error(`[NotificationService] Email failed for ${user.email}:`, err.message);
              });
              break;
            case 'push':
              this._deliverPush(user.id, notification).catch(err => {
                console.error(`[NotificationService] Push failed for ${user.id}:`, err.message);
              });
              break;
          }

          results.push(notification);
        } catch (err) {
          console.error(`[NotificationService] Failed to send ${channel} to ${user.id}:`, err.message);
        }
      }
    }

    return results;
  },

  /**
   * Deliver in-app notification via WebSocket
   */
  _deliverInApp(userId, notification) {
    if (this._io) {
      this._io.to(`user:${userId}`).emit('notification', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        priority: notification.priority,
        action_url: notification.action_url,
        reference_type: notification.reference_type,
        reference_id: notification.reference_id,
        created_at: notification.created_at,
      });
    }
  },

  /**
   * Deliver email notification via SES or SendGrid
   */
  async _deliverEmail(email, notification) {
    if (!email) return;

    const provider = process.env.EMAIL_PROVIDER;

    if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
      await this._sendViaSendGrid(email, notification);
    } else if (provider === 'ses' && process.env.SES_REGION) {
      await this._sendViaSES(email, notification);
    } else if (provider === 'gmail' && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      await this._sendViaGmail(email, notification);
    } else {
      // Log email that would be sent (dev mode)
      console.log(`[NotificationService] EMAIL (dev): To: ${email} | Subject: ${notification.title} | Body: ${notification.body}`);
    }
  },

  /**
   * Send email via SendGrid
   */
  async _sendViaSendGrid(to, notification) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: process.env.EMAIL_FROM || 'noreply@constructpm.com' },
        subject: notification.title,
        content: [
          {
            type: 'text/html',
            value: this._buildNotificationHtml(notification),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`SendGrid error: ${response.status}`);
    }
  },

  /**
   * Send email via AWS SES
   */
  async _sendViaSES(to, notification) {
    const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

    const client = new SESClient({ region: process.env.SES_REGION });
    const command = new SendEmailCommand({
      Source: process.env.EMAIL_FROM || 'noreply@constructpm.com',
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: notification.title },
        Body: {
          Html: { Data: this._buildNotificationHtml(notification) },
        },
      },
    });

    await client.send(command);
  },

  /**
   * Build (or reuse) the nodemailer Gmail SMTP transport. Cached at
   * module scope on first call so we're not establishing fresh SMTP
   * auth per send. Shared by all three Gmail send paths.
   */
  _getGmailTransport() {
    if (_gmailTransport) return _gmailTransport;
    const nodemailer = require('nodemailer');
    _gmailTransport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    return _gmailTransport;
  },

  /**
   * Raw Gmail SMTP sender used by `sendEmail` / `sendEmailWithAttachment`.
   * Callers supply already-composed subject/html/text and (optionally)
   * attachments; this helper only handles transport + From: defaulting.
   */
  async _sendViaGmailRaw({ to, cc, subject, html, text, attachments }) {
    const transport = this._getGmailTransport();
    await transport.sendMail({
      from: process.env.EMAIL_FROM || process.env.GMAIL_USER,
      to,
      cc: cc && cc.length > 0 ? cc : undefined,
      subject,
      html: html || undefined,
      text: text || undefined,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    });
  },

  /**
   * Send notification email via Gmail SMTP (app password). Used as a
   * domain-less dev path: the From: header is the GMAIL_USER address,
   * which is DKIM-signed by Google and aligns with DMARC.
   */
  async _sendViaGmail(to, notification) {
    await this._sendViaGmailRaw({
      to,
      subject: notification.title,
      html: this._buildNotificationHtml(notification),
    });
  },

  /**
   * Send a one-shot email with an attached file to a single address. Used
   * by the Quick Project flow to drop the generated Word quote into the
   * PM's inbox. Independent of the broader send() pipeline because send()
   * fans out per-user-preference and never carries attachments.
   *
   * @param {Object} opts
   * @param {string|string[]} opts.to   Recipient email(s) — single string or array
   * @param {string|string[]} [opts.cc] Optional CC email(s) — single or array
   * @param {string} opts.subject
   * @param {string} opts.html          HTML body
   * @param {string} opts.filePath      Absolute path of file to attach
   * @param {string} opts.filename      Display filename on the attachment
   * @param {string} [opts.contentType] MIME — defaults to docx
   * @returns {Promise<{delivered: boolean, provider: string, reason?: string}>}
   */
  async sendEmailWithAttachment({ to, cc, subject, html, filePath, filename, contentType }) {
    const toList = normalizeAddresses(to);
    const ccList = normalizeAddresses(cc);
    if (toList.length === 0) return { delivered: false, provider: 'none', reason: 'no recipient' };
    const fs = require('fs/promises');
    let fileBuf;
    try {
      fileBuf = await fs.readFile(filePath);
    } catch (err) {
      return { delivered: false, provider: 'none', reason: `attachment unreadable: ${err.message}` };
    }
    const provider = process.env.EMAIL_PROVIDER;
    const ct = contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
      const personalization = { to: toList.map(e => ({ email: e })) };
      if (ccList.length > 0) personalization.cc = ccList.map(e => ({ email: e }));
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        },
        body: JSON.stringify({
          personalizations: [personalization],
          from: { email: process.env.EMAIL_FROM || 'noreply@constructpm.com' },
          subject,
          content: [{ type: 'text/html', value: html }],
          attachments: [{
            content: fileBuf.toString('base64'),
            filename,
            type: ct,
            disposition: 'attachment',
          }],
        }),
      });
      if (!response.ok) {
        const t = await response.text().catch(() => '');
        return { delivered: false, provider: 'sendgrid', reason: `${response.status} ${t.slice(0,120)}` };
      }
      return { delivered: true, provider: 'sendgrid' };
    }

    // SES path uses SendRawEmailCommand because SendEmailCommand can't
    // carry attachments. Hand-rolling the MIME envelope keeps the SDK
    // surface small and avoids pulling in another dep.
    if (provider === 'ses' && process.env.SES_REGION) {
      const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses');
      const boundary = `mime-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const from = process.env.EMAIL_FROM || 'noreply@constructpm.com';
      const ccHeader = ccList.length > 0 ? `Cc: ${ccList.join(', ')}\r\n` : '';
      const raw =
        `From: ${from}\r\n` +
        `To: ${toList.join(', ')}\r\n` +
        ccHeader +
        `Subject: ${subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
        `${html}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${ct}; name="${filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
        fileBuf.toString('base64').replace(/(.{76})/g, '$1\r\n') + `\r\n` +
        `--${boundary}--`;
      const client = new SESClient({ region: process.env.SES_REGION });
      try {
        await client.send(new SendRawEmailCommand({ RawMessage: { Data: Buffer.from(raw) } }));
        return { delivered: true, provider: 'ses' };
      } catch (err) {
        return { delivered: false, provider: 'ses', reason: err.message };
      }
    }

    if (provider === 'gmail' && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      try {
        await this._sendViaGmailRaw({
          to: toList.join(', '),
          cc: ccList.length > 0 ? ccList.join(', ') : null,
          subject,
          html,
          attachments: [{ filename, content: fileBuf, contentType: ct }],
        });
        return { delivered: true, provider: 'gmail' };
      } catch (err) {
        return { delivered: false, provider: 'gmail', reason: err.message };
      }
    }

    // No provider configured — log and report back so the API can tell
    // the caller the email step was skipped (vs. silently lost).
    const ccLabel = ccList.length > 0 ? ` | CC: ${ccList.join(', ')}` : '';
    console.log(`[NotificationService] EMAIL+ATTACHMENT (dev): To: ${toList.join(', ')}${ccLabel} | Subject: ${subject} | Attachment: ${filename} (${fileBuf.length} bytes)`);
    return { delivered: false, provider: 'none', reason: 'no EMAIL_PROVIDER configured' };
  },

  /**
   * Send a one-shot HTML email to a single address — no attachment, no
   * notifications-table row. Sibling of sendEmailWithAttachment for
   * surfaces (project daily briefings, future template-driven notices)
   * that just need a plain HTML/text email out the door.
   *
   * @param {Object} opts
   * @param {string|string[]} opts.to   Recipient email(s) — single string or array
   * @param {string|string[]} [opts.cc] Optional CC email(s) — single or array
   * @param {string} opts.subject
   * @param {string} opts.html          HTML body
   * @param {string} [opts.text]        Optional plain-text fallback
   * @returns {Promise<{delivered: boolean, provider: string, reason?: string}>}
   */
  async sendEmail({ to, cc, subject, html, text }) {
    const toList = normalizeAddresses(to);
    const ccList = normalizeAddresses(cc);
    if (toList.length === 0) return { delivered: false, provider: 'none', reason: 'no recipient' };
    const provider = process.env.EMAIL_PROVIDER;

    if (provider === 'sendgrid' && process.env.SENDGRID_API_KEY) {
      const content = [{ type: 'text/html', value: html || '' }];
      if (text) content.unshift({ type: 'text/plain', value: text });
      const personalization = { to: toList.map(e => ({ email: e })) };
      if (ccList.length > 0) personalization.cc = ccList.map(e => ({ email: e }));
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        },
        body: JSON.stringify({
          personalizations: [personalization],
          from: { email: process.env.EMAIL_FROM || 'noreply@constructpm.com' },
          subject,
          content,
        }),
      });
      if (!response.ok) {
        const t = await response.text().catch(() => '');
        return { delivered: false, provider: 'sendgrid', reason: `${response.status} ${t.slice(0,120)}` };
      }
      return { delivered: true, provider: 'sendgrid' };
    }

    if (provider === 'ses' && process.env.SES_REGION) {
      const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
      const client = new SESClient({ region: process.env.SES_REGION });
      const body = { Html: { Data: html || '' } };
      if (text) body.Text = { Data: text };
      const destination = { ToAddresses: toList };
      if (ccList.length > 0) destination.CcAddresses = ccList;
      try {
        await client.send(new SendEmailCommand({
          Source: process.env.EMAIL_FROM || 'noreply@constructpm.com',
          Destination: destination,
          Message: { Subject: { Data: subject }, Body: body },
        }));
        return { delivered: true, provider: 'ses' };
      } catch (err) {
        return { delivered: false, provider: 'ses', reason: err.message };
      }
    }

    if (provider === 'gmail' && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      try {
        await this._sendViaGmailRaw({
          to: toList.join(', '),
          cc: ccList.length > 0 ? ccList.join(', ') : null,
          subject,
          html: html || '',
          text,
        });
        return { delivered: true, provider: 'gmail' };
      } catch (err) {
        return { delivered: false, provider: 'gmail', reason: err.message };
      }
    }

    // Dev mode — log and report back.
    const ccLabel = ccList.length > 0 ? ` | CC: ${ccList.join(', ')}` : '';
    console.log(`[NotificationService] EMAIL (dev): To: ${toList.join(', ')}${ccLabel} | Subject: ${subject}`);
    return { delivered: false, provider: 'none', reason: 'no EMAIL_PROVIDER configured' };
  },

  /**
   * Deliver push notification via Firebase Cloud Messaging
   */
  async _deliverPush(userId, notification) {
    // Mobile registers Expo push tokens (ExponentPushToken[...]) via
    // POST /users/me/device — stored in user_devices.device_token. Deliver
    // through Expo's push service (https://exp.host); no Firebase project or
    // SDK is needed. Node 20 provides global fetch.
    const tokens = await db('user_devices')
      .where({ user_id: userId })
      .pluck('device_token')
      .catch(() => []);

    const valid = tokens.filter(
      (t) => typeof t === 'string' && t.startsWith('ExponentPushToken')
    );
    if (valid.length === 0) {
      console.log(`[NotificationService] PUSH: no Expo tokens for user ${userId}`);
      return;
    }

    const messages = valid.map((to) => ({
      to,
      title: notification.title,
      body: notification.body || '',
      data: {
        notification_id: notification.id,
        type: notification.type,
        action_url: notification.action_url,
        reference_type: notification.reference_type,
        reference_id: notification.reference_id,
      },
    }));

    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Expo push ${resp.status}: ${text}`);
    }
  },

  // ─── QUERY METHODS ────────────────────────────────────────

  /**
   * Get notifications for a user
   */
  async getForUser(userId, { read, limit = 50, offset = 0 } = {}) {
    const query = db('notifications')
      .where({ user_id: userId, channel: 'in_app' })
      .orderBy('created_at', 'desc');

    if (typeof read === 'boolean') query.where('read', read);

    const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
    const [notifications, countResult] = await Promise.all([
      query.limit(limit).offset(offset),
      countQuery,
    ]);

    return {
      notifications,
      total: parseInt(countResult.total, 10),
      unread: await this.getUnreadCount(userId),
    };
  },

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId) {
    const result = await db('notifications')
      .where({ user_id: userId, channel: 'in_app', read: false })
      .count('* as count')
      .first();
    return parseInt(result.count, 10);
  },

  /**
   * Mark a notification as read
   */
  async markRead(notificationId, userId) {
    const [notification] = await db('notifications')
      .where({ id: notificationId, user_id: userId })
      .update({ read: true, read_at: db.fn.now() })
      .returning('*');
    return notification;
  },

  /**
   * Mark all notifications as read for a user
   */
  async markAllRead(userId) {
    return db('notifications')
      .where({ user_id: userId, channel: 'in_app', read: false })
      .update({ read: true, read_at: db.fn.now() });
  },

  /**
   * Dismiss all informational notifications for a user.
   * Actionable notifications cannot be dismissed — only resolved.
   */
  async dismissAllInformational(userId) {
    return db('notifications')
      .where({ user_id: userId, category: 'informational', dismissed: false })
      .update({ dismissed: true, read: true, read_at: db.fn.now() });
  },

  // ─── CONVENIENCE SENDERS ──────────────────────────────────

  /**
   * Notify relevant users when a bid is won
   */
  async notifyBidWon(bid, project) {
    // #7: Admin + PM + PM admin (delegate)
    const recipients = [];

    // All admins
    const admins = await db('users')
      .where('active', true)
      .where('role', 'admin')
      .pluck('id');
    recipients.push(...admins);

    // PM (estimator)
    if (bid.estimator_id && !recipients.includes(bid.estimator_id)) {
      recipients.push(bid.estimator_id);
    }

    // PM's delegate (PM admin)
    const delegate = await db('pm_notification_delegates')
      .where({ pm_user_id: bid.estimator_id })
      .first();
    if (delegate && !recipients.includes(delegate.delegate_user_id)) {
      recipients.push(delegate.delegate_user_id);
    }

    return this.send({
      userIds: recipients,
      type: 'bid_won',
      category: 'informational',
      title: `Bid Won: ${bid.bid_number}`,
      body: `Bid ${bid.bid_number} — ${bid.project_scope} has been marked as won. Project "${project.name}" has been created.`,
      priority: 'high',
      actionUrl: `/projects/${project.id}`,
      referenceType: 'project',
      referenceId: project.id,
    });
  },

  /**
   * Schedule-dates-needed notification — fires right after a project is
   * created (Mark Won / Quick Project) so the PM gets a one-click handoff
   * into the schedule-edit popup. reference_type 'project_schedule' is
   * recognized by the SPA notifications handler and opens that modal
   * directly instead of navigating to the project page.
   */
  async notifyScheduleDatesNeeded(project) {
    const recipients = await this.getPmAndDelegate(project.pm_id);
    if (recipients.length === 0) return [];

    const numberRow = await db('project_numbers')
      .where({ project_id: project.id, label: 'Primary' })
      .first();
    const label = numberRow?.number || project.name || 'New project';

    return this.send({
      userIds: recipients,
      type: 'schedule_dates_needed',
      category: 'actionable',
      title: `Set schedule dates: ${label}`,
      body: `${label} has been created. Click to set the start date, project length, and working days.`,
      priority: 'high',
      actionType: 'open_schedule_modal',
      referenceType: 'project_schedule',
      referenceId: project.id,
    });
  },

  /**
   * Notify when a document extraction is ready for review
   */
  async notifyExtractionReady(extraction) {
    const docTypeLabels = {
      invoice: 'Invoice',
      timesheet: 'Timesheet',
      purchase_order: 'Purchase Order',
      contract: 'Contract',
    };

    // Determine recipients based on doc type
    const roleMap = {
      invoice: ['admin', 'accounting', 'project_manager'],
      purchase_order: ['admin', 'shop_staff', 'accounting'],
      contract: ['admin', 'project_manager'],
      timesheet: ['admin', 'accounting', 'project_manager'],
    };

    const targetRoles = roleMap[extraction.doc_type] || ['admin'];
    const recipients = await db('users')
      .where('active', true)
      .whereIn('role', targetRoles)
      .pluck('id');

    return this.send({
      userIds: recipients,
      type: 'extraction_ready',
      title: `${docTypeLabels[extraction.doc_type] || 'Document'} Ready for Review`,
      body: `A new ${extraction.doc_type} file "${extraction.file_name}" has been processed and needs your review.`,
      priority: 'high',
      actionUrl: `/extractions/${extraction.id}`,
      referenceType: 'extraction',
      referenceId: extraction.id,
      channels: ['in_app', 'push'],
    });
  },

  /**
   * Notify when a timesheet is submitted from mobile
   */
  async notifyTimesheetSubmitted(timesheet, submitter) {
    const recipients = await db('users')
      .where('active', true)
      .whereIn('role', ['accounting', 'project_manager'])
      .pluck('id');

    return this.send({
      userIds: recipients,
      type: 'timesheet_submitted',
      title: 'Timesheet Submitted',
      body: `${submitter.first_name} ${submitter.last_name} submitted a timesheet for ${timesheet.hours} hours on ${timesheet.work_date}.`,
      priority: 'normal',
      actionUrl: `/projects/${timesheet.project_id}/timesheets`,
      referenceType: 'project',
      referenceId: timesheet.project_id,
      channels: ['in_app', 'email'],
    });
  },

  /**
   * Notify on low inventory stock
   */
  async notifyLowStock(item) {
    const recipients = await db('users')
      .where('active', true)
      .whereIn('role', ['admin', 'shop_staff'])
      .pluck('id');

    return this.send({
      userIds: recipients,
      type: 'low_stock',
      title: `Low Stock Alert: ${item.item_name}`,
      body: `${item.item_name} is at ${item.quantity} ${item.unit} (minimum: ${item.min_stock} ${item.unit}).`,
      priority: 'normal',
      actionUrl: `/inventory/${item.id}`,
      referenceType: 'inventory',
      referenceId: item.id,
      channels: ['in_app', 'email'],
    });
  },
};

module.exports = NotificationService;
