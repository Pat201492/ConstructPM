/**
 * File Watcher Service
 * 
 * Scheduled checks for:
 *   1. Bid inactivity → archive prompt notification
 *   2. Contract empty → upload contract notification
 *   3. Overdue invoice payments → escalating reminders
 *   4. Revenue ≥ contract value → close-out notification
 * 
 * Schedule is configurable via Admin → Global Variables:
 *   filewatcher_schedule = "0 0 * * *"   (cron format, default: midnight daily)
 *   filewatcher_interval_hours = 24      (simple alternative: run every N hours)
 * 
 * Uses the simpler interval approach unless a cron string is set.
 */

const db = require('../config/database');
const GlobalVariable = require('../models/GlobalVariable');
const NotificationService = require('./NotificationService');
const SavedExportRunner = require('./SavedExportRunner');
const { parseExpression } = require('cron-parser');

class FileWatcher {
  constructor() {
    this.running = false;
    this._timeout = null;
    this._intervalMs = 24 * 60 * 60 * 1000; // Default 24h
  }

  async start() {
    if (this.running) return;
    this.running = true;

    // Read interval from global variables
    await this._loadSchedule();

    // Calculate ms until next run (align to the configured hour)
    const msUntilFirst = this._msUntilNextRun();
    console.log(`[FileWatcher] Started — next run in ${(msUntilFirst / 3600000).toFixed(1)}h, then every ${this._intervalMs / 3600000}h`);

    // Schedule first run, then repeat
    this._timeout = setTimeout(async () => {
      await this._poll();
      this._scheduleNext();
    }, msUntilFirst);
  }

  _scheduleNext() {
    if (!this.running) return;
    this._timeout = setTimeout(async () => {
      await this._loadSchedule(); // Re-read in case admin changed it
      await this._poll();
      this._scheduleNext();
    }, this._intervalMs);
  }

  _msUntilNextRun() {
    // Align to next occurrence of the configured hour
    const now = new Date();
    const runHour = this._runAtHour || 0; // midnight default
    const next = new Date(now);
    next.setHours(runHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next - now;
    // But if interval is less than 24h, just use interval
    return this._intervalMs < 24 * 60 * 60 * 1000 ? this._intervalMs : ms;
  }

  async _loadSchedule() {
    try {
      const hours = await db('global_variables').where('key', 'filewatcher_interval_hours').first();
      if (hours && hours.value) {
        const h = parseFloat(hours.value);
        if (h > 0) this._intervalMs = h * 60 * 60 * 1000;
      }
      const runAt = await db('global_variables').where('key', 'filewatcher_run_at_hour').first();
      if (runAt && runAt.value) {
        this._runAtHour = parseInt(runAt.value) || 0;
      }
    } catch {
      // DB not ready yet, use defaults
    }
  }

  stop() {
    this.running = false;
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    console.log('[FileWatcher] Stopped');
  }

  async _poll() {
    const start = Date.now();
    console.log(`[FileWatcher] Running checks at ${new Date().toISOString()}`);
    try {
      await Promise.all([
        this._checkBidInactivity(),
        this._checkContractPOEmpty(),
        this._checkOverduePayments(),
        this._checkRevenueThreshold(),
        this._checkOilSampleReminders(),
        this._processDueSavedExports(),
      ]);
      console.log(`[FileWatcher] Checks complete in ${Date.now() - start}ms`);
    } catch (err) {
      console.error('[FileWatcher] Poll error:', err.message);
    }
  }

  async _checkOverduePayments() {
    try {
      const PaymentReminderService = require('./PaymentReminderService');
      const result = await PaymentReminderService.checkOverdueInvoices();
      if (result.notified > 0) {
        console.log(`[FileWatcher] Payment reminders: ${result.notified} sent`);
      }
    } catch (err) {
      console.error('[FileWatcher] Payment check error:', err.message);
    }
  }

  async _checkRevenueThreshold() {
    try {
      // Find active projects where total invoiced revenue >= contract value
      const projects = await db('projects')
        .where('status', 'active')
        .whereNotNull('contract_value')
        .where('contract_value', '>', 0);

      for (const project of projects) {
        const { sum } = await db('invoices')
          .where('project_id', project.id)
          .whereNot('status', 'cancelled')
          .sum('amount as sum')
          .first() || {};

        if (parseFloat(sum || 0) >= parseFloat(project.contract_value)) {
          const existing = await db('notifications')
            .where({ reference_type: 'project', reference_id: project.id, type: 'revenue_threshold' })
            .where('read', false).first();
          if (existing) continue;

          await NotificationService.send({
            userId: project.pm_id,
            type: 'revenue_threshold',
            category: 'actionable',
            title: `${project.name} — revenue meets contract value`,
            body: `Total invoiced: $${parseFloat(sum).toFixed(2)} ≥ contract: $${parseFloat(project.contract_value).toFixed(2)}. Consider closing this project.`,
            priority: 'high',
            channel: 'in_app',
            referenceType: 'project',
            referenceId: project.id,
          });
        }
      }
    } catch (err) {
      console.error('[FileWatcher] Revenue threshold error:', err.message);
    }
  }

  async _checkBidInactivity() {
    const thresholdDays = await GlobalVariable.getBidInactivityDays();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);

    const staleBids = await db('bids')
      .whereIn('status', ['draft', 'submitted', 'pending'])
      .where('updated_at', '<', cutoff.toISOString())
      .where(function () {
        this.whereNull('snooze_until')
          .orWhere('snooze_until', '<', new Date().toISOString());
      });

    for (const bid of staleBids) {
      const existingNotif = await db('notifications')
        .where({ reference_type: 'bid', reference_id: bid.id, type: 'bid_archive_prompt', dismissed: false })
        .where('read', false).first();
      if (existingNotif) continue;

      try {
        await NotificationService.send({
          userId: bid.estimator_id,
          type: 'bid_archive_prompt',
          category: 'actionable',
          title: `Bid ${bid.bid_number} — no activity for ${thresholdDays} days`,
          body: `Bid "${bid.project_scope}" has had no activity. Archive it or snooze the reminder?`,
          priority: 'normal',
          channel: 'in_app',
          actionType: 'bid_archive',
          referenceType: 'bid',
          referenceId: bid.id,
        });
      } catch (err) {
        console.error(`[FileWatcher] Notification error for bid ${bid.bid_number}:`, err.message);
      }
    }
  }

