// Job hằng ngày: nhắc người dùng về dự án đã ♡ sắp hết hạn.
import { sendMail } from "./12_mailer.js";

const subjectFor = (m) => `Sắp hết hạn: ${m.title}`;

export async function remindExpiring(user, matches) {
  if (matches.length === 0) return { sent: 0 };

  let sent = 0;
  matches.forEach(async (m) => {
    await sendMail(user.email, subjectFor(m));
    sent += 1;
  });

  return { sent };
}
