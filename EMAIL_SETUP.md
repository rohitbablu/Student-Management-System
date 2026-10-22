# Password reset email setup

The forgot-password form sends a short-lived reset link to the registered email address through SMTP. The link expires after 30 minutes and is never displayed by the application.

Do not use `sandbox.smtp.mailtrap.io` for real password resets. Mailtrap's sandbox accepts SMTP messages but stores them in its test inbox instead of delivering them to the registered email address. Use Gmail SMTP or a live transactional-email provider with verified sender settings.

1. Copy `.env.example` to `.env` (keep `.env` private and do not commit it).
2. Set `APP_URL` to the base URL where this app is accessible. For local development this is usually `http://localhost:8080`; for deployment use the site's HTTPS URL.
3. Set the SMTP values for your email provider. For Gmail, use `smtp.gmail.com`, port `587`, and an App Password created for an account with 2-Step Verification enabled. Do not use your normal Google password.
4. Set `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` to the sending account and sender address.
5. Restart the Node server after changing `.env`.

If SMTP is missing or sending fails, the app reports that it could not send the email and does not display a reset link on screen.
