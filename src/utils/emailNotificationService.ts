import nodemailer from "nodemailer";
import { configService } from "../config/configService";
import ProgressTracker from "../utils/progressTracker";

interface JobNotificationDetails {
  jobId: string;
  jobType: string;
  tableName: string;
  screenName: string;
  totalRecords: number;
  progressPercent?: number;
  successCount?: number;
  failureCount?: number;
  duration?: string;
  status?: string;
}

export class EmailNotificationService {
  private static instance: EmailNotificationService;
  private transporter?: nodemailer.Transporter;
  private activeJobTimers: Map<string, NodeJS.Timeout> = new Map();
  private jobMetadata: Map<
    string,
    { jobType: string; tableName: string; screenName: string }
  > = new Map();
  private config: any;

  private constructor() {
    this.initialize();
  }

  public static getInstance(): EmailNotificationService {
    if (!EmailNotificationService.instance) {
      EmailNotificationService.instance = new EmailNotificationService();
    }
    return EmailNotificationService.instance;
  }

  public async initialize(): Promise<void> {
    this.config = await configService.getConfig();

    if (this.isNotificationDisabled()) {
      console.log("Email notifications are disabled");
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: this.config.EMAIL_HOST,
      port: this.config.EMAIL_PORT,
      secure: this.config.EMAIL_SECURE === "true",
      auth: {
        user: this.config.EMAIL_USER,
        pass: this.config.EMAIL_PASSWORD,
      },
    });
  }

  private isNotificationDisabled(): boolean {
    return this.config?.EMAIL_NOTIFICATIONS_ENABLED !== "true";
  }

  public async sendJobStartNotification(
    details: JobNotificationDetails
  ): Promise<void> {
    if (this.isNotificationDisabled()) return;

    // Save job metadata for future reference
    this.jobMetadata.set(details.jobId, {
      jobType: details.jobType,
      tableName: details.tableName,
      screenName: details.screenName,
    });

    const subject = `התחלת ג'וב: ${details.jobId} (${details.jobType})`;
    const text = `
      ג'וב החל לרוץ
      
      מזהה ג'וב: ${details.jobId}
      סוג ג'וב: ${details.jobType}
      טבלה: ${details.tableName}
      מסך בפריוריטי: ${details.screenName}
      סך רשומות לעיבוד: ${details.totalRecords.toLocaleString()}
      
      זוהי הודעה אוטומטית.
    `;

    await this.sendEmail(subject, text);

    // Schedule progress notifications for this job
    this.scheduleProgressNotifications(details.jobId);
  }

  public async sendJobProgressNotification(jobId: string): Promise<void> {
    if (this.isNotificationDisabled()) return;

    // Check if the job is still active
    const progress = ProgressTracker.getProgress(jobId);
    if (!progress) return;

    const metadata = this.jobMetadata.get(jobId);
    if (!metadata) return;

    const subject = `התקדמות ג'וב: ${jobId} (${progress.percentage}%)`;
    const text = `
      עדכון התקדמות ג'וב
      
      מזהה ג'וב: ${jobId}
      סוג ג'וב: ${metadata.jobType}
      טבלה: ${metadata.tableName}
      התקדמות: ${progress.percentage}% (${progress.successCount.toLocaleString()} הצלחות, ${progress.failureCount.toLocaleString()} כשלונות)
      סך רשומות: ${progress.totalRecords.toLocaleString()}
      
      זוהי הודעה אוטומטית.
    `;

    await this.sendEmail(subject, text);
  }

  public async sendJobCompletionNotification(
    details: JobNotificationDetails
  ): Promise<void> {
    if (this.isNotificationDisabled()) return;

    // Clear any active progress notifications for this job
    this.clearProgressNotificationsForJob(details.jobId);

    const subject = `ג'וב הושלם: ${details.jobId} (${details.status})`;
    const text = `
      עיבוד ג'וב הסתיים
      
      מזהה ג'וב: ${details.jobId}
      סוג ג'וב: ${details.jobType}
      טבלה: ${details.tableName}
      סטטוס: ${details.status}
      תוצאות: ${(details.successCount ?? 0).toLocaleString()} הצלחות, ${(details.failureCount ?? 0).toLocaleString()} כשלונות
      סך רשומות: ${details.totalRecords.toLocaleString()}
      משך זמן: ${details.duration}
      
      זוהי הודעה אוטומטית.
    `;

    await this.sendEmail(subject, text);

    // Remove job metadata after completion
    this.jobMetadata.delete(details.jobId);
  }

  private async sendEmail(subject: string, text: string): Promise<void> {
    try {
      if (!this.transporter) {
        console.error("Email transporter is not initialized.");
        return;
      }
      await this.transporter.sendMail({
        from: this.config.EMAIL_FROM,
        to: this.config.EMAIL_TO,
        subject,
        text,
      });
      console.log(`Email sent: ${subject}`);
    } catch (error) {
      console.error("Failed to send email notification:", error);
    }
  }

  private scheduleProgressNotifications(jobId: string): void {
    // Clear any existing timer
    this.clearProgressNotificationsForJob(jobId);

    // Get the notification interval from the config
    const notificationInterval =
      this.config.EMAIL_NOTIFICATION_INTERVAL || 7200000;

    // Schedule a timer to send progress notifications
    const timer = setInterval(async () => {
      try {
        const progress = ProgressTracker.getProgress(jobId);

        if (
          !progress ||
          progress.status === "completed" ||
          progress.status === "failed"
        ) {
          this.clearProgressNotificationsForJob(jobId);
          return;
        }

        // Send the progress notification
        await this.sendJobProgressNotification(jobId);
      } catch (error) {
        console.error(
          `Error sending progress notification for job ${jobId}:`,
          error
        );
      }
    }, notificationInterval); // default to 2 hours if not set

    this.activeJobTimers.set(jobId, timer);
  }

  private clearProgressNotificationsForJob(jobId: string): void {
    const timer = this.activeJobTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.activeJobTimers.delete(jobId);
    }
  }
}
