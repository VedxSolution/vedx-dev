import nodemailer from 'nodemailer';

const isConfigured = Boolean(
  process.env.EMAIL_USER &&
  process.env.EMAIL_PASS &&
  process.env.EMAIL_FROM
);

const mailer = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "465", 10),
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, 
  },
});

export const mailTransporter = {
  async sendMail({ from = process.env.EMAIL_FROM, to, cc, subject, html, text }) {
    if (!isConfigured) {
      throw new Error('Email credentials are not fully configured');
    }

    if (!to) {
      throw new Error('Recipient email address is required');
    }

    return mailer.sendMail({
      from,
      to,
      cc,
      subject,
      html,
      text,
    });
  },
};

export const isEmailConfigured = isConfigured;

export const sendOtpEmail = async (email, otp) => {
  const subject = 'Your OTP Verification Code';

  const htmlBody = `
    <div>
      <p>Dear Valued Customer,</p>
      <p>Your OTP is: <strong>${otp}</strong></p>
      <p>This OTP is valid for 10 minutes.</p>
      <p>Thank you!</p>
    </div>
  `;

  if (!isEmailConfigured) {
    console.warn('Email credentials are not configured. Skipping OTP email send.');
    return false;
  }

  try {
    await mailTransporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: email,
      subject,
      html: htmlBody,
    });

    return true;
  } catch (err) {
    console.error('Failed to send OTP email:', err.message || err);
    return false;
  }
};
