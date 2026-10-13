// Gửi mail thông báo các dự án matching mới cho người dùng.
import { sendMail } from "./12_mailer.js";

const subjectFor = (m) => `Có dự án mới: ${m.title}`;

export async function notifyNewMatches(user, matches) {
  if (matches.length === 0) return { sent: 0 };

  let sent = 0;
  matches.forEach(async (m) => {
    await sendMail(user.email, subjectFor(m));
    sent += 1;
  });

  return { sent };
}