  async _checkContractPOEmpty() {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const projects = await db('projects')
      .where('status', 'active')
      .whereNull('contract_type')
      .where('created_at', '<', oneDayAgo.toISOString());

    for (const project of projects) {
      if (!project.folder_path) continue;
      try {
        const path = require('path');
        const FileService = require('./FileService');
        const files = await FileService.listFiles(path.join(project.folder_path, 'Contract'));
        if (files.length > 0) continue;

        const existingNotif = await db('notifications')
          .where({ reference_type: 'project', reference_id: project.id, type: 'contract_po_empty', dismissed: false })
          .where('read', false).first();
        if (existingNotif) continue;

        await NotificationService.send({
          userId: project.pm_id,
          type: 'contract_po_empty',
          category: 'actionable',
          title: `${project.name} — upload contract`,
          body: 'The Contract folder is empty. Please upload the contract and select: Contract or T&M?',
          priority: 'high',
          channel: 'in_app',
          actionType: 'select_contract_type',
          referenceType: 'project',
          referenceId: project.id,
        });
      } catch (err) {
        if (!err.message?.includes('ENOENT')) {
          console.error(`[FileWatcher] Contract check error for ${project.name}:`, err.message);
        }
      }
    }
  }

  /**
   * Run any saved_exports whose cron has come due. Recomputes next_run_at
   * from the cron expression after each run, regardless of success — a
   * permanently broken export shouldn't pin the worker on every tick.
   * Manual-only saved exports (cron IS NULL) are ignored here; they only
   * fire via POST /api/exports/schedules/:id/trigger.
   *
   * Concurrency: each due row is claimed atomically by advancing
   * next_run_at *before* SavedExportRunner.run. If two ticks overlap (a
   * slow export running past the next polling interval), the second tick's
   * UPDATE sees a future next_run_at and selects 0 rows. The claim uses
   * the row's *current* next_run_at as a precondition so two parallel
   * processes can't both grab the same row.
   */
  async _processDueSavedExports() {
    try {
      const now = new Date();
      const due = await db('saved_exports')
        .where('enabled', true)
        .whereNotNull('cron')
        .where(function () {
          this.whereNull('next_run_at').orWhere('next_run_at', '<=', now);
        });

      for (const row of due) {
        // Compute the new next_run_at first — we need it to claim the row.
        // If the cron is malformed, disable the row and skip to the next.
        let nextRunAt;
        try {
          nextRunAt = parseExpression(row.cron, { currentDate: now }).next().toDate();
        } catch (err) {
          console.error(`[FileWatcher] saved_export "${row.name}" has invalid cron "${row.cron}" — disabling:`, err.message);
          await db('saved_exports').where('id', row.id).update({
            enabled: false,
            last_status: 'failed',
            last_error: `invalid cron: ${err.message}`,
          });
          continue;
        }

        // Claim the row by advancing next_run_at before running. The
        // precondition (`previous next_run_at`) guarantees only one worker
        // succeeds; if another already claimed it, the UPDATE affects 0
        // rows and we skip. NULL is matched explicitly via IS NULL.
        const claim = db('saved_exports').where('id', row.id);
        if (row.next_run_at == null) claim.whereNull('next_run_at');
        else claim.where('next_run_at', row.next_run_at);
        const claimed = await claim.update({ next_run_at: nextRunAt });
        if (!claimed) {
          // Another worker grabbed it — move on without double-firing.
          continue;
        }

        try {
          const result = await SavedExportRunner.run(row);
          console.log(`[FileWatcher] saved_export "${row.name}" → ${result.status} (delivered=${result.delivered}, failed=${result.failed}, rows=${result.rowCount})`);
        } catch (err) {
          console.error(`[FileWatcher] saved_export "${row.name}" threw:`, err.message);
          // Runner already stamps on its own catch path; this is the
          // belt-and-suspenders for anything it didn't catch.
          await db('saved_exports').where('id', row.id).update({
            last_run_at: now, last_status: 'failed', last_error: err.message,
          }).catch(() => {});
        }
      }

      if (due.length > 0) {
        console.log(`[FileWatcher] Saved exports processed: ${due.length}`);
      }
    } catch (err) {
      console.error('[FileWatcher] Saved-exports error:', err.message);
    }
  }

