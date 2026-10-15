// Khai báo route cho ♡ (gắn handler vào đường dẫn).
export const favoriteRoutes = [
  { method: "POST", path: "/favorites/:projectId", rateLimitPerMin: 30 },
  { method: "DELETE", path: "/favorites/:projectId", rateLimitPerMin: 30 },
];
