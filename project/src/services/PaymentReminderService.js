/**
 * Payment Reminder Service
 * 
 * Polls for overdue invoices and sends per-invoice notifications.
 * Payment terms come from the project record.
 * Reminder fires when: invoice_date + payment_terms < today AND no payment recorded.
 * 
 * Payment recording:
 *   - User confirms "payment received" + optional amount (null = full payment) + required date
 *   - Updates invoice record
 *   - Checks if project revenue >= contract_value → close-out notification
 */

const db = require('../config/database');
const NotificationService = require('./NotificationService');

const PaymentReminderService = {
  /**
   * Check all active projects for overdue invoices.
   * Called on a schedule (e.g., daily via cron or FileWatcher poll cycle).
   */
  async checkOverdueInvoices() {
    const today = new Date().toISOString().split('T')[0];

    // Find invoices past due that haven't been paid
    const overdueInvoices = await db('invoices')
      .join('projects', 'invoices.project_id', 'projects.id')
      .where('projects.status', 'active')
      .whereNotIn('invoices.status', ['paid', 'cancelled'])
      .whereNotNull('invoices.payment_due_date')
      .where('invoices.payment_due_date', '<', today)
      .select(
        'invoices.*',
        'projects.name as project_name',
        'projects.pm_id',
        'projects.payment_terms',
      );

    let notified = 0;
    for (const invoice of overdueInvoices) {
      // Check if we already sent an unread reminder for this invoice
      const existing = await db('notifications')
        .where({
          reference_type: 'invoice',
          reference_id: invoice.id,
          type: 'payment_overdue',
          dismissed: false,
        })
        .where('read', false)
        .first();

      if (existing) continue;

      const daysOverdue = Math.floor((new Date(today) - new Date(invoice.payment_due_date)) / (1000 * 60 * 60 * 24));

      // #10: PM + PM admin (delegate)
      const recipients = [invoice.pm_id];
      const delegate = await db('pm_notification_delegates')
        .where({ pm_user_id: invoice.pm_id }).first();
      if (delegate && !recipients.includes(delegate.delegate_user_id)) {
        recipients.push(delegate.delegate_user_id);
      }

      for (const userId of recipients) {
        await NotificationService.send({
          userId,
          type: 'payment_overdue',
          category: 'informational',
          title: `Invoice ${invoice.invoice_number || 'N/A'} — ${daysOverdue} days past ${invoice.payment_terms || 'terms'}`,
          body: `Invoice for $${parseFloat(invoice.amount || 0).toLocaleString()} on project "${invoice.project_name}" is overdue. Payment due was ${invoice.payment_due_date}.`,
          priority: daysOverdue > 60 ? 'urgent' : daysOverdue > 30 ? 'high' : 'normal',
          actionType: 'confirm_payment',
          referenceType: 'invoice',
          referenceId: invoice.id,
        });
      }
      notified++;
    }

    return { checked: overdueInvoices.length, notified };
  },

  /**
   * Record payment received on an invoice.
   * Amount is optional — null means full payment assumed.
   * Date is required.
   * 
   * After recording, checks if project revenue >= contract_value for close-out.
   */
  async recordPayment(invoiceId, paymentDate, paymentAmount = null, userId = null) {
    const invoice = await db('invoices').where({ id: invoiceId }).first();
    if (!invoice) throw new Error('Invoice not found');

    const isFullPayment = paymentAmount === null || paymentAmount === undefined;
    const status = isFullPayment ? 'paid' : 'partial_paid';

    const [updated] = await db('invoices').where({ id: invoiceId }).update({
      payment_received_date: paymentDate,
      payment_received_amount: paymentAmount,
      status,
      updated_at: db.fn.now(),
    }).returning('*');

    // Check for close-out trigger: revenue >= contract_value
    await this._checkCloseOutTrigger(invoice.project_id);

    return updated;
  },

  /**
   * Check if project revenue has reached or exceeded contract value.
   * If so, send close-out notification to PM.
   */
  async _checkCloseOutTrigger(projectId) {
    const project = await db('projects').where({ id: projectId }).first();
    if (!project || project.status !== 'active' || !project.contract_value) return;
    if (project.contract_type === 't_and_m') return; // T&M has no contract value target

    const [{ total }] = await db('invoices')
      .where({ project_id: projectId })
      .whereNotIn('status', ['cancelled'])
      .select(db.raw('COALESCE(SUM(amount), 0) as total'));

    const totalRevenue = parseFloat(total);
    const contractValue = parseFloat(project.contract_value);

    if (totalRevenue >= contractValue) {
      // Check if we already sent this notification
      const existing = await db('notifications')
        .where({
          reference_type: 'project',
          reference_id: projectId,
          type: 'project_closeout',
          dismissed: false,
        })
        .where('read', false)
        .first();

      if (!existing) {
        await NotificationService.send({
          userId: project.pm_id,
          type: 'project_closeout',
          category: 'informational',
          title: `${project.name} — revenue reached contract value`,
          body: `Revenue ($${totalRevenue.toLocaleString()}) has reached the contract value ($${contractValue.toLocaleString()}). Close out this project?`,
          priority: 'normal',
          actionType: 'close_project',
          referenceType: 'project',
          referenceId: projectId,
        });
      }
    }
  },
};

module.exports = PaymentReminderService;
