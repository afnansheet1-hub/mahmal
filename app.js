import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const defaultPdfName = "تفاصيل المبيعات (3).pdf";
const els = {
  input: document.querySelector("#pdfInput"),
  fileName: document.querySelector("#fileName"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  pageCount: document.querySelector("#pageCount"),
  totalSales: document.querySelector("#totalSales"),
  totalQty: document.querySelector("#totalQty"),
  productCount: document.querySelector("#productCount"),
  avgUnit: document.querySelector("#avgUnit"),
  topQty: document.querySelector("#topQty"),
  reportMeta: document.querySelector("#reportMeta"),
  insights: document.querySelector("#insights"),
  focusCards: document.querySelector("#focusCards"),
  priceBands: document.querySelector("#priceBands"),
  dailyExtract: document.querySelector("#dailyExtract"),
  copyExtract: document.querySelector("#copyExtract"),
  sessionImageInput: document.querySelector("#sessionImageInput"),
  sessionImagePreview: document.querySelector("#sessionImagePreview"),
  ordersInput: document.querySelector("#ordersInput"),
  orderSalesInput: document.querySelector("#orderSalesInput"),
  ocrStatus: document.querySelector("#ocrStatus"),
  openRouterKey: document.querySelector("#openRouterKey"),
  openRouterModel: document.querySelector("#openRouterModel"),
  refreshFreeModels: document.querySelector("#refreshFreeModels"),
  aiAnalyzePdf: document.querySelector("#aiAnalyzePdf"),
  aiStatus: document.querySelector("#aiStatus"),
  barChart: document.querySelector("#barChart"),
  productsBody: document.querySelector("#productsBody"),
  search: document.querySelector("#searchInput"),
  preview: document.querySelector("#pdfPreview"),
  previewLabel: document.querySelector("#previewLabel"),
};

const moneyFormatter = new Intl.NumberFormat("ar-SA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("ar-SA", {
  maximumFractionDigits: 1,
});
const extractNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

let allProducts = [];
let allExtractProducts = [];
let currentExtractText = "";
let currentExtractPayload = null;
let mappedDailyQuantities = {};
let sessionOrderTotal = null;
let sessionOrderSales = null;
let latestPdfText = "";
let aiPdfTotalQty = null;
let aiOfferDiscountQty = null;
let discountBundleCounts = {
  pinkMusk: null,
};
let lastPdfSalesTotal = 0;
let lastPdfQtyTotal = 0;

