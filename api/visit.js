function textLine(label, value) {
  const cleanValue = String(value || "-").replace(/\s+/g, " ").trim();
  return `${label}: ${cleanValue.slice(0, 220)}`;
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "-";
}

function getBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (error) {
      return {};
    }
  }

  return req.body && typeof req.body === "object" ? req.body : {};
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    res.status(200).json({ ok: false, reason: "missing_telegram_config" });
    return;
  }

  const body = getBody(req);
  const now = new Date();
  const message = [
    "زيارة جديدة لموقع MATCH",
    textLine("الوقت", now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })),
    textLine("الصفحة", body.path),
    textLine("الجهاز", body.userAgent),
    textLine("الشاشة", body.screen),
    textLine("اللغة", body.language),
    textLine("المصدر", body.referrer),
    textLine("IP", getClientIp(req)),
  ].join("\n");

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!telegramResponse.ok) {
      const detail = await telegramResponse.text();
      res.status(502).json({ ok: false, error: "telegram_failed", detail: detail.slice(0, 300) });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "notification_failed" });
  }
};
