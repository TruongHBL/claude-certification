// load_document: bản THU HẸP của fetch_url (least privilege áp vào thiết kế tool).
//
// fetch_url tải BẤT KỲ URL nào → agent có thể gọi API nội bộ, tải ảnh/binary, chạm metadata cloud.
// load_document chỉ nhận tài liệu: https + domain đã duyệt + đuôi tài liệu. Vi phạm trả lỗi có
// cấu trúc theo quy ước bài 2.2 (errorCategory / isRetryable / description).
import { isIP } from "node:net";
import { extname } from "node:path";

export const DOC_EXTENSIONS = [".pdf", ".docx", ".md", ".txt", ".html", ".htm"];
export const TRUSTED_DOMAINS = ["gso.gov.vn", "molisa.gov.vn", "ilo.org", "worldbank.org", "vnexpress.net", "hbr.org", "docs.example.vn"];
export const BLOCKED_HOSTS = ["localhost", "metadata.google.internal"];

export interface StructuredError {
  errorCategory: "transient" | "validation" | "business" | "permission";
  isRetryable: boolean;
  description: string;
}

export interface LoadDocumentError {
  isError: true;
  structuredContent: StructuredError;
}

function error(category: StructuredError["errorCategory"], description: string): LoadDocumentError {
  return { isError: true, structuredContent: { errorCategory: category, isRetryable: false, description } };
}

/** Loopback, private (10/8, 172.16/12, 192.168/16, fc00::/7) hoặc link-local (169.254/16, fe80::/10). */
export function isInternalIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (v === 6) {
    const l = h.toLowerCase();
    return l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return false;
}

const trusted = (host: string) => TRUSTED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

/** Trả null nếu hợp lệ, hoặc object lỗi có cấu trúc. */
export function validate(url: unknown): LoadDocumentError | null {
  const raw = String(url ?? "").trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return error("validation", `URL không hợp lệ: '${raw}'. Cần URL https đầy đủ trỏ tới tài liệu.`);
  }
  if (!u.hostname) return error("validation", `URL không hợp lệ: '${raw}'. Cần URL https đầy đủ trỏ tới tài liệu.`);

  const host = u.hostname.toLowerCase();
  const scheme = u.protocol.replace(/:$/, "");
  if (scheme !== "https") return error("validation", `Chỉ nhận https (nhận được ${scheme}). Tìm bản https của tài liệu.`);
  if (BLOCKED_HOSTS.includes(host) || isInternalIp(host)) {
    return error("permission", `Từ chối địa chỉ nội bộ '${host}'. load_document không truy cập mạng nội bộ/metadata; không thử lại.`);
  }
  if (!trusted(host)) return error("permission", `Domain '${host}' chưa được duyệt. Báo coordinator nếu thật sự cần nguồn này.`);

  const ext = extname(u.pathname).toLowerCase();
  if (!DOC_EXTENSIONS.includes(ext)) {
    const shown = ext === "" ? "(không có đuôi)" : ext;
    return error("validation", `'${shown}' không phải tài liệu. Chỉ nhận ${DOC_EXTENSIONS.join(" ")}. Dùng search_web để tìm bản tài liệu.`);
  }
  return null;
}