function setStatus(text, type = "ready") {
  els.statusText.textContent = text;
  els.statusDot.className = `status-dot ${type === "ready" ? "" : type}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cleanText(value) {
  return value
    .replace(/[﷼]/g, "")
    .replace(/\b(?:Total|Tax|excluded|المنتج|الكمية|الوحدات|فئة)\b/gi, "")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(value) {
  const match = value.replace(/[﷼]/g, "").match(/-?\s*[\d,]+\.\d{2}/);
  return match ? Number(match[0].replace(/\s|,/g, "")) : null;
}

function parseQty(value) {
  const match = value.match(/(?:^|\s)(\d+(?:\.\d)?)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function extractBarcode(value) {
  const match = value.match(/\[\s*(\d{8,})\s*\]|\]\s*(\d{8,})\s*\[|(\d{8,})/);
  return match ? match[1] || match[2] || match[3] : "";
}

function groupItemsByLine(items) {
  const lines = [];
  const sorted = items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: Math.round(item.transform[5]),
    }))
    .sort((a, b) => b.y - a.y || b.x - a.x);

  for (const item of sorted) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= 3);
    if (line) {
      line.items.push(item);
      line.y = Math.round((line.y + item.y) / 2);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .map((line) => {
      const itemsByX = line.items.sort((a, b) => b.x - a.x);
      return {
        y: line.y,
        text: itemsByX.map((item) => item.text).join(" "),
        items: itemsByX,
      };
    })
    .filter((line) => !/تقرير\s+المبيعات|معرف\s+الجلسة|شركة|الراجحي|^\d+\s*\/\s*\d+/.test(line.text));
}

function rowFromLine(line) {
  const text = line.text;
  const amount = parseAmount(text);
  const barcode = extractBarcode(text);
  const qtyItems = line.items
    .map((item) => ({ value: parseQty(item.text), x: item.x, text: item.text }))
    .filter((item) => item.value !== null && item.value < 10000 && (!amount || Math.abs(item.value - amount) > 0.01));
  const qty = (barcode ? qtyItems.at(-1)?.value : qtyItems[0]?.value) ?? null;

  if (amount === null || qty === null) {
    return null;
  }

  let product = cleanText(text)
    .replace(/[\d,]+\.\d{2}/g, "")
    .replace(/\b\d+(?:\.\d)?\b/g, "")
    .replace(/\bPerfume\b/gi, "")
    .trim();

  if (!product || product.length < 3) {
    return null;
  }

  product = product.replace(/\s+/g, " ");
  return { product, barcode, qty, amount, unitPrice: amount / qty };
}

function mergeContinuationRows(rows) {
  return rows
    .filter((row) => row.barcode)
    .filter((row) => !/^Perfume$/i.test(row.product))
    .map((row) => ({
      ...row,
      product: row.product.replace(/\s+Each$/i, "").trim(),
      unitPrice: row.amount / row.qty,
    }));
}

async function analyzePdf(source, name) {
  setStatus("جاري قراءة الصفحات واستخراج جدول المبيعات والمؤشرات التفصيلية...", "loading");
  els.fileName.textContent = name;
  els.previewLabel.textContent = "الصفحة الأولى";

  const loadingTask = pdfjsLib.getDocument(source);
  const pdf = await loadingTask.promise;
  await renderPreview(pdf);
  const rows = [];
  const pageTexts = [];
  const rawPageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    rawPageTexts.push(content.items.map((item) => item.str).join("\n"));
    const lines = groupItemsByLine(content.items);
    pageTexts.push(lines.map((line) => line.text).join(" "));
    for (const line of lines) {
      const row = rowFromLine(line);
      if (row) rows.push(row);
    }
  }

  latestPdfText = pageTexts.join("\n");
  allExtractProducts = mergeContinuationRows(rows);
  allProducts = allExtractProducts.filter((row) => row.amount > 0);
  aiPdfTotalQty = null;
  aiOfferDiscountQty = null;
  discountBundleCounts = mergeDiscountBundleCounts(
    extractDiscountBundleCounts(rawPageTexts.join("\n")),
    extractDiscountBundleCountsFromRows(rows),
  );
  mappedDailyQuantities = extractMappedDailyQuantities(latestPdfText);
  renderDashboard(pdf.numPages, allProducts, latestPdfText, name);
  setStatus("تم تحليل التقرير بنجاح. الواجهة تعرض الآن مؤشرات تفصيلية قابلة للبحث والمراجعة.", "ready");
}

async function renderPreview(pdf) {
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  els.preview.replaceChildren(canvas);
}

function renderDashboard(pageCount, products, allText, name) {
  const totalSales = products.reduce((sum, row) => sum + row.amount, 0);
  const totalQty = products.reduce((sum, row) => sum + row.qty, 0);
  lastPdfSalesTotal = totalSales;
  lastPdfQtyTotal = totalQty;
  const displaySales = sessionOrderSales || totalSales;
  const avgUnit = totalQty ? displaySales / totalQty : 0;
  const sortedByValue = [...products].sort((a, b) => b.amount - a.amount);
  const sortedByQty = [...products].sort((a, b) => b.qty - a.qty);
  const topProduct = sortedByValue[0];
  const topQtyProduct = sortedByQty[0];
  const dateMatch = allText.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  const sessionMatch = allText.match(/POS\/\d+/);

  els.pageCount.textContent = numberFormatter.format(pageCount);
  els.totalSales.textContent = `${moneyFormatter.format(displaySales)} ر.س`;
  els.totalQty.textContent = numberFormatter.format(totalQty);
  els.productCount.textContent = numberFormatter.format(products.length);
  els.avgUnit.textContent = totalQty ? `${moneyFormatter.format(avgUnit)} ر.س` : "-";
  els.topQty.textContent = topQtyProduct ? numberFormatter.format(topQtyProduct.qty) : "-";
  els.reportMeta.textContent = [dateMatch?.[0], sessionMatch?.[0]].filter(Boolean).join(" · ") || name;

  renderInsights({ pageCount, products, totalSales, totalQty, avgUnit, topProduct, topQtyProduct });
  renderChart(products);
  renderFocusCards(products);
  renderPriceBands(products);
  currentExtractPayload = { products, countProducts: allExtractProducts, totalSales, totalQty, date: dateMatch?.[0] };
  renderDailyExtract(currentExtractPayload);
  renderTable(products);
}

function updateDashboardSalesOverride() {
  const displaySales = sessionOrderSales || lastPdfSalesTotal;
  els.totalSales.textContent = `${moneyFormatter.format(displaySales)} ر.س`;
  if (lastPdfQtyTotal) {
    els.avgUnit.textContent = `${moneyFormatter.format(displaySales / lastPdfQtyTotal)} ر.س`;
  }
}

function formatPlainMoney(value) {
  return extractNumberFormatter.format(value).replace(/\.(\d+)$/, ",$1");
}

function formatPlainNumber(value) {
  return extractNumberFormatter.format(value).replace(/\.(\d+)$/, ",$1");
}

function formatPlainInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function isOfferDiscount(row) {
  const name = normalizeName(row.product);
  return row.amount < 0 && (
    name.includes("on your order") ||
    name.includes("order your on") ||
    name.includes("per point") ||
    name.includes("order 100") ||
    name.includes("discount")
  );
}

function isOrderDiscountName(product) {
  const name = normalizeName(product);
  return name.includes("on your order") || name.includes("order your on");
}

function sumQtyByKeywords(products, keywords) {
  return products
    .filter((row) => {
      const name = normalizeName(row.product);
      return keywords.some((keyword) => name.includes(keyword));
    })
    .reduce((sum, row) => sum + row.qty, 0);
}

function sumAmountByKeywords(products, keywords) {
  return products
    .filter((row) => {
      const name = normalizeName(row.product);
      return keywords.some((keyword) => name.includes(keyword));
    })
    .reduce((sum, row) => sum + row.amount, 0);
}

const dailyProductMap = {
  discoveryBlack: {
    barcodes: ["6287020284793"],
    names: ["match collection match discovery set d4"],
  },
  tawziatCollection: {
    barcodes: ["6287020286155"],
    names: ["match towziyat box pack 20 ml 10 in 1"],
  },
  muskCollection: {
    barcodes: ["6287020284809"],
    names: ["match musk collection 20ml 9in1"],
  },
  d5Box: {
    barcodes: ["6287020285042"],
    names: ["match collection match discovery set ramadan d5"],
  },
  tawziyatBoxSolo: {
    barcodes: ["6287020286926"],
    names: ["tawziyat box solo"],
  },
};

function productMatches(row, rule) {
  if (rule.barcodes.includes(row.barcode)) return true;
  const name = normalizeName(row.product);
  return rule.names.some((target) => name.includes(normalizeName(target)));
}

function sumQtyByMappedProduct(products, key) {
  const rule = dailyProductMap[key];
  return products
    .filter((row) => productMatches(row, rule))
    .reduce((sum, row) => sum + row.qty, 0);
}

function extractMappedDailyQuantities(text) {
  const quantities = {};
  for (const [key, rule] of Object.entries(dailyProductMap)) {
    quantities[key] = 0;
    for (const barcode of rule.barcodes) {
      const escaped = barcode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`${escaped}[\\s\\S]{0,180}?(\\d+(?:\\.\\d+)?)\\s*\\n?\\s*تاﺪﺣﻮﻟا`, "g");
      let match;
      while ((match = pattern.exec(text)) !== null) {
        quantities[key] += Number(match[1]);
      }
    }
  }
  return quantities;
}

function extractDiscountBundleCounts(text) {
  const rows = [];
  const normalized = text.replace(/\u200b/g, " ");
  const productFirst = /on\s+your\s+order\s+100%[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*تاﺪﺣﻮﻟا[\s\S]{0,80}?-\s*([\d,]+\.\d{2})/g;
  const amountFirst = /-\s*([\d,]+\.\d{2})[\s\S]{0,80}?(\d+(?:\.\d+)?)\s*تاﺪﺣﻮﻟا[\s\S]{0,80}?on\s+your\s+order\s+100%/g;
  let match;
  while ((match = productFirst.exec(normalized)) !== null) {
    rows.push({ qty: Number(match[1]), amount: Number(match[2].replace(/,/g, "")) });
  }
  while ((match = amountFirst.exec(normalized)) !== null) {
    rows.push({ qty: Number(match[2]), amount: Number(match[1].replace(/,/g, "")) });
  }
  return {
    pinkMusk: rows
      .filter((row) => Math.abs(row.amount - 46.09) < 0.02)
      .reduce((sum, row) => sum + row.qty, 0),
  };
}

function extractDiscountBundleCountsFromRows(rows) {
  return {
    pinkMusk: rows
      .filter((row) => isOrderDiscountName(row.product))
      .filter((row) => Math.abs(Math.abs(row.amount) - 46.09) < 0.02 || Math.abs(Math.abs(row.amount / row.qty) - 46.09) < 0.02)
      .reduce((sum, row) => sum + row.qty, 0),
  };
}

function mergeDiscountBundleCounts(...counts) {
  return {
    pinkMusk: Math.max(...counts.map((count) => count.pinkMusk || 0)),
  };
}

function formatDateForExtract(dateText) {
  if (!dateText) return "N/A";
  const [year, month, day] = dateText.split("-");
  return `${day} / ${month} / ${year}`;
}

function renderDailyExtract({ products, countProducts, totalSales, totalQty, date }) {
  const fallbackAt = products.length;
  const orders = sessionOrderTotal;
  const salesForAdt = sessionOrderSales || totalSales;
  const adt = orders || fallbackAt;
  const at = adt ? salesForAdt / adt : 0;
  const offerDiscountQty = aiOfferDiscountQty ?? countProducts.filter(isOfferDiscount).reduce((sum, row) => sum + row.qty, 0);
  const pdfQuantityTotal = aiPdfTotalQty ?? totalQty;
  const uptBaseQty = Math.max(0, pdfQuantityTotal - offerDiscountQty);
  const upt = orders ? uptBaseQty / orders : adt ? totalQty / adt : 0;
  const pink = sumQtyByKeywords(countProducts, ["pink", "pinko"]);
  const muskCollection = sumQtyByMappedProduct(countProducts, "muskCollection");
  const pinkMuskBundle = discountBundleCounts.pinkMusk ?? 0;
  const discoveryBlack = sumQtyByMappedProduct(countProducts, "discoveryBlack");
  const winterCollection = sumQtyByKeywords(countProducts, ["winter collection"]);
  const magicLayering = sumQtyByKeywords(countProducts, ["magic", "layering"]);
  const d5Box = sumQtyByMappedProduct(countProducts, "d5Box");
  const tawziat = sumQtyByMappedProduct(countProducts, "tawziatCollection");
  const mmtBundle = sumQtyByKeywords(countProducts, ["mmt"]);
  const makeupSales = sumAmountByKeywords(countProducts, ["makeup", "make up"]);
  const tawziyatBoxSolo = sumQtyByMappedProduct(countProducts, "tawziyatBoxSolo");

  currentExtractText = `● ALMAHMAL ●

${formatDateForExtract(date)}

- Sales : ${formatPlainMoney(salesForAdt)}
- ADT : ${formatPlainNumber(adt)}
- AT : ${formatPlainNumber(at)}
- UPT : ${formatPlainNumber(upt)}
- Cash : N/A
------------------
- Pinkoctober :${formatPlainNumber(pink)}
- Musk collection :${formatPlainNumber(muskCollection)}
- Bundle (P+M) :${formatPlainNumber(pinkMuskBundle)}
------------------
- Discovery Black :${formatPlainNumber(discoveryBlack)}
- Winter collection :${formatPlainNumber(winterCollection)}
- Bundle ( D + W) :${formatPlainNumber(Math.min(discoveryBlack, winterCollection))}
------------------
- Magic of Layering : ${formatPlainNumber(magicLayering)}
- D5 Box :${formatPlainNumber(d5Box)}
- Bundle(M+D) : ${formatPlainNumber(Math.min(magicLayering, d5Box))}
------------------
- Tawziat collection :${formatPlainNumber(tawziat)}
- MMT Bundle : ${formatPlainNumber(mmtBundle)}
------------------
- MAKEUP SALES  : ${makeupSales ? formatPlainMoney(makeupSales) : "0"}
Tawziyat Box solo : ${formatPlainNumber(tawziyatBoxSolo)}
------------------
- Jahez sales  : N/A
- ADT :N/A`;

  els.dailyExtract.textContent = currentExtractText;
}

async function refreshOpenRouterModels() {
  els.aiStatus.textContent = "جاري جلب الموديلات المجانية من OpenRouter...";
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error("Could not load OpenRouter models");
  const data = await response.json();
  const freeModels = (data.data || [])
    .filter((model) => {
      const prompt = Number(model.pricing?.prompt ?? 1);
      const completion = Number(model.pricing?.completion ?? 1);
      return model.id?.includes(":free") || (prompt === 0 && completion === 0);
    })
    .slice(0, 30);

  if (!freeModels.length) {
    els.aiStatus.textContent = "لم يتم العثور على موديلات مجانية تلقائيًا. استخدم القائمة الحالية.";
    return;
  }

  els.openRouterModel.innerHTML = "";
  for (const model of freeModels) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.id;
    els.openRouterModel.appendChild(option);
  }
  els.aiStatus.textContent = `تم تحميل ${freeModels.length} موديل مجاني.`;
}

function extractJsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object returned");
  return JSON.parse(match[0]);
}

async function analyzePdfWithOpenRouter() {
  const apiKey = els.openRouterKey.value.trim() || window.OPENROUTER_API_KEY || "";
  if (!apiKey) {
    els.aiStatus.textContent = "أدخل OpenRouter API Key في الخانة أولًا. لن يتم حفظه في الموقع.";
    return;
  }
  if (!latestPdfText) {
    els.aiStatus.textContent = "حلل ملف PDF أولًا قبل استخدام OpenRouter.";
    return;
  }

  els.aiStatus.textContent = "جاري تحليل نص PDF عبر OpenRouter...";
  const prompt = `You are analyzing a POS daily sales PDF text. Return ONLY JSON with:
{
  "pdf_total_quantity": number,
  "offer_discount_quantity": number,
  "notes": string
}

Rules:
- pdf_total_quantity is the grand total quantity shown in the PDF totals row if present.
- offer_discount_quantity is the sum of quantities for discount/offer rows only, such as "on your order 100%" or "per point on your order".
- Do not include returns in offer_discount_quantity.
- If the PDF total quantity is not explicit, estimate from item quantities and explain in notes.

PDF text:
${latestPdfText.slice(0, 45000)}`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Mahmal PDF Sales Dashboard",
    },
    body: JSON.stringify({
      model: els.openRouterModel.value,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(content);
  aiPdfTotalQty = Number(parsed.pdf_total_quantity) > 0 ? Number(parsed.pdf_total_quantity) : null;
  aiOfferDiscountQty = Number(parsed.offer_discount_quantity) >= 0 ? Number(parsed.offer_discount_quantity) : null;
  if (currentExtractPayload) renderDailyExtract(currentExtractPayload);
  els.aiStatus.textContent = `تم تحديث الكمية: الإجمالي ${formatPlainNumber(aiPdfTotalQty ?? 0)}، خصم العروض ${formatPlainNumber(aiOfferDiscountQty ?? 0)}. ${parsed.notes || ""}`;
}

function parseOrderTotalFromOcr(text) {
  const normalized = text.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
  const labelMatch = normalized.match(/(?:orders?|order|الطلبات|طلبات)\D{0,24}(\d{1,5})|(\d{1,5})\D{0,24}(?:orders?|order|الطلبات|طلبات)/i);
  if (labelMatch) return Number(labelMatch[1] || labelMatch[2]);

  const integers = [...normalized.matchAll(/(?<![.,])\b\d{1,5}\b(?![.,]\d)/g)]
    .map((match) => Number(match[0]))
    .filter((value) => value > 0 && value < 10000);
  if (!integers.length) return null;

  const likelySmallCounts = integers.filter((value) => value <= 500);
  return likelySmallCounts.at(-1) ?? integers.at(-1);
}

function parseOrderSalesFromOcr(text) {
  const normalized = text
    .replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
  const moneyValues = [...normalized.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})\b|\b\d{4,}(?:\.\d{2})\b/g)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) => value > 0);
  if (!moneyValues.length) return null;
  return Math.max(...moneyValues);
}

function updateOrders(value) {
  sessionOrderTotal = Number(value) > 0 ? Number(value) : null;
  if (currentExtractPayload) renderDailyExtract(currentExtractPayload);
}

function updateOrderSales(value) {
  sessionOrderSales = Number(value) > 0 ? Number(value) : null;
  updateDashboardSalesOverride();
  if (currentExtractPayload) renderDailyExtract(currentExtractPayload);
}

async function recognizeSessionImage(file) {
  els.ocrStatus.textContent = "جاري قراءة الصورة واستخراج إجمالي الطلبات...";
  const { createWorker } = await import("./vendor/tesseract.esm.min.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "./vendor/tesseract-worker.min.js",
    logger: (message) => {
      if (message.status === "recognizing text") {
        els.ocrStatus.textContent = `جاري قراءة الصورة... ${Math.round((message.progress || 0) * 100)}%`;
      }
    },
  });

  try {
    const result = await worker.recognize(file);
    const orders = parseOrderTotalFromOcr(result.data.text);
    const sales = parseOrderSalesFromOcr(result.data.text);
    if (orders) {
      els.ordersInput.value = orders;
      updateOrders(orders);
    }
    if (sales) {
      els.orderSalesInput.value = sales.toFixed(2);
      updateOrderSales(sales);
    }
    if (orders || sales) {
      const parts = [];
      if (orders) parts.push(`عدد الطلبات: ${formatPlainInteger(orders)}`);
      if (sales) parts.push(`Sales: ${formatPlainMoney(sales)}`);
      els.ocrStatus.textContent = `تم استخراج ${parts.join("، ")}. يمكنك تعديل القيم إذا احتجت.`;
    } else {
      els.ocrStatus.textContent = "لم أتمكن من تحديد عدد الطلبات تلقائيًا. أدخل عدد الطلبات وSales يدويًا من أعلى الصورة.";
    }
  } finally {
    await worker.terminate();
  }
}

function renderInsights({ pageCount, products, totalSales, totalQty, avgUnit, topProduct, topQtyProduct }) {
  const valueShare = topProduct && totalSales ? (topProduct.amount / totalSales) * 100 : 0;
  const qtyShare = topQtyProduct && totalQty ? (topQtyProduct.qty / totalQty) * 100 : 0;
  const messages = [
    `تم استخراج ${numberFormatter.format(products.length)} بند مبيعات من ${numberFormatter.format(pageCount)} صفحات، مع إجمالي كمية ${numberFormatter.format(totalQty)} وحدة.`,
    topProduct
      ? `أعلى بند قيمة هو ${topProduct.product} ويمثل تقريبًا ${numberFormatter.format(valueShare)}٪ من إجمالي المبيعات.`
      : "لم يتم العثور على بنود قابلة للتحليل داخل الملف.",
    topQtyProduct
      ? `أعلى بند في الحركة الكمية هو ${topQtyProduct.product} بعدد ${numberFormatter.format(topQtyProduct.qty)} وحدة، بنسبة ${numberFormatter.format(qtyShare)}٪ من الكمية.`
      : "لا توجد كميات كافية لحساب أعلى بند كمية.",
    avgUnit ? `متوسط قيمة الوحدة التقريبي ${moneyFormatter.format(avgUnit)} ر.س، ويمكن استخدامه لمراقبة تغيرات التسعير بين التقارير.` : "لا توجد كميات كافية لحساب متوسط الوحدة.",
  ];

  els.insights.innerHTML = "";
  for (const text of messages) {
    const item = document.createElement("div");
    item.className = "insight";
    item.textContent = text;
    els.insights.appendChild(item);
  }
}

function renderChart(products) {
  const top = [...products].sort((a, b) => b.amount - a.amount).slice(0, 8);
  const max = top[0]?.amount || 1;
  els.barChart.innerHTML = "";

  if (!top.length) {
    els.barChart.innerHTML = "<p class='muted'>لا توجد بيانات كافية للرسم.</p>";
    return;
  }

  for (const row of top) {
    const item = document.createElement("div");
    item.className = "bar-row";
    item.innerHTML = `
      <div>
        <div class="bar-label" title="${escapeHtml(row.product)}">${escapeHtml(row.product)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, (row.amount / max) * 100)}%"></div></div>
      </div>
      <div class="bar-value">${moneyFormatter.format(row.amount)}</div>
    `;
    els.barChart.appendChild(item);
  }
}

function renderFocusCards(products) {
  const byValue = [...products].sort((a, b) => b.amount - a.amount)[0];
  const byQty = [...products].sort((a, b) => b.qty - a.qty)[0];
  const byUnit = [...products].sort((a, b) => b.unitPrice - a.unitPrice)[0];
  const cards = [
    byValue && { label: "أعلى قيمة مبيعات", title: byValue.product, value: `${moneyFormatter.format(byValue.amount)} ر.س` },
    byQty && { label: "أعلى حركة كمية", title: byQty.product, value: `${numberFormatter.format(byQty.qty)} وحدة` },
    byUnit && { label: "أعلى سعر وحدة", title: byUnit.product, value: `${moneyFormatter.format(byUnit.unitPrice)} ر.س` },
  ].filter(Boolean);

  els.focusCards.innerHTML = "";
  if (!cards.length) {
    els.focusCards.innerHTML = "<div class='focus-card'>لا توجد بيانات كافية.</div>";
    return;
  }

  for (const card of cards) {
    const item = document.createElement("div");
    item.className = "focus-card";
    item.innerHTML = `
      <span>${card.label}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <p>${card.value}</p>
    `;
    els.focusCards.appendChild(item);
  }
}

function renderPriceBands(products) {
  const bands = [
    { label: "أقل من 100 ر.س", test: (row) => row.amount < 100 },
    { label: "100 إلى 300 ر.س", test: (row) => row.amount >= 100 && row.amount < 300 },
    { label: "300 ر.س فأكثر", test: (row) => row.amount >= 300 },
  ].map((band) => ({
    ...band,
    count: products.filter(band.test).length,
  }));
  const max = Math.max(...bands.map((band) => band.count), 1);

  els.priceBands.innerHTML = "";
  for (const band of bands) {
    const item = document.createElement("div");
    item.className = "band";
    item.innerHTML = `
      <span>${band.label}</span>
      <strong>${numberFormatter.format(band.count)} منتج</strong>
      <div class="band-meter"><i style="width:${Math.max(4, (band.count / max) * 100)}%"></i></div>
    `;
    els.priceBands.appendChild(item);
  }
}

function renderTable(products) {
  const term = els.search.value.trim().toLowerCase();
  const filtered = products.filter((row) => {
    const haystack = `${row.product} ${row.barcode}`.toLowerCase();
    return haystack.includes(term);
  });

  els.productsBody.innerHTML = "";
  if (!filtered.length) {
    els.productsBody.innerHTML = "<tr><td colspan='6'>لا توجد نتائج مطابقة.</td></tr>";
    return;
  }

  filtered.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(row.product)}</td>
      <td>${escapeHtml(row.barcode || "-")}</td>
      <td>${numberFormatter.format(row.qty)}</td>
      <td>${moneyFormatter.format(row.unitPrice)} ر.س</td>
      <td>${moneyFormatter.format(row.amount)} ر.س</td>
    `;
    els.productsBody.appendChild(tr);
  });
}

