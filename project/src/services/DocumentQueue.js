const Queue = require('bull');
const db = require('../config/database');
const ExtractionService = require('./ExtractionService');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// ── QUEUE SETUP ───────────────────────────────────────────────

let documentQueue;

function getQueue() {
  if (!documentQueue) {
    documentQueue = new Queue('document-processing', REDIS_URL, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,  // keep last 100 completed jobs
        removeOnFail: 200,      // keep last 200 failed jobs
      },
    });

    // Register the processor
    documentQueue.process('extract', 3, processExtractionJob);

    // Event handlers
    documentQueue.on('completed', (job, result) => {
      console.log(`[Queue] Job ${job.id} completed: ${result.status}`);
    });

    documentQueue.on('failed', (job, err) => {
      console.error(`[Queue] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
    });

    documentQueue.on('error', (err) => {
      console.error('[Queue] Queue error:', err.message);
    });
  }

  return documentQueue;
}

// ── JOB PROCESSOR ─────────────────────────────────────────────

async function processExtractionJob(job) {
  const { extractionId, filePath, docType, projectId } = job.data;

  console.log(`[Queue] Processing job ${job.id}: ${docType} for extraction ${extractionId}`);

  try {
    // Update status to processing
    await db('pending_extractions')
      .where({ id: extractionId })
      .update({ status: 'processing', updated_at: db.fn.now() });

    // Run the extraction pipeline (now includes vendor hints + analytics)
    const result = await ExtractionService.processDocument(filePath, docType);

    // Build the update payload with analytics columns
    const updateData = {
      extracted_data: JSON.stringify(result.extracted_data),
      confidence_scores: JSON.stringify(result.confidence_scores),
      status: 'pending',
      error_message: result.error || null,
      model_used: result.model_used || null,
      processing_time_ms: result.processing_time_ms || null,
      overall_confidence: result.overall_confidence || 0,
      vendor_name: result.vendor_name || null,
      validation_errors: result.validation ? JSON.stringify(result.validation.errors) : null,
      updated_at: db.fn.now(),
    };

    // Check if this extraction qualifies for auto-confirm
    const AIConfig = require('../config/aiConfig');
    let autoConfirmed = false;

    if (!result.error && AIConfig.autoConfirm.shouldAutoConfirm(docType, result.extracted_data, result.confidence_scores)) {
      console.log(`[Queue] Auto-confirming ${docType} extraction ${extractionId} (confidence: ${result.overall_confidence}%)`);

      updateData.status = 'confirmed';
      updateData.auto_confirmed = true;
      updateData.confirmed_data = JSON.stringify(result.extracted_data);
      updateData.confirmed_at = db.fn.now();
      autoConfirmed = true;

      // Write to target table via the Extraction model
      try {
        const Extraction = require('../models/Extraction');
        // Use the internal methods to create the record
        await db.transaction(async (trx) => {
          switch (docType) {
            case 'invoice':
              await Extraction._createInvoice(trx, { project_id: projectId, file_path: filePath }, result.extracted_data, null);
              break;
            case 'purchase_order':
              await Extraction._createPurchaseOrder(trx, { project_id: projectId, file_path: filePath }, result.extracted_data, null);
              break;
            case 'timesheet':
              await Extraction._createTimesheetEntries(trx, { project_id: projectId, file_path: filePath }, result.extracted_data);
              break;
          }
        });
        console.log(`[Queue] Auto-confirmed ${docType} written to database`);
      } catch (writeErr) {
        // If writing fails, fall back to pending for manual review
        console.error(`[Queue] Auto-confirm write failed, falling back to pending:`, writeErr.message);
        updateData.status = 'pending';
        updateData.auto_confirmed = false;
        updateData.confirmed_data = null;
        updateData.confirmed_at = null;
        autoConfirmed = false;
      }
    }

    // Save the extraction result
    await db('pending_extractions')
      .where({ id: extractionId })
      .update(updateData);

    // Send notification (only if NOT auto-confirmed)
    if (!autoConfirmed) {
      const NotificationService = require('./NotificationService');
      const updatedExtraction = await db('pending_extractions').where({ id: extractionId }).first();
      if (updatedExtraction && updatedExtraction.status === 'pending') {
        NotificationService.notifyExtractionReady(updatedExtraction).catch(err => {
          console.error('[Queue] Extraction notification failed:', err.message);
        });
      }
    }

    return {
      status: autoConfirmed ? 'auto_confirmed' : 'extracted',
      extractionId,
      method: result.extraction_method,
      model: result.model_used,
      confidence: result.overall_confidence,
      autoConfirmed,
      fieldCount: Object.keys(result.extracted_data).length,
    };

  } catch (err) {
    // Mark as failed
    await db('pending_extractions')
      .where({ id: extractionId })
      .update({
        status: 'failed',
        error_message: err.message,
        updated_at: db.fn.now(),
      });

    throw err; // Re-throw so Bull retries
  }
}

// ── PUBLIC API ─────────────────────────────────────────────────

const DocumentQueue = {
  /**
   * Add a document extraction job to the queue.
   * Called after a file is uploaded to a project subfolder.
   */
  async addExtractionJob({ extractionId, filePath, docType, projectId, uploadedBy }) {
    const queue = getQueue();

    const job = await queue.add('extract', {
      extractionId,
      filePath,
      docType,
      projectId,
      uploadedBy,
      queuedAt: new Date().toISOString(),
    }, {
      priority: docType === 'contract' ? 1 : 2, // contracts get higher priority
    });

    console.log(`[Queue] Queued job ${job.id} for ${docType}: ${extractionId}`);
    return job.id;
  },

  /**
   * Get queue health statistics
   */
  async getStats() {
    const queue = getQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  },

  /**
   * Gracefully shut down the queue
   */
  async shutdown() {
    if (documentQueue) {
      await documentQueue.close();
      console.log('[Queue] Document queue shut down.');
    }
  },

  /**
   * Process a document synchronously (without the queue).
   * Useful for development/testing when Redis isn't available.
   */
  async processSync({ extractionId, filePath, docType, projectId }) {
    console.log(`[Queue] Sync processing ${docType}: ${extractionId}`);
    return processExtractionJob({
      id: 'sync',
      data: { extractionId, filePath, docType, projectId },
      attemptsMade: 1,
    });
  },
};

module.exports = DocumentQueue;