  /**
   * Fire any per-project daily briefings whose configured hour has
   * arrived and that haven't yet run today. Catch-up semantics: if the
   * server was down at the configured hour, the briefing fires on the
   * next tick that finds it due (so `send_hour_utc <= current UTC hour`,
   * not strict equality). Each row is handed to ProjectBriefingRunner,
   * which does its own status stamping; this method only logs the batch.
   */
  async _processDueProjectBriefings() {
    try {
      const due = await db('project_daily_email_configs')
        .where('enabled', true)
        .whereRaw("send_hour_utc <= EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'UTC'))")
        .where(function () {
          this.whereNull('last_run_at')
            .orWhereRaw("last_run_at < date_trunc('day', NOW() AT TIME ZONE 'UTC')");
        });

      for (const row of due) {
        try {
          const result = await ProjectBriefingRunner.run(row.project_id);
          console.log(`[FileWatcher] daily briefing for project ${row.project_id} → ${result.status} (delivered=${result.delivered}, failed=${result.failed}, recipients=${result.recipientsResolved})`);
        } catch (err) {
          console.error(`[FileWatcher] briefing for project ${row.project_id} threw:`, err.message);
          // Runner stamps on its own catch path; this is defense in depth.
        }
      }

      if (due.length > 0) {
        console.log(`[FileWatcher] Project briefings processed: ${due.length}`);
      }
    } catch (err) {
      console.error('[FileWatcher] Project-briefings error:', err.message);
    }
  }

  /**
   * Check for oil samples pending return past the reminder threshold.
   * Sends one notification, snoozable for configured days.
   */
  async _checkOilSampleReminders() {
    try {
      const reminderDays = parseInt(
        (await db('global_variables').where('key', 'oil_sample_return_reminder_days').first())?.value || '14'
      );

      const OilSampleRequest = require('../models/OilSampleRequest');
      const overdue = await OilSampleRequest.getOverdueForReminder(reminderDays);

      for (const sample of overdue) {
        // Check for existing unread reminder
        const existing = await db('notifications')
          .where({ reference_type: 'oil_sample', reference_id: sample.id, type: 'oil_sample_return_reminder' })
          .where('read', false).first();
        if (existing) continue;

        // Notify PM
        if (sample.pm_id) {
          await NotificationService.send({
            userId: sample.pm_id,
            type: 'oil_sample_return_reminder',
            category: 'actionable',
            title: `Oil sample overdue — ${sample.equipment_id_field || 'Unknown Equipment'}`,
            body: `Oil sample from ${sample.project_name || 'project'} submitted ${reminderDays}+ days ago. Equipment: ${sample.equipment_id_field || 'N/A'}. Mark as returned or snooze.`,
            priority: 'high',
            channel: 'in_app',
            referenceType: 'oil_sample',
            referenceId: sample.id,
          });
        }
      }

      if (overdue.length > 0) {
        console.log(`[FileWatcher] Oil sample reminders: ${overdue.length} overdue checked`);
      }
    } catch (err) {
      console.error('[FileWatcher] Oil sample reminder error:', err.message);
    }
  }
}

module.exports = new FileWatcher();