els.input.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const bytes = await file.arrayBuffer();
    await analyzePdf({ data: bytes }, file.name);
  } catch (error) {
    console.error(error);
    setStatus("تعذر تحليل الملف. تأكد أن الملف PDF نصي وليس صورة ممسوحة فقط.", "error");
  }
});

els.search.addEventListener("input", () => renderTable(allProducts));

els.ordersInput.addEventListener("input", () => {
  updateOrders(els.ordersInput.value);
});

els.orderSalesInput.addEventListener("input", () => {
  updateOrderSales(els.orderSalesInput.value);
});

els.refreshFreeModels.addEventListener("click", async () => {
  try {
    await refreshOpenRouterModels();
  } catch (error) {
    console.error(error);
    els.aiStatus.textContent = "تعذر جلب الموديلات المجانية. تأكد من الاتصال واستخدم القائمة الحالية.";
  }
});

els.aiAnalyzePdf.addEventListener("click", async () => {
  try {
    await analyzePdfWithOpenRouter();
  } catch (error) {
    console.error(error);
    els.aiStatus.textContent = "تعذر تحليل PDF عبر OpenRouter. تأكد من المفتاح والموديل.";
  }
});

els.sessionImageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  els.sessionImagePreview.src = URL.createObjectURL(file);
  els.sessionImagePreview.classList.add("visible");

  try {
    await recognizeSessionImage(file);
  } catch (error) {
    console.error(error);
    els.ocrStatus.textContent = "تعذرت قراءة الصورة تلقائيًا. أدخل عدد الطلبات وSales يدويًا من أعلى الصورة.";
  }
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".app-view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active");
  });
});

els.copyExtract.addEventListener("click", async () => {
  if (!currentExtractText) return;
  await navigator.clipboard.writeText(currentExtractText);
  const original = els.copyExtract.textContent;
  els.copyExtract.textContent = "تم النسخ";
  window.setTimeout(() => {
    els.copyExtract.textContent = original;
  }, 1400);
});

async function boot() {
  try {
    const response = await fetch(encodeURI(defaultPdfName));
    if (!response.ok) throw new Error("Default PDF not found");
    const bytes = await response.arrayBuffer();
    await analyzePdf({ data: bytes }, defaultPdfName);
  } catch (error) {
    console.warn(error);
    setStatus("ارفع ملف PDF للبدء. المتصفح منع تحميل الملف الافتراضي مباشرة.", "ready");
  }
}

boot();

if (window.OPENROUTER_API_KEY) {
  els.openRouterKey.value = window.OPENROUTER_API_KEY;
  els.aiStatus.textContent = "تم تحميل مفتاح OpenRouter من الملف المحلي.";
}
