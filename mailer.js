const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  } else if (user && pass) {
    // Standard Gmail / service fallback
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: { user, pass },
    });
  }

  return transporter;
}

const getSender = () => {
  return (
    process.env.SMTP_FROM ||
    process.env.EMAIL_FROM ||
    `"আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল" <${process.env.SMTP_USER || process.env.EMAIL_USER || "no-reply@aimhabiganj.edu.bd"}>`
  );
};

const baseHtmlTemplate = ({ title, preheader, contentHtml }) => `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f4; margin: 0; padding: 20px; color: #1e293b; }
    .container { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #043e30, #065f46); padding: 28px 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #d1fae5; }
    .body { padding: 32px 24px; }
    .btn { display: inline-block; background-color: #043e30; color: #ffffff !important; text-decoration: none; padding: 12px 28px; font-size: 15px; font-weight: 600; border-radius: 8px; margin: 20px 0; }
    .btn:hover { background-color: #065f46; }
    .footer { padding: 20px 24px; background: #f8fafc; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #f1f5f9; }
    .warning { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px; font-size: 13px; color: #92400e; margin-top: 20px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল</h1>
      <p>কাজিরবাগ (পুর্বাচল সংলগ্ন), রূপগঞ্জ, নারায়ণগঞ্জ।</p>
    </div>
    <div class="body">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>এটি একটি স্বয়ংক্রিয় বার্তা। এই ইমেইলে সরাসরি উত্তর দেবেন না।</p>
      <p>&copy; ${new Date().getFullYear()} আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল. সর্বস্বত্ব সংরক্ষিত।</p>
    </div>
  </div>
</body>
</html>
`;

async function sendEmail({ to, subject, html, text }) {
  const mailer = getTransporter();
  const from = getSender();

  if (!mailer) {
    console.log("==================================================");
    console.log(`[DEV MAILER - No SMTP Configured]`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Text Preview: ${text || "See HTML"}`);
    console.log("==================================================");
    return { success: true, simulated: true };
  }

  try {
    const info = await mailer.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    console.log(`Email dispatched to ${to} (MessageId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`Email dispatch error to ${to}:`, err);
    throw err;
  }
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const subject = "পাসওয়ার্ড রিসেট করার অনুরোধ - AIM";
  const contentHtml = `
    <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">মুহতারাম ${name || "ব্যবহারকারী"},</h2>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      আপনার আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ গ্রহণ করা হয়েছে। নতুন পাসওয়ার্ড সেট করতে নিচের বাটনে ক্লিক করুন:
    </p>
    <div style="text-align: center;">
      <a href="${resetUrl}" class="btn" target="_blank">পাসওয়ার্ড রিসেট করুন</a>
    </div>
    <p style="font-size: 13px; color: #64748b; word-break: break-all;">
      বাটনে ক্লিক করতে সমস্যা হলে নিচের লিংকে যান:<br>
      <a href="${resetUrl}" style="color: #043e30;">${resetUrl}</a>
    </p>
    <div class="warning">
      ⚠️ এই লিংকটির মেয়াদ <strong>১ ঘণ্টা</strong>। আপনি যদি এই অনুরোধ না করে থাকেন, তবে নির্দ্বিধায় এই বার্তাটি উপেক্ষা করুন। আপনার পাসওয়ার্ড অপরিবর্তিত থাকবে।
    </div>
  `;

  return sendEmail({
    to,
    subject,
    text: `পাসওয়ার্ড রিসেট করতে নিচের লিংকে যান:\n${resetUrl}\n(মেয়াদ ১ ঘণ্টা)`,
    html: baseHtmlTemplate({
      title: subject,
      preheader: "AIM পাসওয়ার্ড রিসেট লিংক",
      contentHtml,
    }),
  });
}

async function sendEmailVerificationEmail({ to, name, verifyUrl }) {
  const subject = "ইমেইল পরিবর্তন নিশ্চিতকরণ - AIM";
  const contentHtml = `
    <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">মুহতারাম ${name || "ব্যবহারকারী"},</h2>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      আপনার আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল অ্যাকাউন্টের ইমেইল ঠিকানা হিসেবে এই ইমেইলটি যুক্ত করার অনুরোধ করা হয়েছে। ইমেইল পরিবর্তন নিশ্চিত ও সম্পন্ন করতে নিচের বাটনে ক্লিক করুন:
    </p>
    <div style="text-align: center;">
      <a href="${verifyUrl}" class="btn" target="_blank">ইমেইল নিশ্চিত করুন</a>
    </div>
    <p style="font-size: 13px; color: #64748b; word-break: break-all;">
      বাটনে ক্লিক করতে সমস্যা হলে নিচের লিংকে যান:<br>
      <a href="${verifyUrl}" style="color: #043e30;">${verifyUrl}</a>
    </p>
    <div class="warning">
      ⚠️ এই ভেরিফিকেশন লিংকের মেয়াদ <strong>১ ঘণ্টা</strong>। আপনি যদি এই পরিবর্তন অনুরোধ না করে থাকেন, তবে অবিলম্বে আপনার পাসওয়ার্ড পরিবর্তন করুন।
    </div>
  `;

  return sendEmail({
    to,
    subject,
    text: `ইমেইল নিশ্চিত করতে নিচের লিংকে যান:\n${verifyUrl}\n(মেয়াদ ১ ঘণ্টা)`,
    html: baseHtmlTemplate({
      title: subject,
      preheader: "AIM ইমেইল পরিবর্তন নিশ্চিতকরণ",
      contentHtml,
    }),
  });
}

async function sendPasswordChangedNotification({ to, name }) {
  const subject = "আপনার পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে - AIM";
  const contentHtml = `
    <h2 style="font-size: 18px; color: #0f172a; margin-top: 0;">মুহতারাম ${name || "ব্যবহারকারী"},</h2>
    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      আপনার আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল অ্যাকাউন্টের পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে।
    </p>
    <p style="font-size: 13px; color: #64748b;">
      পরিবর্তনের সময়: ${new Date().toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
    </p>
    <div class="warning">
      ⚠️ আপনি যদি এই পরিবর্তন না করে থাকেন, তবে অবিলম্বে আমাদের অ্যাডমিন বা সাপোর্ট টিমের সাথে যোগাযোগ করুন।
    </div>
  `;

  return sendEmail({
    to,
    subject,
    text: "আপনার আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল অ্যাকাউন্টের পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে।",
    html: baseHtmlTemplate({
      title: subject,
      preheader: "AIM পাসওয়ার্ড পরিবর্তন নোটিফিকেশন",
      contentHtml,
    }),
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendPasswordChangedNotification,
};
