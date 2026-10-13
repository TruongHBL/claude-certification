// Gửi mail và ghi log gửi mail.
import { query } from "./01_db.js";
import { smtp } from "./smtp.js";

export async function sendMail(to, subject) {
  await smtp.send({ to, subject });
  query("INSERT INTO mail_logs (recipient, subject) VALUES ($1, $2)", [to, subject]);
  return true;
}
